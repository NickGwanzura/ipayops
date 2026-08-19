import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const transfer = await withTransaction(async client => {
      const transferResult = await client.query(
        `SELECT id, destination_location, status FROM stock_transfers
         WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [params.id, session.user.organizationId],
      );
      const row = transferResult.rows[0];
      if (!row) throw Object.assign(new Error('Transfer not found.'), { code: 'NOT_FOUND' });
      if (row.status !== 'In transit') throw Object.assign(new Error('Transfer is not in transit.'), { code: 'NOT_IN_TRANSIT' });
      await client.query(
        `UPDATE inventory_items SET status = 'Available', location = $1, updated_at = now()
         WHERE organization_id = $2 AND id IN (SELECT inventory_item_id FROM stock_transfer_items WHERE transfer_id = $3)`,
        [row.destination_location, session.user.organizationId, params.id],
      );
      const result = await client.query(
        `UPDATE stock_transfers SET status = 'Received', received_at = now() WHERE id = $1
         RETURNING id, number, status, source_location, destination_location, dispatched_at, received_at`,
        [params.id],
      );
      return result.rows[0];
    });
    return NextResponse.json({ transfer });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Stock transfer not found.' }, { status: 404 });
    if (code === 'NOT_IN_TRANSIT') return NextResponse.json({ error: 'Stock transfer is not in transit.' }, { status: 409 });
    console.error('Inventory transfer receipt failed', error);
    return NextResponse.json({ error: 'Unable to receive stock transfer.' }, { status: 500 });
  }
}
