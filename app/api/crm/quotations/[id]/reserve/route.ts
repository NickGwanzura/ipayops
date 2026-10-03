import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';
import { releaseQuoteReservations } from '@/lib/reservations';

const reserveSchema = z.object({ inventoryItemIds: z.array(z.string().uuid()).min(1).max(200) });
const HOLD_DAYS = 7;

/** Holds exact serialized units for one of the caller's open quotations so nobody else can sell them. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = reserveSchema.parse(await request.json());
    const ids = Array.from(new Set(body.inventoryItemIds));
    const reserved = await withTransaction(async client => {
      const consultantOnly = session.user.role === 'sales_consultant';
      const quote = await client.query(
        `SELECT id, status FROM quotations WHERE id = $1 AND organization_id = $2 AND ($3::uuid IS NULL OR created_by = $3) FOR UPDATE`,
        [params.id, session.user.organizationId, consultantOnly ? session.user.id : null],
      );
      if (!quote.rows[0]) throw Object.assign(new Error('Quotation not found.'), { code: 'NOT_FOUND' });
      if (!['Draft', 'Sent', 'Accepted'].includes(quote.rows[0].status)) throw Object.assign(new Error('Quotation is closed.'), { code: 'CLOSED' });
      const lines = await client.query('SELECT sku, SUM(quantity)::int AS quantity FROM quotation_items WHERE quotation_id = $1 GROUP BY sku', [params.id]);
      const allowance = new Map(lines.rows.map(line => [String(line.sku), Number(line.quantity)]));
      const held = await client.query(
        `SELECT i.sku, COUNT(*)::int AS count FROM inventory_reservations r JOIN inventory_items i ON i.id = r.inventory_item_id
         WHERE r.organization_id = $1 AND r.status = 'Active' AND r.reference_type = 'quotation' AND r.reference_id = $2 GROUP BY i.sku`,
        [session.user.organizationId, params.id],
      );
      for (const row of held.rows) allowance.set(String(row.sku), (allowance.get(String(row.sku)) || 0) - Number(row.count));
      const items = await client.query(
        `SELECT id, sku, status FROM inventory_items WHERE organization_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [session.user.organizationId, ids],
      );
      if (items.rows.length !== ids.length) throw Object.assign(new Error('Inventory item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (items.rows.some(item => item.status !== 'Available')) throw Object.assign(new Error('Inventory item is not available.'), { code: 'ITEM_UNAVAILABLE' });
      for (const item of items.rows) {
        const remaining = allowance.get(String(item.sku)) ?? 0;
        if (remaining <= 0) throw Object.assign(new Error('Unit is not needed by this quotation.'), { code: 'NOT_ON_QUOTE' });
        allowance.set(String(item.sku), remaining - 1);
      }
      for (const item of items.rows) {
        await client.query(
          `INSERT INTO inventory_reservations (organization_id, inventory_item_id, reference_type, reference_id, reserved_by, expires_at)
           VALUES ($1, $2, 'quotation', $3, $4, now() + ($5::int * interval '1 day'))`,
          [session.user.organizationId, item.id, params.id, session.user.id, HOLD_DAYS],
        );
        await client.query(`UPDATE inventory_items SET status = 'Reserved', updated_at = now() WHERE id = $1`, [item.id]);
      }
      return items.rows.length;
    });
    return NextResponse.json({ reserved, holdDays: HOLD_DAYS }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Choose at least one inventory unit to reserve.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND' || code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Quotation or inventory item not found.' }, { status: 404 });
    if (code === 'CLOSED') return NextResponse.json({ error: 'Stock can only be reserved for an open quotation.' }, { status: 409 });
    if (code === 'ITEM_UNAVAILABLE' || code === '23505') return NextResponse.json({ error: 'One or more units are no longer available.' }, { status: 409 });
    if (code === 'NOT_ON_QUOTE') return NextResponse.json({ error: 'Reserve only the SKUs and quantities this quotation needs.' }, { status: 409 });
    console.error('Quotation reservation failed', error);
    return NextResponse.json({ error: 'Unable to reserve stock for this quotation.' }, { status: 500 });
  }
}

/** Releases every hold this quotation has. */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const released = await withTransaction(async client => {
      const quote = await client.query(
        `SELECT id FROM quotations WHERE id = $1 AND organization_id = $2 AND ($3::uuid IS NULL OR created_by = $3)`,
        [params.id, session.user.organizationId, session.user.role === 'sales_consultant' ? session.user.id : null],
      );
      if (!quote.rows[0]) return null;
      return releaseQuoteReservations(client, session.user.organizationId, params.id);
    });
    if (released === null) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
    return NextResponse.json({ released });
  } catch (error) {
    console.error('Quotation reservation release failed', error);
    return NextResponse.json({ error: 'Unable to release reserved stock.' }, { status: 500 });
  }
}
