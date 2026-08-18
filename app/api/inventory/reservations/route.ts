import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { getSession } from '@/lib/auth';

const reservationSchema = z.object({
  inventoryItemId: z.string().uuid(),
  referenceType: z.string().trim().min(1).max(40),
  referenceId: z.string().trim().min(1).max(120),
  expiresAt: z.string().datetime().optional(),
});

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = reservationSchema.parse(await request.json());
    const reservation = await withTransaction(async client => {
      const itemResult = await client.query(
        `SELECT id, status FROM inventory_items
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [body.inventoryItemId, session.user.organizationId],
      );
      const item = itemResult.rows[0];
      if (!item) throw Object.assign(new Error('Inventory item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (item.status !== 'Available') throw Object.assign(new Error('Inventory item is not available.'), { code: 'ITEM_UNAVAILABLE' });
      const result = await client.query(
        `INSERT INTO inventory_reservations (organization_id, inventory_item_id, reference_type, reference_id, reserved_by, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, inventory_item_id, reference_type, reference_id, expires_at, status, created_at`,
        [session.user.organizationId, body.inventoryItemId, body.referenceType, body.referenceId, session.user.id, body.expiresAt || null],
      );
      await client.query('UPDATE inventory_items SET status = \'Reserved\', updated_at = now() WHERE id = $1', [body.inventoryItemId]);
      return result.rows[0];
    });
    return NextResponse.json({ reservation }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Inventory item, reference type, and reference ID are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Inventory item not found.' }, { status: 404 });
    if (code === 'ITEM_UNAVAILABLE' || code === '23505') return NextResponse.json({ error: 'Inventory item is no longer available.' }, { status: 409 });
    console.error('Reservation failed', error);
    return NextResponse.json({ error: 'Unable to reserve inventory.' }, { status: 500 });
  }
}
