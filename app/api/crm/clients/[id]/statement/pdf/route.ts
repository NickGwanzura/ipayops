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
  const auth = await requireRole(request, ACCESS.documents);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const clientResult = await query(
    `SELECT id, code, name, contact_name, email, phone, address, status, created_at
     FROM clients WHERE id = $1 AND organization_id = $2`,
    [params.id, session.user.organizationId],
  );
  const client = clientResult.rows[0];
  if (!client) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
  const [invoicesResult, paymentsResult] = await Promise.all([
    query(`SELECT i.number, i.status, i.total, i.paid_amount, (i.total - i.paid_amount) AS outstanding, i.issued_at, i.due_at, i.currency FROM invoices i WHERE i.client_id = $1 AND i.organization_id = $2 ORDER BY i.issued_at DESC`, [params.id, session.user.organizationId]),
    query(`SELECT p.amount, p.method, p.reference, p.paid_at, i.number AS invoice_number FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.organization_id = $1 AND i.client_id = $2 ORDER BY p.paid_at DESC`, [session.user.organizationId, params.id]),
  ]);
  const settings = await getOrganizationSettings(session.user.organizationId);
  const pdf = await PDFDocument.create();
  let page = pdf.addPage([595, 842]);
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'client-statement', id: params.id, documentTimestamp: new Date(client.created_at).toISOString() });
  const invoices = invoicesResult.rows;
  const payments = paymentsResult.rows;
  const totalInvoiced = invoices.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const totalPaid = payments.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  let y = 700;
  page.drawImage(logo, { x: 44, y: 730, width: 175, height: 73 });
  page.drawImage(qr.image, { x: 482, y: 735, width: 78, height: 78 });
  page.drawText(settings.address, { x: 240, y: 780, size: 8, font });
  page.drawText(settings.phone, { x: 240, y: 766, size: 8, font });
  page.drawText(`CLIENT STATEMENT · ${client.code}`, { x: 48, y, size: 13, font: bold });
  y -= 22;
  page.drawText(`Client: ${client.name}`, { x: 48, y, size: 10, font });
  page.drawText(`Generated: ${formatOrganizationDate(qr.generatedAt, settings)}`, { x: 350, y, size: 9, font });
  y -= 28;
  page.drawText(`Invoiced: ${formatCurrency(totalInvoiced, settings.currency)}`, { x: 48, y, size: 10, font: bold });
  page.drawText(`Paid: ${formatCurrency(totalPaid, settings.currency)}`, { x: 220, y, size: 10, font: bold });
  page.drawText(`Outstanding: ${formatCurrency(Math.max(0, totalInvoiced - totalPaid), settings.currency)}`, { x: 370, y, size: 10, font: bold });
  y -= 34;
  page.drawText('INVOICES', { x: 48, y, size: 9, font: bold }); y -= 18;
  for (const item of invoices) {
    if (y < 90) { page = pdf.addPage([595, 842]); y = 780; }
    page.drawText(item.number, { x: 52, y, size: 9, font });
    page.drawText(item.issued_at ? formatOrganizationDate(item.issued_at, settings) : '—', { x: 170, y, size: 9, font });
    page.drawText(item.status, { x: 300, y, size: 9, font });
    page.drawText(formatCurrency(item.outstanding, settings.currency), { x: 450, y, size: 9, font }); y -= 16;
  }
  y -= 12; page.drawText('PAYMENT RECEIPTS', { x: 48, y, size: 9, font: bold }); y -= 18;
  for (const item of payments) {
    if (y < 90) { page = pdf.addPage([595, 842]); y = 780; }
    page.drawText(item.invoice_number, { x: 52, y, size: 9, font });
    page.drawText(item.paid_at ? formatOrganizationDate(item.paid_at, settings) : '—', { x: 170, y, size: 9, font });
    page.drawText(item.method, { x: 300, y, size: 9, font });
    page.drawText(formatCurrency(item.amount, settings.currency), { x: 450, y, size: 9, font }); y -= 16;
  }
  for (const statementPage of pdf.getPages()) {
    statementPage.drawText(`Generated ${qr.generatedAt} · Scan QR to verify authenticity`, { x: 48, y: 34, size: 7, font });
  }
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${client.code}-statement.pdf"` } });
}
