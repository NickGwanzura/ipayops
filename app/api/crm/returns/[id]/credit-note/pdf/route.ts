import { NextResponse } from 'next/server';
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { drawPdfFooter, drawPdfHeader, drawPdfSectionHeading, drawPdfTableHeader, drawPdfWrappedText, embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo, PDF_INK, PDF_LAYOUT, PDF_MUTED, PDF_PAGE_SIZE } from '@/lib/pdf-brand';
import { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

type CreditLine = { serialNumber: string; description: string; amount: string | number };

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.documents);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const consultantOnly = session.user.role === 'sales_consultant';
  const result = await query(
    `SELECT r.number AS return_number, r.credit_note_number, r.reason, r.created_at, r.refund_amount, r.refund_status, r.refund_method,
            s.number AS sale_number, inv.number AS invoice_number, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
            COALESCE(json_agg(json_build_object('serialNumber', si.serial_number, 'description', si.description, 'amount', si.amount) ORDER BY si.serial_number) FILTER (WHERE si.id IS NOT NULL), '[]'::json) AS items
     FROM returns r
     JOIN sales s ON s.id = r.sale_id
     JOIN clients c ON c.id = s.client_id
     LEFT JOIN invoices inv ON inv.sale_id = s.id
     LEFT JOIN return_items ri ON ri.return_id = r.id
     LEFT JOIN sale_items si ON si.id = ri.sale_item_id
     WHERE r.id = $1 AND r.organization_id = $2 AND ($3::uuid IS NULL OR s.consultant_id = $3 OR s.created_by = $3)
     GROUP BY r.id, s.id, c.id, inv.id`,
    [params.id, session.user.organizationId, consultantOnly ? session.user.id : null],
  );
  const record = result.rows[0];
  if (!record) return NextResponse.json({ error: 'Return not found.' }, { status: 404 });
  if (!record.credit_note_number) return NextResponse.json({ error: 'No credit note has been issued for this return.' }, { status: 404 });

  const settings = await getOrganizationSettings(session.user.organizationId);
  const items = record.items as CreditLine[];
  const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
  const pdf = await PDFDocument.create();
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'credit-note', id: params.id, documentTimestamp: new Date(record.created_at).toISOString() });
  const pages: PDFPage[] = [];
  const addPage = (continued = false) => {
    const page = pdf.addPage(PDF_PAGE_SIZE);
    let y = drawPdfHeader(page, { logo, qr: qr.image, font, bold, settings, title: 'Credit note', subtitle: continued ? `${record.credit_note_number} · continued` : `${record.credit_note_number} · against ${record.invoice_number || record.sale_number}` });
    if (!continued) {
      y = drawPdfSectionHeading(page, { title: 'Credit details', y, font, bold });
      page.drawText(`Client: ${record.client_name}`, { x: PDF_LAYOUT.left, y, size: 10, font: bold, color: PDF_INK });
      page.drawText(`Return: ${record.return_number}`, { x: 370, y, size: 9, font, color: PDF_MUTED });
      y -= 18;
      page.drawText(`Issued: ${formatOrganizationDate(record.created_at, settings)}`, { x: PDF_LAYOUT.left, y, size: 9, font, color: PDF_MUTED });
      page.drawText(`Sale: ${record.sale_number}`, { x: 370, y, size: 9, font, color: PDF_MUTED });
      y -= 17;
      y = drawPdfWrappedText(page, `Reason: ${record.reason}`, { x: PDF_LAYOUT.left, y, maxWidth: PDF_LAYOUT.width, font, size: 8.5, color: PDF_MUTED, maxLines: 2 }) - 14;
    } else {
      y -= 12;
    }
    y = drawPdfTableHeader(page, { y, columns: [{ label: 'Returned item', x: 50 }, { label: 'Serial', x: 330 }, { label: 'Credit', x: 460 }], font: bold });
    pages.push(page);
    return { page, y };
  };

  let current = addPage();
  for (const item of items) {
    if (current.y < 125) current = addPage(true);
    const nextY = drawPdfWrappedText(current.page, item.description, { x: 50, y: current.y, maxWidth: 270, font, size: 9, maxLines: 2 });
    current.page.drawText(item.serialNumber, { x: 330, y: current.y, size: 9, font, color: PDF_INK });
    current.page.drawText(formatCurrency(item.amount, settings.currency), { x: 460, y: current.y, size: 9, font, color: PDF_INK });
    current.page.drawLine({ start: { x: 50, y: current.y - 10 }, end: { x: PDF_LAYOUT.right, y: current.y - 10 }, thickness: 0.5, color: rgb(.9, .92, .95) });
    current.y = Math.min(current.y - 22, nextY - 9);
  }
  if (current.y < 140) current = addPage(true);
  current.y -= 15;
  current.page.drawRectangle({ x: 350, y: current.y - 16, width: 203, height: 42, color: rgb(.94, .98, .96) });
  current.page.drawText('TOTAL CREDIT', { x: 365, y: current.y + 5, size: 8, font: bold, color: PDF_MUTED });
  current.page.drawText(formatCurrency(total, settings.currency), { x: 365, y: current.y - 10, size: 14, font: bold, color: PDF_INK });
  const refundNote = Number(record.refund_amount) > 0
    ? `Refund of ${formatCurrency(record.refund_amount, settings.currency)}: ${record.refund_status}${record.refund_method ? ` (${record.refund_method})` : ''}.`
    : 'No cash refund is due; the credit reduces the amount owed on the original invoice.';
  drawPdfWrappedText(current.page, refundNote, { x: PDF_LAYOUT.left, y: current.y - 40, maxWidth: PDF_LAYOUT.width, font, size: 8.5, color: PDF_MUTED, maxLines: 2 });
  pages.forEach((page, index) => drawPdfFooter(page, { font, generatedAt: formatOrganizationDate(qr.generatedAt, settings), pageNumber: index + 1, totalPages: pages.length }));
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${record.credit_note_number}.pdf"` } });
}
