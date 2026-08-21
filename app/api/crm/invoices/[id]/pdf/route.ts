import { NextResponse } from 'next/server';
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { drawPdfFooter, drawPdfHeader, drawPdfSectionHeading, drawPdfTableHeader, drawPdfWrappedText, embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo, PDF_INK, PDF_LAYOUT, PDF_MUTED, PDF_PAGE_SIZE } from '@/lib/pdf-brand';
import { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.documents);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(`SELECT i.number, i.total, i.issued_at, i.due_at, i.status, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
      COALESCE(json_agg(json_build_object('description', ii.description, 'amount', ii.amount) ORDER BY ii.id) FILTER (WHERE ii.id IS NOT NULL), '[]'::json) AS items
    FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN invoice_items ii ON ii.invoice_id = i.id
    WHERE i.id = $1 AND i.organization_id = $2 GROUP BY i.id, c.id`, [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });

  const settings = await getOrganizationSettings(session.user.organizationId);
  const invoice = result.rows[0];
  const pdf = await PDFDocument.create();
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'invoice', id: params.id, documentTimestamp: new Date(invoice.issued_at).toISOString() });
  const pages: PDFPage[] = [];
  const addPage = (continued = false) => {
    const page = pdf.addPage(PDF_PAGE_SIZE);
    let y = drawPdfHeader(page, { logo, qr: qr.image, font, bold, settings, title: 'Invoice', subtitle: continued ? `${invoice.number} · continued` : `${invoice.number} · Tax invoice` });
    if (!continued) {
      y = drawPdfSectionHeading(page, { title: 'Invoice details', y, font, bold });
      page.drawText(`Client: ${invoice.client_name}`, { x: PDF_LAYOUT.left, y, size: 10, font: bold, color: PDF_INK });
      page.drawText(`Status: ${invoice.status}`, { x: 370, y, size: 9, font, color: PDF_MUTED });
      y -= 18;
      page.drawText(`Issued: ${formatOrganizationDate(invoice.issued_at, settings)}`, { x: PDF_LAYOUT.left, y, size: 9, font, color: PDF_MUTED });
      page.drawText(`Due: ${invoice.due_at ? formatOrganizationDate(invoice.due_at, settings) : 'Not specified'}`, { x: 370, y, size: 9, font, color: PDF_MUTED });
      y -= 17;
      drawPdfWrappedText(page, `Contact: ${invoice.client_email || invoice.client_phone || 'No contact recorded'}`, { x: PDF_LAYOUT.left, y, maxWidth: PDF_LAYOUT.width, font, size: 8.5, color: PDF_MUTED, maxLines: 1 });
      y -= 28;
    } else {
      y -= 12;
    }
    y = drawPdfTableHeader(page, { y, columns: [{ label: 'Description', x: 50 }, { label: 'Amount', x: 450 }], font: bold });
    pages.push(page);
    return { page, y };
  };

  let current = addPage();
  for (const item of invoice.items as Array<{ description: string; amount: string | number }>) {
    if (current.y < 112) current = addPage(true);
    const nextY = drawPdfWrappedText(current.page, item.description, { x: 50, y: current.y, maxWidth: 350, font, size: 9, maxLines: 2 });
    current.page.drawText(formatCurrency(item.amount, settings.currency), { x: 450, y: current.y, size: 9, font, color: PDF_INK });
    current.page.drawLine({ start: { x: 50, y: current.y - 10 }, end: { x: PDF_LAYOUT.right, y: current.y - 10 }, thickness: 0.5, color: rgb(.9, .92, .95) });
    current.y = Math.min(current.y - 22, nextY - 9);
  }
  if (!invoice.items.length) {
    drawPdfWrappedText(current.page, 'No line items recorded.', { x: 50, y: current.y, maxWidth: PDF_LAYOUT.width, font, size: 9, color: PDF_MUTED });
    current.y -= 28;
  }
  if (current.y < 125) current = addPage(true);
  current.y -= 15;
  current.page.drawRectangle({ x: 350, y: current.y - 16, width: 203, height: 42, color: rgb(.94, .98, .96) });
  current.page.drawText('TOTAL DUE', { x: 365, y: current.y + 5, size: 8, font: bold, color: PDF_MUTED });
  current.page.drawText(formatCurrency(invoice.total, settings.currency), { x: 365, y: current.y - 10, size: 14, font: bold, color: PDF_INK });
  pages.forEach((page, index) => drawPdfFooter(page, { font, generatedAt: formatOrganizationDate(qr.generatedAt, settings), pageNumber: index + 1, totalPages: pages.length }));
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.number}.pdf"` } });
}
