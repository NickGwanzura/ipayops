import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { sendNotification } from '@/lib/notifications';

const claimSchema = z.object({ inventoryItemId: z.string().uuid(), issue: z.string().trim().min(3).max(500) });

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.serviceRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || '1') || 1);
  const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get('pageSize') || '50') || 50));
  const offset = (page - 1) * pageSize;
  const result = await query(
    `SELECT wc.id, wc.number, wc.status, wc.issue, wc.resolution, wc.created_at, ii.serial_number, ii.sku, ii.description, ii.client_name,
            COALESCE(json_agg(json_build_object('id', rr.id, 'number', rr.number, 'description', rr.description, 'status', rr.status, 'estimatedCost', rr.estimated_cost)
              ORDER BY rr.created_at DESC) FILTER (WHERE rr.id IS NOT NULL), '[]'::json) AS requisitions,
            COUNT(*) OVER()::int AS total_count
     FROM warranty_claims wc JOIN inventory_items ii ON ii.id = wc.inventory_item_id LEFT JOIN repair_requisitions rr ON rr.claim_id = wc.id
     WHERE wc.organization_id = $1 GROUP BY wc.id, ii.id ORDER BY wc.created_at DESC LIMIT $2 OFFSET $3`,
    [session.user.organizationId, pageSize, offset],
  );
  const total = result.rows[0]?.total_count || 0;
  return NextResponse.json({ claims: result.rows.map(({ total_count: _totalCount, ...claim }) => claim), pagination: { page, pageSize, total, hasMore: offset + result.rows.length < total } });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.serviceRead);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = claimSchema.parse(await request.json());
    const claim = await withTransaction(async client => {
      const item = await client.query(
        `SELECT ii.id, ii.client_name, wc.id AS warranty_id FROM inventory_items ii LEFT JOIN warranty_contracts wc ON wc.inventory_item_id = ii.id AND wc.status = 'Active'
         WHERE ii.id = $1 AND ii.organization_id = $2 FOR UPDATE OF ii`,
        [body.inventoryItemId, session.user.organizationId],
      );
      if (!item.rows[0]) throw Object.assign(new Error('Inventory item not found.'), { code: 'ITEM_NOT_FOUND' });
      const number = `WAR-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO warranty_claims (organization_id, number, inventory_item_id, warranty_contract_id, issue, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, number, status, issue, created_at`,
        [session.user.organizationId, number, body.inventoryItemId, item.rows[0].warranty_id || null, body.issue, session.user.id],
      );
      await client.query(`UPDATE inventory_items SET status = 'Warranty', updated_at = now() WHERE id = $1`, [body.inventoryItemId]);
      return result.rows[0];
    });
    await sendNotification({ organizationId: session.user.organizationId, eventType: 'warranty.claim_opened', recipientEmail: session.user.email, recipientName: session.user.fullName, subject: `Warranty claim ${claim.number} opened`, eyebrow: 'Warranty activity', title: 'Warranty claim opened', summary: 'A new warranty claim has been created and entered the service queue.', fields: [{ label: 'Claim', value: claim.number }, { label: 'Issue', value: claim.issue }, { label: 'Status', value: claim.status }], action: { label: 'Open warranty desk', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Warranty` } });
    return NextResponse.json({ claim }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Inventory item and issue are required.' }, { status: 400 });
    if ((error as { code?: string }).code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Inventory item not found.' }, { status: 404 });
    console.error('Warranty claim create failed', error);
    return NextResponse.json({ error: 'Unable to create warranty claim.' }, { status: 500 });
  }
}
