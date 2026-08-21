import { NextResponse } from 'next/server';
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { drawPdfFooter, drawPdfHeader, drawPdfSectionHeading, drawPdfTableHeader, embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo, PDF_INK, PDF_LAYOUT, PDF_MUTED, PDF_PAGE_SIZE } from '@/lib/pdf-brand';
import { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.documents);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const clientResult = await query(`SELECT id, code, name, email, phone, created_at FROM clients WHERE id = $1 AND organization_id = $2`, [params.id, session.user.organizationId]);
  const client = clientResult.rows[0];
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
  const [invoicesResult, paymentsResult] = await Promise.all([
    query(`SELECT i.number, i.status, i.total, i.paid_amount, (i.total - i.paid_amount) AS outstanding, i.issued_at, i.due_at, i.currency FROM invoices i WHERE i.client_id = $1 AND i.organization_id = $2 ORDER BY i.issued_at DESC`, [params.id, session.user.organizationId]),
    query(`SELECT p.amount, p.method, p.reference, p.paid_at, i.number AS invoice_number FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.organization_id = $1 AND i.client_id = $2 ORDER BY p.paid_at DESC`, [session.user.organizationId, params.id]),
  ]);
  const settings = await getOrganizationSettings(session.user.organizationId);
  const pdf = await PDFDocument.create();
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'client-statement', id: params.id, documentTimestamp: new Date(client.created_at).toISOString() });
  const invoices = invoicesResult.rows;
  const payments = paymentsResult.rows;
  const totalInvoiced = invoices.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalPaid = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pages: PDFPage[] = [];
  const addPage = (continued = false) => {
    const page = pdf.addPage(PDF_PAGE_SIZE);
    let y = drawPdfHeader(page, { logo, qr: qr.image, font, bold, settings, title: 'Client statement', subtitle: continued ? `${client.code} · continued` : `${client.code} · Account activity` });
    if (!continued) {
      y = drawPdfSectionHeading(page, { title: 'Account summary', y, font, bold });
      page.drawText(`Client: ${client.name}`, { x: PDF_LAYOUT.left, y, size: 10, font: bold, color: PDF_INK });
      page.drawText(`Account: ${client.code}`, { x: 420, y, size: 9, font, color: PDF_MUTED });
      y -= 18;
      page.drawText(`Contact: ${client.email || client.phone || 'No contact recorded'}`, { x: PDF_LAYOUT.left, y, size: 8.5, font, color: PDF_MUTED });
      y -= 28;
      page.drawRectangle({ x: PDF_LAYOUT.left, y: y - 30, width: PDF_LAYOUT.width, height: 50, color: rgb(.94, .96, .98) });
      page.drawText('INVOICED', { x: 58, y: y + 2, size: 7.5, font: bold, color: PDF_MUTED });
      page.drawText(formatCurrency(totalInvoiced, settings.currency), { x: 58, y: y - 16, size: 12, font: bold, color: PDF_INK });
      page.drawText('PAID', { x: 230, y: y + 2, size: 7.5, font: bold, color: PDF_MUTED });
      page.drawText(formatCurrency(totalPaid, settings.currency), { x: 230, y: y - 16, size: 12, font: bold, color: PDF_INK });
      page.drawText('OUTSTANDING', { x: 400, y: y + 2, size: 7.5, font: bold, color: PDF_MUTED });
      page.drawText(formatCurrency(Math.max(0, totalInvoiced - totalPaid), settings.currency), { x: 400, y: y - 16, size: 12, font: bold, color: PDF_INK });
      y -= 72;
    } else y -= 12;
    pages.push(page);
    return { page, y };
  };
  const invoiceHeader = (current: { page: typeof pages[number]; y: number }) => {
    current.y = drawPdfSectionHeading(current.page, { title: 'Invoices', y: current.y, font, bold });
    current.y = drawPdfTableHeader(current.page, { y: current.y, columns: [{ label: 'Invoice', x: 50 }, { label: 'Issued', x: 170 }, { label: 'Status', x: 300 }, { label: 'Outstanding', x: 450 }], font: bold });
  };
  let current = addPage();
  invoiceHeader(current);
  for (const item of invoices) {
    if (current.y < 112) { current = addPage(true); invoiceHeader(current); }
    current.page.drawText(item.number, { x: 50, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawText(item.issued_at ? formatOrganizationDate(item.issued_at, settings) : '—', { x: 170, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawText(item.status || '—', { x: 300, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawText(formatCurrency(item.outstanding, item.currency || settings.currency), { x: 450, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawLine({ start: { x: 50, y: current.y - 9 }, end: { x: PDF_LAYOUT.right, y: current.y - 9 }, thickness: .5, color: rgb(.9, .92, .95) });
    current.y -= 21;
  }
  if (!invoices.length) { current.page.drawText('No invoices recorded.', { x: 50, y: current.y, size: 9, font, color: PDF_MUTED }); current.y -= 22; }
  current.y -= 16;
  if (current.y < 150) current = addPage(true);
  current.y = drawPdfSectionHeading(current.page, { title: 'Payment receipts', y: current.y, font, bold });
  current.y = drawPdfTableHeader(current.page, { y: current.y, columns: [{ label: 'Invoice', x: 50 }, { label: 'Paid', x: 170 }, { label: 'Method', x: 300 }, { label: 'Amount', x: 450 }], font: bold });
  for (const item of payments) {
    if (current.y < 112) { current = addPage(true); current.y = drawPdfSectionHeading(current.page, { title: 'Payment receipts · continued', y: current.y, font, bold }); current.y = drawPdfTableHeader(current.page, { y: current.y, columns: [{ label: 'Invoice', x: 50 }, { label: 'Paid', x: 170 }, { label: 'Method', x: 300 }, { label: 'Amount', x: 450 }], font: bold }); }
    current.page.drawText(item.invoice_number, { x: 50, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawText(item.paid_at ? formatOrganizationDate(item.paid_at, settings) : '—', { x: 170, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawText(item.method || '—', { x: 300, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawText(formatCurrency(item.amount, settings.currency), { x: 450, y: current.y, size: 8.5, font, color: PDF_INK });
    current.page.drawLine({ start: { x: 50, y: current.y - 9 }, end: { x: PDF_LAYOUT.right, y: current.y - 9 }, thickness: .5, color: rgb(.9, .92, .95) });
    current.y -= 21;
  }
  if (!payments.length) current.page.drawText('No payment receipts recorded.', { x: 50, y: current.y, size: 9, font, color: PDF_MUTED });
  pages.forEach((page, index) => drawPdfFooter(page, { font, generatedAt: formatOrganizationDate(qr.generatedAt, settings), pageNumber: index + 1, totalPages: pages.length }));
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${client.code}-statement.pdf"` } });
}
