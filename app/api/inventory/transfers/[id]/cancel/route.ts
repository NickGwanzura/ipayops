import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const transfer = await withTransaction(async client => {
      const current = await client.query(
        `SELECT id, number, status FROM stock_transfers WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [params.id, session.user.organizationId],
      );
      const row = current.rows[0];
      if (!row) throw Object.assign(new Error('Transfer not found.'), { code: 'NOT_FOUND' });
      if (row.status !== 'In transit') throw Object.assign(new Error('Transfer is not in transit.'), { code: 'NOT_IN_TRANSIT' });
      // Items never changed location while in transit, so releasing them returns them to sellable stock at the source.
      await client.query(
        `UPDATE inventory_items SET status = 'Available', updated_at = now()
         WHERE organization_id = $1 AND status = 'In transit'
           AND id IN (SELECT inventory_item_id FROM stock_transfer_items WHERE transfer_id = $2)`,
        [session.user.organizationId, params.id],
      );
      await client.query(
        `UPDATE shipments SET status = 'Cancelled' WHERE organization_id = $1 AND transfer_id = $2 AND status NOT IN ('Delivered', 'Cancelled')`,
        [session.user.organizationId, params.id],
      );
      const result = await client.query(
        `UPDATE stock_transfers SET status = 'Cancelled' WHERE id = $1 RETURNING id, number, status, source_location, destination_location`,
        [params.id],
      );
      return result.rows[0];
    });
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'stock_transfer.cancelled', entityType: 'stock_transfer', entityId: transfer.id, metadata: { number: transfer.number }, request });
    return NextResponse.json({ transfer });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Stock transfer not found.' }, { status: 404 });
    if (code === 'NOT_IN_TRANSIT') return NextResponse.json({ error: 'Only a transfer that is still in transit can be cancelled.' }, { status: 409 });
    console.error('Inventory transfer cancellation failed', error);
    return NextResponse.json({ error: 'Unable to cancel stock transfer.' }, { status: 500 });
  }
}
