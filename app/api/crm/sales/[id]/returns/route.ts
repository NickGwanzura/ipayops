import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';

const returnSchema = z.object({ reason: z.string().trim().min(3).max(500), items: z.array(z.object({ saleItemId: z.string().uuid(), condition: z.enum(['Good', 'Damaged', 'Quarantined']).default('Good') })).min(1) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = returnSchema.parse(await request.json());
    const returned = await withTransaction(async client => {
      const saleResult = await client.query('SELECT id FROM sales WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params.id, session.user.organizationId]);
      if (!saleResult.rows[0]) throw Object.assign(new Error('Sale not found.'), { code: 'SALE_NOT_FOUND' });
      const saleItems = await client.query(
        `SELECT si.id, si.inventory_item_id, si.returned FROM sale_items si WHERE si.sale_id = $1 AND si.id = ANY($2::uuid[]) FOR UPDATE`,
        [params.id, body.items.map(item => item.saleItemId)],
      );
      if (saleItems.rows.length !== body.items.length) throw Object.assign(new Error('Sale item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (saleItems.rows.some(item => item.returned)) throw Object.assign(new Error('Sale item already returned.'), { code: 'ALREADY_RETURNED' });
      const number = `RET-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const returnResult = await client.query(
        `INSERT INTO returns (organization_id, number, sale_id, reason, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, number, status, created_at`,
        [session.user.organizationId, number, params.id, body.reason, session.user.id],
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
