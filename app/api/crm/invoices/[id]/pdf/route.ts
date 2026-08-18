import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession(request); if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(`SELECT i.number, i.total, i.issued_at, c.name AS client_name, COALESCE(json_agg(json_build_object('description', ii.description, 'amount', ii.amount) ORDER BY ii.id) FILTER (WHERE ii.id IS NOT NULL), '[]'::json) AS items FROM invoices i JOIN clients c ON c.id = i.client_id LEFT JOIN invoice_items ii ON ii.invoice_id = i.id WHERE i.id = $1 AND i.organization_id = $2 GROUP BY i.id, c.id`, [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Invoice not found.' }, { status: 404 });
  const invoice = result.rows[0]; const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); let y = 790;
  page.drawText('iPayTech Operations', { x: 48, y, size: 20, font: bold, color: rgb(0.08, 0.14, 0.24) }); y -= 35; page.drawText(`INVOICE ${invoice.number}`, { x: 48, y, size: 13, font: bold }); y -= 22; page.drawText(`Client: ${invoice.client_name}`, { x: 48, y, size: 10, font }); page.drawText(`Issued: ${new Date(invoice.issued_at).toLocaleDateString()}`, { x: 360, y, size: 10, font }); y -= 35;
  for (const item of invoice.items) { page.drawText(item.description, { x: 55, y, size: 10, font }); page.drawText(`$${Number(item.amount).toFixed(2)}`, { x: 450, y, size: 10, font }); y -= 20; }
  y -= 15; page.drawText(`Total: $${Number(invoice.total).toFixed(2)}`, { x: 370, y, size: 13, font: bold }); const bytes = await pdf.save(); return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${invoice.number}.pdf"` } });
}
