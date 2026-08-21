import { NextResponse } from 'next/server';
import { PDFDocument, PDFPage, rgb } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { drawPdfFooter, drawPdfHeader, drawPdfSectionHeading, drawPdfTableHeader, drawPdfWrappedText, embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo, PDF_INK, PDF_LAYOUT, PDF_MUTED, PDF_PAGE_SIZE } from '@/lib/pdf-brand';
import { formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.documents);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(`SELECT d.number, d.created_at, d.status, c.name AS client_name, c.email AS client_email, c.phone AS client_phone,
      COALESCE(json_agg(json_build_object('serialNumber', di.serial_number, 'description', di.description) ORDER BY di.serial_number) FILTER (WHERE di.id IS NOT NULL), '[]'::json) AS items
    FROM delivery_notes d JOIN clients c ON c.id = d.client_id LEFT JOIN delivery_note_items di ON di.delivery_note_id = d.id
    WHERE d.id = $1 AND d.organization_id = $2 GROUP BY d.id, c.id`, [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Delivery note not found.' }, { status: 404 });

  const settings = await getOrganizationSettings(session.user.organizationId);
  const note = result.rows[0];
  const pdf = await PDFDocument.create();
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'delivery-note', id: params.id, documentTimestamp: new Date(note.created_at).toISOString() });
  const pages: PDFPage[] = [];
  const addPage = (continued = false) => {
    const page = pdf.addPage(PDF_PAGE_SIZE);
    let y = drawPdfHeader(page, { logo, qr: qr.image, font, bold, settings, title: 'Delivery note', subtitle: continued ? `${note.number} · continued` : `${note.number} · Serialized handover` });
    if (!continued) {
      y = drawPdfSectionHeading(page, { title: 'Delivery details', y, font, bold });
      page.drawText(`Client: ${note.client_name}`, { x: PDF_LAYOUT.left, y, size: 10, font: bold, color: PDF_INK });
      page.drawText(`Status: ${note.status || 'Issued'}`, { x: 370, y, size: 9, font, color: PDF_MUTED });
      y -= 18;
      page.drawText(`Issued: ${formatOrganizationDate(note.created_at, settings)}`, { x: PDF_LAYOUT.left, y, size: 9, font, color: PDF_MUTED });
      y -= 17;
      drawPdfWrappedText(page, `Contact: ${note.client_email || note.client_phone || 'No contact recorded'}`, { x: PDF_LAYOUT.left, y, maxWidth: PDF_LAYOUT.width, font, size: 8.5, color: PDF_MUTED, maxLines: 1 });
      y -= 28;
    } else y -= 12;
    y = drawPdfTableHeader(page, { y, columns: [{ label: 'Serial number', x: 50 }, { label: 'Description', x: 220 }], font: bold });
    pages.push(page);
    return { page, y };
  };

  let current = addPage();
  for (const item of note.items as Array<{ serialNumber: string; description: string }>) {
    if (current.y < 112) current = addPage(true);
    current.page.drawText(item.serialNumber || '—', { x: 50, y: current.y, size: 9, font, color: PDF_INK });
    drawPdfWrappedText(current.page, item.description || 'Serialized device', { x: 220, y: current.y, maxWidth: 320, font, size: 9, maxLines: 2 });
    current.page.drawLine({ start: { x: 50, y: current.y - 10 }, end: { x: PDF_LAYOUT.right, y: current.y - 10 }, thickness: 0.5, color: rgb(.9, .92, .95) });
    current.y -= 24;
  }
  if (!note.items.length) {
    drawPdfWrappedText(current.page, 'No serialized devices recorded.', { x: 50, y: current.y, maxWidth: PDF_LAYOUT.width, font, size: 9, color: PDF_MUTED });
    current.y -= 28;
  }
  current.y -= 14;
  current.page.drawRectangle({ x: 42, y: current.y - 22, width: 511, height: 44, color: rgb(.94, .96, .98) });
  current.page.drawText('SERIALIZED HANDOVER', { x: 56, y: current.y - 3, size: 8, font: bold, color: PDF_MUTED });
  current.page.drawText(`${note.items.length} device${note.items.length === 1 ? '' : 's'} listed for this delivery`, { x: 56, y: current.y - 16, size: 9, font, color: PDF_INK });
  pages.forEach((page, index) => drawPdfFooter(page, { font, generatedAt: formatOrganizationDate(qr.generatedAt, settings), pageNumber: index + 1, totalPages: pages.length }));
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${note.number}.pdf"` } });
}
