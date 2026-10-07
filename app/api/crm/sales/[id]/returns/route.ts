import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { notifyOrganizationRoles } from '@/lib/notifications';

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
      const requestedItemIds = body.items.map(item => item.saleItemId);
      if (new Set(requestedItemIds).size !== requestedItemIds.length) throw Object.assign(new Error('Sale items must be unique.'), { code: 'DUPLICATE_ITEMS' });
      const saleItems = await client.query(
        `SELECT si.id, si.inventory_item_id, si.amount, si.returned FROM sale_items si WHERE si.sale_id = $1 AND si.id = ANY($2::uuid[]) FOR UPDATE`,
        [params.id, body.items.map(item => item.saleItemId)],
      );
      if (saleItems.rows.length !== body.items.length) throw Object.assign(new Error('Sale item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (saleItems.rows.some(item => item.returned)) throw Object.assign(new Error('Sale item already returned.'), { code: 'ALREADY_RETURNED' });
      if (body.refundAmount > 0 && !body.refundMethod) throw Object.assign(new Error('A refund method is required for positive refunds.'), { code: 'REFUND_METHOD_REQUIRED' });
      const selectedValue = saleItems.rows.reduce((sum, item) => sum + Number(item.amount), 0);
      if (body.refundAmount > selectedValue) throw Object.assign(new Error('Refund exceeds the value of selected sale items.'), { code: 'REFUND_EXCEEDS_ITEMS' });
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
      const outstanding = await client.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS amount FROM sale_items WHERE sale_id = $1 AND returned = false', [params.id]);
      await client.query(`UPDATE sales SET status = $1 WHERE id = $2`, [outstanding.rows[0].count === 0 ? 'Returned' : 'Partially returned', params.id]);
      const remainingValue = Number(outstanding.rows[0].amount);
      // Keep downstream money in step with the return: a provisional commission follows the kept items, and an unpaid invoice shrinks (or voids) with them.
      // Unpaid commission shrinks (or voids); paid commission is untouched and the amount to recover is recorded as a clawback.
      await client.query(`UPDATE commission_entries SET
        amount = CASE WHEN status IN ('Provisional', 'Approved') THEN ROUND(rate * $2::numeric / 100, 2) ELSE amount END,
        clawback_amount = CASE WHEN status = 'Paid' THEN GREATEST(0, amount - ROUND(rate * $2::numeric / 100, 2)) ELSE clawback_amount END,
        status = CASE WHEN $2::numeric = 0 AND status IN ('Provisional', 'Approved') THEN 'Voided' ELSE status END
        WHERE sale_id = $1 AND status IN ('Provisional', 'Approved', 'Paid')`, [params.id, remainingValue]);
      // The invoice shrinks to the items kept, whether or not it was already paid (payments are kept so any refund can be validated).
      // A credit note is issued against the invoice for the returned value.
      const adjustable = await client.query(`SELECT id FROM invoices WHERE sale_id = $1 AND status IN ('Draft', 'Issued', 'Paid') FOR UPDATE`, [params.id]);
      if (adjustable.rows[0]) {
        await client.query('DELETE FROM invoice_items WHERE invoice_id = $1 AND sale_item_id = ANY($2::uuid[])', [adjustable.rows[0].id, requestedItemIds]);
        await client.query(`UPDATE invoices SET total = $2,
          status = CASE WHEN $2::numeric = 0 THEN 'Void' WHEN status = 'Draft' AND paid_amount = 0 THEN 'Draft' WHEN paid_amount >= $2::numeric - 0.005 THEN 'Paid' ELSE 'Issued' END,
          paid_at = CASE WHEN $2::numeric > 0 AND paid_amount >= $2::numeric - 0.005 THEN COALESCE(paid_at, now()) ELSE paid_at END
          WHERE id = $1`, [adjustable.rows[0].id, remainingValue]);
        await client.query('UPDATE returns SET credit_note_number = COALESCE(credit_note_number, $2) WHERE id = $1', [returnResult.rows[0].id, `CN-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`]);
      }
      return returnResult.rows[0];
    });
    const settled = await query(`SELECT clawback_amount FROM commission_entries WHERE sale_id = $1 AND organization_id = $2 AND status = 'Paid' AND clawback_amount > 0 LIMIT 1`, [params.id, session.user.organizationId]);
    if (settled.rows[0]) await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'commission.review_required', subject: `Commission clawback due after return ${returned.number}`, eyebrow: 'Returns and finance', title: 'Paid commission must be recovered', summary: 'Items were returned on a sale whose commission was already paid. The amount to recover is recorded against the commission entry.', fields: [{ label: 'Return', value: returned.number }, { label: 'Clawback due', value: String(settled.rows[0].clawback_amount) }], action: { label: 'Open commissions', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Finance%20%26%20HR&view=commissions` } }).catch(notificationError => console.error('Commission review notification failed', notificationError));
    return NextResponse.json({ return: returned }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Return reason and at least one sale item are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'SALE_NOT_FOUND' || code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Sale or sale item not found.' }, { status: 404 });
    if (code === 'ALREADY_RETURNED') return NextResponse.json({ error: 'One or more sale items have already been returned.' }, { status: 409 });
    if (code === 'DUPLICATE_ITEMS' || code === 'REFUND_EXCEEDS_ITEMS') return NextResponse.json({ error: 'Return validation failed.' }, { status: 409 });
    if (code === 'REFUND_METHOD_REQUIRED') return NextResponse.json({ error: 'A refund method is required when refundAmount is greater than zero.' }, { status: 400 });
    console.error('Sale return failed', error);
    return NextResponse.json({ error: 'Unable to complete return.' }, { status: 500 });
  }
}
