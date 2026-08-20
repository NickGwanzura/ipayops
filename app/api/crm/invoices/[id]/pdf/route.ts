import { NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo } from '@/lib/pdf-brand';
import { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.documents);if ('response' in auth) return auth.response;const { session } = auth;
  const result = await query(`SELECT i.number, i.total, i.issued_at, c.name AS client_name, COALESCE(json_agg(json_build_object('description', ii.description, 'amount', ii.amount) ORDER BY ii.id) FILTER (WHERE ii.id IS NOT NULL), '[]'::json) AS items FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.id = $1 AND i.organization_id = $2 GROUP BY i.id, c.id`, [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const settings = await getOrganizationSettings(session.user.organizationId);const invoice = result.rows[0];const pdf = await PDFDocument.create();const page = pdf.addPage([595, 842]);const logo = await embedIpaytechLogo(pdf);const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);const qr = await embedDocumentVerificationQr(pdf, request, { type: 'invoice', id: params.id, documentTimestamp: new Date(invoice.issued_at).toISOString() });let y = 710;
  page.drawImage(logo, { x: 44, y: 730, width: 175, height: 73 });page.drawImage(qr.image, { x: 482, y: 735, width: 78, height: 78 });page.drawText(settings.address, { x: 240, y: 780, size: 8, font });page.drawText(settings.phone, { x: 240, y: 766, size: 8, font });page.drawText(`INVOICE ${invoice.number}`, { x: 48, y, size: 13, font: bold });y -= 22;page.drawText(`Client: ${invoice.client_name}`, { x: 48, y, size: 10, font });page.drawText(`Issued: ${formatOrganizationDate(invoice.issued_at, settings)}`, { x: 360, y, size: 10, font });y -= 35;
  for (const item of invoice.items) { page.drawText(item.description, { x: 55, y, size: 10, font }); page.drawText(formatCurrency(item.amount, settings.currency), { x: 450, y, size: 10, font }); y -= 20; }
  y -= 15;page.drawText(`Total: ${formatCurrency(invoice.total, settings.currency)}`, { x: 370, y, size: 13, font: bold });page.drawText(`Generated: ${qr.generatedAt}`, { x: 48, y: 34, size: 7, font });page.drawText('Scan QR to verify authenticity', { x: 450, y: 34, size: 7, font });const bytes = await pdf.save();return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.number}.pdf"` } });
}
