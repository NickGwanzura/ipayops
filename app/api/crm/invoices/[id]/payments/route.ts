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
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
    if (idempotencyKey && !/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) return NextResponse.json({ error: 'Idempotency-Key must contain 1–128 safe characters.' }, { status: 400 });
    const body = paymentSchema.parse(await request.json());
    const payment = await withTransaction(async client => {
      const invoice = await client.query('SELECT id, total, paid_amount, status FROM invoices WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params.id, session.user.organizationId]);
      if (!invoice.rows[0]) throw Object.assign(new Error('Invoice not found.'), { code: 'NOT_FOUND' });
      if (invoice.rows[0].status === 'Void') throw Object.assign(new Error('Void invoice.'), { code: 'VOID' });
      if (idempotencyKey) {
        const existing = await client.query(
          `SELECT i.id, i.number, i.total, i.paid_amount, i.status, i.paid_at
           FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
           WHERE p.organization_id = $1 AND p.idempotency_key = $2 AND i.organization_id = $1
           LIMIT 1`,
          [session.user.organizationId, idempotencyKey],
        );
        if (existing.rows[0]) return { invoice: existing.rows[0], replayed: true };
      }
      const outstanding = Number(invoice.rows[0].total) - Number(invoice.rows[0].paid_amount);
      if (body.amount > outstanding + 0.005) throw Object.assign(new Error('Payment exceeds outstanding balance.'), { code: 'OVERPAYMENT' });
      await client.query('INSERT INTO invoice_payments (organization_id, invoice_id, amount, method, reference, created_by, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6, $7)', [session.user.organizationId, params.id, body.amount, body.method, body.reference, session.user.id, idempotencyKey]);
      const paidAmount = Number(invoice.rows[0].paid_amount) + body.amount;
      const status = paidAmount >= Number(invoice.rows[0].total) - 0.005 ? 'Paid' : 'Issued';
      const updated = await client.query('UPDATE invoices SET paid_amount = $1, status = $2, paid_at = CASE WHEN $2 = \'Paid\' THEN now() ELSE paid_at END, payment_reference = NULLIF($3, \'\') WHERE id = $4 RETURNING id, number, total, paid_amount, status, paid_at', [paidAmount, status, body.reference, params.id]);
      return { invoice: updated.rows[0], replayed: false };
    });
    if (!payment.replayed) {
      try {
        await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'invoice.payment_received', subject: `Payment received for invoice ${payment.invoice.number}`, eyebrow: 'Finance notification', title: 'Invoice payment received', summary: `${session.user.fullName} recorded a payment against an invoice.`, fields: [{ label: 'Invoice', value: payment.invoice.number }, { label: 'Payment', value: String(body.amount) }, { label: 'Status', value: payment.invoice.status }, { label: 'Reference', value: body.reference || 'Not provided' }], action: { label: 'Open invoices & payments', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Finance%20%26%20HR&view=invoices` } });
      } catch (notificationError) {
        console.error('Invoice payment notification failed after commit', notificationError);
      }
    }
    return NextResponse.json({ invoice: payment.invoice, replayed: payment.replayed }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
    if (code === 'VOID') return NextResponse.json({ error: 'Void invoices cannot receive payments.' }, { status: 409 });
    if (code === 'OVERPAYMENT') return NextResponse.json({ error: 'Payment exceeds the outstanding balance.' }, { status: 400 });
    if (code === '23505') return NextResponse.json({ error: 'This payment request has already been used.' }, { status: 409 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A positive payment amount and valid method are required.' }, { status: 400 });
    console.error('Invoice payment failed', error);
    return NextResponse.json({ error: 'Unable to record payment.' }, { status: 500 });
  }
}
