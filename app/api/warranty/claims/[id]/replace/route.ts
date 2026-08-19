import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';

const replacementSchema = z.object({ replacementInventoryItemId: z.string().uuid(), reason: z.string().trim().min(3).max(500) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.field);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = replacementSchema.parse(await request.json());
    const replacement = await withTransaction(async client => {
      const claimResult = await client.query(
        `SELECT id, inventory_item_id, client_id FROM warranty_claims WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [params.id, session.user.organizationId],
      );
      const claim = claimResult.rows[0];
      if (!claim) throw Object.assign(new Error('Warranty claim not found.'), { code: 'CLAIM_NOT_FOUND' });
      const itemResult = await client.query(
        `SELECT id, status, client_name FROM inventory_items WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [body.replacementInventoryItemId, session.user.organizationId],
      );
      const item = itemResult.rows[0];
      if (!item) throw Object.assign(new Error('Replacement item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (item.status !== 'Available') throw Object.assign(new Error('Replacement item is not available.'), { code: 'ITEM_UNAVAILABLE' });
      const result = await client.query(
        `INSERT INTO replacement_items (organization_id, claim_id, original_inventory_item_id, replacement_inventory_item_id, reason)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, claim_id, original_inventory_item_id, replacement_inventory_item_id, reason, created_at`,
        [session.user.organizationId, params.id, claim.inventory_item_id, body.replacementInventoryItemId, body.reason],
      );
      await client.query(`UPDATE inventory_items SET status = 'Installed', client_name = COALESCE((SELECT client_name FROM inventory_items WHERE id = $1), client_name), updated_at = now() WHERE id = $2`, [claim.inventory_item_id, body.replacementInventoryItemId]);
      await client.query(`UPDATE inventory_items SET status = 'Quarantined', updated_at = now() WHERE id = $1`, [claim.inventory_item_id]);
      await client.query(`UPDATE warranty_claims SET status = 'Replacement', resolution = $1, updated_at = now() WHERE id = $2`, [body.reason, params.id]);
      return result.rows[0];
    });
    return NextResponse.json({ replacement }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Replacement inventory item and reason are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'CLAIM_NOT_FOUND' || code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Warranty claim or replacement item not found.' }, { status: 404 });
    if (code === 'ITEM_UNAVAILABLE') return NextResponse.json({ error: 'Replacement item is not available.' }, { status: 409 });
    if (code === '23505') return NextResponse.json({ error: 'This claim already has a replacement.' }, { status: 409 });
    console.error('Warranty replacement failed', error);
    return NextResponse.json({ error: 'Unable to complete warranty replacement.' }, { status: 500 });
  }
}
