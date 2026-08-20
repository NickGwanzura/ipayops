import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const clientResult = await query(
    `SELECT id, code, name, client_type, contact_name, email, phone, address, status, created_at
     FROM clients WHERE id = $1 AND organization_id = $2`,
    [params.id, session.user.organizationId],
  );
  const client = clientResult.rows[0];
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
  const [invoiceResult, paymentResult, salesResult] = await Promise.all([
    query(
      `SELECT i.id, i.number, i.status, i.total, i.paid_amount, (i.total - i.paid_amount) AS outstanding,
              i.currency, i.issued_at, i.due_at, s.number AS sale_number
       FROM invoices i JOIN sales s ON s.id = i.sale_id
       WHERE i.client_id = $1 AND i.organization_id = $2 ORDER BY i.issued_at DESC`,
      [params.id, session.user.organizationId],
    ),
    query(
      `SELECT p.id, p.invoice_id, p.amount, p.method, p.reference, p.paid_at, p.created_at,
              i.number AS invoice_number, u.full_name AS recorded_by
       FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.organization_id = $1 AND i.client_id = $2 ORDER BY p.paid_at DESC`,
      [session.user.organizationId, params.id],
    ),
    query(
      `SELECT id, number, status, total, currency, confirmed_at, created_at
       FROM sales WHERE client_id = $1 AND organization_id = $2 ORDER BY created_at DESC`,
      [params.id, session.user.organizationId],
    ),
  ]);
  const invoices = invoiceResult.rows;
  const payments = paymentResult.rows;
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const totalPaid = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  return NextResponse.json({
    client,
    summary: { totalInvoiced, totalPaid, outstanding: Math.max(0, totalInvoiced - totalPaid), invoiceCount: invoices.length, paymentCount: payments.length },
    invoices,
    payments,
    sales: salesResult.rows,
  });
}
