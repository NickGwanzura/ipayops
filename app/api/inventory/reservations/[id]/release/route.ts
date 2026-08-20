import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const released = await withTransaction(async client => {
      const result = await client.query(
        `SELECT id, inventory_item_id FROM inventory_reservations
         WHERE id = $1 AND organization_id = $2 AND status = 'Active' FOR UPDATE`,
        [params.id, session.user.organizationId],
      );
      const reservation = result.rows[0];
      if (!reservation) throw Object.assign(new Error('Reservation not found.'), { code: 'NOT_FOUND' });
      await client.query(`UPDATE inventory_reservations SET status = 'Released' WHERE id = $1`, [params.id]);
      await client.query(`UPDATE inventory_items SET status = 'Available', updated_at = now() WHERE id = $1 AND status = 'Reserved'`, [reservation.inventory_item_id]);
      return reservation;
    });
    return NextResponse.json({ reservation: { ...released, status: 'Released' } });
  } catch (error) {
    if ((error as { code?: string }).code === 'NOT_FOUND') return NextResponse.json({ error: 'Active reservation not found.' }, { status: 404 });
    console.error('Reservation release failed', error);
    return NextResponse.json({ error: 'Unable to release reservation.' }, { status: 500 });
  }
}
