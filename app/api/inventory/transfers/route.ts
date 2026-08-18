import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const transferSchema = z.object({
  sourceLocation: z.string().trim().min(1).max(160),
  destinationLocation: z.string().trim().min(1).max(160),
  inventoryItemIds: z.array(z.string().uuid()).min(1).max(200),
}).refine(value => value.sourceLocation !== value.destinationLocation, { message: 'Transfer locations must be different.' });

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(
    `SELECT st.id, st.number, st.source_location, st.destination_location, st.status, st.dispatched_at, st.received_at, st.created_at,
            COALESCE(json_agg(json_build_object('id', sti.inventory_item_id, 'serialNumber', sti.serial_number, 'sku', sti.sku, 'description', sti.description)
              ORDER BY sti.serial_number) FILTER (WHERE sti.id IS NOT NULL), '[]'::json) AS items
     FROM stock_transfers st
     LEFT JOIN stock_transfer_items sti ON sti.transfer_id = st.id
     WHERE st.organization_id = $1
     GROUP BY st.id ORDER BY st.created_at DESC LIMIT 200`,
    [session.user.organizationId],
  );
  return NextResponse.json({ transfers: result.rows });
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = transferSchema.parse(await request.json());
    const transfer = await withTransaction(async client => {
      const items = await client.query(
        `SELECT id, serial_number, sku, description, location, status
         FROM inventory_items WHERE organization_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [session.user.organizationId, body.inventoryItemIds],
      );
      if (items.rows.length !== new Set(body.inventoryItemIds).size) throw Object.assign(new Error('Inventory item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (items.rows.some(item => item.location !== body.sourceLocation)) throw Object.assign(new Error('Inventory item is not at the source location.'), { code: 'WRONG_LOCATION' });
      if (items.rows.some(item => item.status !== 'Available')) throw Object.assign(new Error('Only available inventory can be transferred.'), { code: 'ITEM_UNAVAILABLE' });
      const number = `TR-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const header = await client.query(
        `INSERT INTO stock_transfers (organization_id, number, source_location, destination_location, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, number, status, source_location, destination_location, dispatched_at`,
        [session.user.organizationId, number, body.sourceLocation, body.destinationLocation, session.user.id],
      );
      for (const item of items.rows) {
        await client.query(
          `INSERT INTO stock_transfer_items (transfer_id, inventory_item_id, serial_number, sku, description)
           VALUES ($1, $2, $3, $4, $5)`,
          [header.rows[0].id, item.id, item.serial_number, item.sku, item.description],
        );
      }
      await client.query(
        `UPDATE inventory_items SET status = 'In transit', updated_at = now() WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
        [session.user.organizationId, body.inventoryItemIds],
      );
      return header.rows[0];
    });
    return NextResponse.json({ transfer }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Source, destination, and at least one inventory item are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'One or more inventory items were not found.' }, { status: 404 });
    if (code === 'WRONG_LOCATION') return NextResponse.json({ error: 'All items must be at the source location.' }, { status: 409 });
    if (code === 'ITEM_UNAVAILABLE') return NextResponse.json({ error: 'Only available inventory can be transferred.' }, { status: 409 });
    console.error('Inventory transfer failed', error);
    return NextResponse.json({ error: 'Unable to create stock transfer.' }, { status: 500 });
  }
}
