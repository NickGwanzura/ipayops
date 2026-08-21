import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { notifyOrganizationRoles } from '@/lib/notifications';

const paymentSchema = z.object({
  amount: z.number().positive().max(100000000),
  method: z.enum(['Cash', 'Bank transfer', 'Card', 'Mobile money', 'Other']).default('Bank transfer'),
  reference: z.string().trim().max(120).optional().default(''),
});

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.financeRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(
    `SELECT p.id, p.amount, p.method, p.reference, p.paid_at, u.full_name AS recorded_by
     FROM invoice_payments p LEFT JOIN users u ON u.id = p.created_by
     WHERE p.invoice_id = $1 AND p.organization_id = $2 ORDER BY p.paid_at DESC`,
    [params.id, session.user.organizationId],
  );
  return NextResponse.json({ payments: result.rows });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.finance);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = paymentSchema.parse(await request.json());
    const result = await withTransaction(async client => {
      const invoice = await client.query('SELECT id, total, paid_amount, status FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params.id, session.user.organizationId]);
      if (!invoice.rows[0]) throw Object.assign(new Error('Invoice not found.'), { code: 'NOT_FOUND' });
      if (invoice.rows[0].status === 'Void') throw Object.assign(new Error('Void invoice.'), { code: 'VOID' });
      const outstanding = Number(invoice.rows[0].total) - Number(invoice.rows[0].paid_amount);
      if (body.amount > outstanding + 0.005) throw Object.assign(new Error('Payment exceeds outstanding balance.'), { code: 'OVERPAYMENT' });
      await client.query('INSERT INTO invoice_payments (organization_id, invoice_id, amount, method, reference, created_by) VALUES ($1, $2, $3, $4, $5, $6)', [session.user.organizationId, params.id, body.amount, body.method, body.reference, session.user.id]);
      const paidAmount = Number(invoice.rows[0].paid_amount) + body.amount;
      const status = paidAmount >= Number(invoice.rows[0].total) - 0.005 ? 'Paid' : 'Issued';
      const updated = await client.query('UPDATE invoices SET paid_amount = $1, status = $2, paid_at = CASE WHEN $2 = \'Paid\' THEN now() ELSE paid_at END, payment_reference = NULLIF($3, \'\') WHERE id = $4 RETURNING id, number, total, paid_amount, status, paid_at', [paidAmount, status, body.reference, params.id]);
      return updated.rows[0];
    });
    void notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'invoice.payment_received', subject: `Payment received for invoice ${result.number}`, eyebrow: 'Finance notification', title: 'Invoice payment received', summary: `${session.user.fullName} recorded a payment against an invoice.`, fields: [{ label: 'Invoice', value: result.number }, { label: 'Payment', value: String(body.amount) }, { label: 'Status', value: result.status }, { label: 'Reference', value: body.reference || 'Not provided' }], action: { label: 'Open Finance & HR', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Finance%20%26%20HR` } });
    return NextResponse.json({ invoice: result }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    if (code === 'VOID') return NextResponse.json({ error: 'Void invoices cannot receive payments.' }, { status: 409 });
    if (code === 'OVERPAYMENT') return NextResponse.json({ error: 'Payment exceeds the outstanding balance.' }, { status: 400 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A positive payment amount and valid method are required.' }, { status: 400 });
    console.error('Invoice payment failed', error);
    return NextResponse.json({ error: 'Unable to record payment.' }, { status: 500 });
  }
}
