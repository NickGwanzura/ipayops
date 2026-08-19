import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { embedIpaytechLogo } from '@/lib/pdf-brand';
import { formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession(request); if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(`SELECT d.number, d.created_at, c.name AS client_name, COALESCE(json_agg(json_build_object('serialNumber', di.serial_number, 'description', di.description) ORDER BY di.serial_number) FILTER (WHERE di.id IS NOT NULL), '[]'::json) AS items FROM delivery_notes d JOIN clients c ON c.id = d.client_id LEFT JOIN delivery_note_items di ON di.delivery_note_id = d.id WHERE d.id = $1 AND d.organization_id = $2 GROUP BY d.id, c.id`, [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Delivery note not found.' }, { status: 404 });
  const settings = await getOrganizationSettings(session.user.organizationId); const note = result.rows[0]; const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]); const logo = await embedIpaytechLogo(pdf); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); let y = 710; page.drawImage(logo, { x: 44, y: 730, width: 175, height: 73 }); page.drawText(`DELIVERY NOTE ${note.number}`, { x: 48, y, size: 13, font: bold }); y -= 22; page.drawText(`Client: ${note.client_name}`, { x: 48, y, size: 10, font }); page.drawText(`Issued: ${formatOrganizationDate(note.created_at, settings)}`, { x: 360, y, size: 10, font }); y -= 35; for (const item of note.items) { page.drawText(`${item.serialNumber} · ${item.description}`, { x: 55, y, size: 10, font }); y -= 20; } const bytes = await pdf.save(); return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${note.number}.pdf"` } });
}
