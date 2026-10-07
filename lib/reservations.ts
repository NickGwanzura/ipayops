type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

/** Frees the stock a quotation was holding (cancelled, expired, or otherwise closed without a sale). */
export async function releaseQuoteReservations(db: Queryable, organizationId: string, quotationId: string) {
  const released = await db.query(
    `UPDATE inventory_reservations SET status = 'Released'
     WHERE organization_id = $1 AND status = 'Active' AND reference_type = 'quotation' AND reference_id = $2
     RETURNING inventory_item_id`,
    [organizationId, quotationId],
  );
  if (released.rows.length) {
    await db.query(
      `UPDATE inventory_items SET status = 'Available', updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'Reserved'`,
      [released.rows.map(row => row.inventory_item_id)],
    );
  }
  return released.rows.length;
}
