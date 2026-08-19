import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { embedIpaytechLogo } from '@/lib/pdf-brand';
import { formatCurrency, formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession(request); if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(`SELECT i.number, i.total, i.issued_at, c.name AS client_name, COALESCE(json_agg(json_build_object('description', ii.description, 'amount', ii.amount) ORDER BY ii.id) FILTER (WHERE ii.id IS NOT NULL), '[]'::json) AS items FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.id = $1 AND i.organization_id = $2 GROUP BY i.id, c.id`, [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const settings = await getOrganizationSettings(session.user.organizationId); const invoice = result.rows[0]; const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]); const logo = await embedIpaytechLogo(pdf); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); let y = 710;
  page.drawImage(logo, { x: 44, y: 730, width: 175, height: 73 }); page.drawText(`INVOICE ${invoice.number}`, { x: 48, y, size: 13, font: bold }); y -= 22; page.drawText(`Client: ${invoice.client_name}`, { x: 48, y, size: 10, font }); page.drawText(`Issued: ${formatOrganizationDate(invoice.issued_at, settings)}`, { x: 360, y, size: 10, font }); y -= 35;
  for (const item of invoice.items) { page.drawText(item.description, { x: 55, y, size: 10, font }); page.drawText(formatCurrency(item.amount, settings.currency), { x: 450, y, size: 10, font }); y -= 20; }
  y -= 15; page.drawText(`Total: ${formatCurrency(invoice.total, settings.currency)}`, { x: 370, y, size: 13, font: bold }); const bytes = await pdf.save(); return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.number}.pdf"` } });
}
