import { NextResponse } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { drawPdfFooter, drawPdfHeader, drawPdfSectionHeading, drawPdfWrappedText, embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo, PDF_INK, PDF_LAYOUT, PDF_MUTED, PDF_PAGE_SIZE } from '@/lib/pdf-brand';
import { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, props: { params: Promise<{ id: string; paymentId: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.documents);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(`SELECT p.id, p.amount, p.method, p.reference, p.paid_at, i.number AS invoice_number,
      i.currency, c.code AS client_code, c.name AS client_name
    FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id JOIN clients c ON c.id = i.client_id
    WHERE p.id = $1 AND c.id = $2 AND p.organization_id = $3`, [params.paymentId, params.id, session.user.organizationId]);
  const payment = result.rows[0];
  if (!payment) return NextResponse.json({ error: 'Payment receipt not found.' }, { status: 404 });

  const settings = await getOrganizationSettings(session.user.organizationId);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(PDF_PAGE_SIZE);
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'payment-receipt', id: payment.id, documentTimestamp: new Date(payment.paid_at).toISOString() });
  let y = drawPdfHeader(page, { logo, qr: qr.image, font, bold, settings, title: 'Payment receipt', subtitle: `PAYMENT-RECEIPT-${payment.id}` });
  y = drawPdfSectionHeading(page, { title: 'Payment details', y, font, bold });
  page.drawText(`Client: ${payment.client_name}`, { x: PDF_LAYOUT.left, y, size: 10, font: bold, color: PDF_INK });
  page.drawText(payment.client_code, { x: 420, y, size: 9, font, color: PDF_MUTED });
  y -= 22;
  page.drawText(`Invoice: ${payment.invoice_number}`, { x: PDF_LAYOUT.left, y, size: 9, font, color: PDF_MUTED });
  page.drawText(`Paid: ${formatOrganizationDate(payment.paid_at, settings)}`, { x: 330, y, size: 9, font, color: PDF_MUTED });
  y -= 34;
  page.drawRectangle({ x: PDF_LAYOUT.left, y: y - 56, width: PDF_LAYOUT.width, height: 78, color: rgb(.94, .98, .96) });
  page.drawText('AMOUNT RECEIVED', { x: 62, y: y - 3, size: 8, font: bold, color: PDF_MUTED });
  page.drawText(formatCurrency(payment.amount, payment.currency || settings.currency), { x: 62, y: y - 28, size: 21, font: bold, color: PDF_INK });
  page.drawText(payment.method, { x: 400, y: y - 17, size: 10, font: bold, color: PDF_INK });
  page.drawText('Payment method', { x: 400, y: y - 32, size: 8, font, color: PDF_MUTED });
  y -= 102;
  y = drawPdfSectionHeading(page, { title: 'Reference', y, font, bold });
  drawPdfWrappedText(page, payment.reference || 'No payment reference recorded.', { x: PDF_LAYOUT.left, y, maxWidth: PDF_LAYOUT.width, font, size: 10, color: payment.reference ? PDF_INK : PDF_MUTED, maxLines: 2 });
  drawPdfFooter(page, { font, generatedAt: formatOrganizationDate(qr.generatedAt, settings), pageNumber: 1, totalPages: 1 });
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="PAYMENT-RECEIPT-${payment.id}.pdf"` } });
}
