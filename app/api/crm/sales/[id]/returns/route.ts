import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const returnSchema = z.object({ reason: z.string().trim().min(3).max(500), refundAmount: z.number().nonnegative().max(100000000).optional().default(0), refundMethod: z.enum(['Bank transfer', 'Cash', 'Card', 'Mobile money', 'Credit note']).optional(), items: z.array(z.object({ saleItemId: z.string().uuid(), condition: z.enum(['Good', 'Damaged', 'Quarantined']).default('Good') })).min(1) });

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const scope = session.user.role === 'sales_consultant' ? ' AND EXISTS (SELECT 1 FROM sales s WHERE s.id = r.sale_id AND (s.consultant_id = $3 OR s.created_by = $3))' : '';
  const values = session.user.role === 'sales_consultant' ? [params.id, session.user.organizationId, session.user.id] : [params.id, session.user.organizationId];
  const result = await query(`SELECT r.id, r.number, r.status, r.reason, r.refund_amount, r.refund_status, r.refund_method, r.refund_reference, r.credit_note_number, r.refunded_at, r.created_at, u.full_name AS created_by, COALESCE(json_agg(json_build_object('id', ri.id, 'serialNumber', si.serial_number, 'condition', ri.condition) ORDER BY si.serial_number) FILTER (WHERE ri.id IS NOT NULL), '[]'::json) AS items FROM returns r JOIN users u ON u.id = r.created_by LEFT JOIN return_items ri ON ri.return_id = r.id LEFT JOIN sale_items si ON si.id = ri.sale_item_id WHERE r.sale_id = $1 AND r.organization_id = $2${scope} GROUP BY r.id, u.full_name ORDER BY r.created_at DESC`, values);
  return NextResponse.json({ returns: result.rows });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = returnSchema.parse(await request.json());
    const returned = await withTransaction(async client => {
      const scope = session.user.role === 'sales_consultant' ? ' AND (consultant_id = $3 OR created_by = $3)' : '';
      const values = session.user.role === 'sales_consultant' ? [params.id, session.user.organizationId, session.user.id] : [params.id, session.user.organizationId];
      const saleResult = await client.query(`SELECT id FROM sales WHERE id = $1 AND organization_id = $2${scope} FOR UPDATE`, values);
      if (!saleResult.rows[0]) throw Object.assign(new Error('Sale not found.'), { code: 'SALE_NOT_FOUND' });
      const saleItems = await client.query(
        `SELECT si.id, si.inventory_item_id, si.returned FROM sale_items si WHERE si.sale_id = $1 AND si.id = ANY($2::uuid[]) FOR UPDATE`,
        [params.id, body.items.map(item => item.saleItemId)],
      );
      if (saleItems.rows.length !== body.items.length) throw Object.assign(new Error('Sale item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (saleItems.rows.some(item => item.returned)) throw Object.assign(new Error('Sale item already returned.'), { code: 'ALREADY_RETURNED' });
      const number = `RET-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const returnResult = await client.query(
        `INSERT INTO returns (organization_id, number, sale_id, reason, refund_amount, refund_method, refund_status, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, number, status, refund_amount, refund_status, created_at`,
        [session.user.organizationId, number, params.id, body.reason, body.refundAmount, body.refundMethod || null, body.refundAmount > 0 ? 'Pending' : 'Not applicable', session.user.id],
      );
      const conditionByItem = new Map(body.items.map(item => [item.saleItemId, item.condition]));
      for (const item of saleItems.rows) {
        const condition = conditionByItem.get(item.id)!;
        await client.query('INSERT INTO return_items (return_id, sale_item_id, inventory_item_id, condition) VALUES ($1, $2, $3, $4)', [returnResult.rows[0].id, item.id, item.inventory_item_id, condition]);
        await client.query(`UPDATE sale_items SET returned = true WHERE id = $1`, [item.id]);
        await client.query(`UPDATE inventory_items SET status = $1, updated_at = now() WHERE id = $2`, [condition === 'Good' ? 'Available' : 'Quarantined', item.inventory_item_id]);
      }
      const outstanding = await client.query('SELECT COUNT(*)::int AS count FROM sale_items WHERE sale_id = $1 AND returned = false', [params.id]);
      await client.query(`UPDATE sales SET status = $1 WHERE id = $2`, [outstanding.rows[0].count === 0 ? 'Returned' : 'Partially returned', params.id]);
      return returnResult.rows[0];
    });
    return NextResponse.json({ return: returned }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Return reason and at least one sale item are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'SALE_NOT_FOUND' || code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Sale or sale item not found.' }, { status: 404 });
    if (code === 'ALREADY_RETURNED') return NextResponse.json({ error: 'One or more sale items have already been returned.' }, { status: 409 });
    console.error('Sale return failed', error);
    return NextResponse.json({ error: 'Unable to complete return.' }, { status: 500 });
  }
}
