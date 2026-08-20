import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo } from '@/lib/pdf-brand';
import { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, props: { params: Promise<{ id: string; paymentId: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.documents);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(
    `SELECT p.id, p.amount, p.method, p.reference, p.paid_at, i.number AS invoice_number,
            i.currency, c.code AS client_code, c.name AS client_name
     FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
     WHERE p.id = $1 AND c.id = $2 AND p.organization_id = $3`,
    [params.paymentId, params.id, session.user.organizationId],
  );
  const payment = result.rows[0];
  if (!payment) return NextResponse.json({ error: 'Payment receipt not found.' }, { status: 404 });
  const settings = await getOrganizationSettings(session.user.organizationId);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'payment-receipt', id: payment.id, documentTimestamp: new Date(payment.paid_at).toISOString() });
  page.drawImage(logo, { x: 44, y: 730, width: 175, height: 73 });
  page.drawImage(qr.image, { x: 482, y: 735, width: 78, height: 78 });
  page.drawText(settings.address, { x: 240, y: 780, size: 8, font });
  page.drawText(settings.phone, { x: 240, y: 766, size: 8, font });
  page.drawText('PAYMENT RECEIPT', { x: 48, y: 700, size: 14, font: bold });
  page.drawText(`Receipt: PAYMENT-RECEIPT-${payment.id}`, { x: 48, y: 675, size: 9, font });
  page.drawText(`Client: ${payment.client_name} (${payment.client_code})`, { x: 48, y: 650, size: 10, font });
  page.drawText(`Invoice: ${payment.invoice_number}`, { x: 48, y: 628, size: 10, font });
  page.drawText(`Paid: ${formatOrganizationDate(payment.paid_at, settings)}`, { x: 48, y: 606, size: 10, font });
  page.drawText(`Method: ${payment.method}`, { x: 48, y: 584, size: 10, font });
  page.drawText(`Reference: ${payment.reference || '—'}`, { x: 48, y: 562, size: 10, font });
  page.drawText(`Amount received: ${formatCurrency(payment.amount, settings.currency)}`, { x: 48, y: 510, size: 15, font: bold });
  page.drawText(`Generated ${qr.generatedAt} · Scan QR to verify authenticity`, { x: 48, y: 34, size: 7, font });
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="PAYMENT-RECEIPT-${payment.id}.pdf"` } });
}
