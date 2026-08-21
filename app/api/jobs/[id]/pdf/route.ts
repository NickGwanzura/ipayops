import { NextResponse } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { drawPdfFooter, drawPdfHeader, drawPdfSectionHeading, drawPdfWrappedText, embedDocumentVerificationQr, embedIpaytechFonts, embedIpaytechLogo, PDF_PAGE_SIZE } from '@/lib/pdf-brand';
import { formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const runtime = 'nodejs';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.jobRead);
  if ('response' in auth) return auth.response;
  const result = await query(
    `SELECT j.id, j.number, j.title, j.status, j.scheduled_for, j.notes, j.signoff_name, j.signoff_notes, j.signed_at, j.created_at,
            c.name AS client_name, c.address AS client_address, c.email AS client_email, c.phone AS client_phone,
            u.full_name AS installer_name,
            COALESCE(json_agg(json_build_object('serialNumber', jci.serial_number, 'checklist', jci.checklist) ORDER BY jci.serial_number) FILTER (WHERE jci.id IS NOT NULL), '[]'::json) AS items
     FROM job_cards j JOIN clients c ON c.id = j.client_id LEFT JOIN users u ON u.id = j.installer_id LEFT JOIN job_card_items jci ON jci.job_card_id = j.id
     WHERE j.id = $1 AND j.organization_id = $2 AND ($3::uuid IS NULL OR j.installer_id = $3)
     GROUP BY j.id, c.id, u.id`,
    [params.id, auth.session.user.organizationId, auth.session.user.role === 'sales_consultant' ? auth.session.user.id : null],
  );
  const job = result.rows[0];
  if (!job) return NextResponse.json({ error: 'Job card not found.' }, { status: 404 });
  const settings = await getOrganizationSettings(auth.session.user.organizationId);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(PDF_PAGE_SIZE);
  const logo = await embedIpaytechLogo(pdf);
  const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf);
  const qr = await embedDocumentVerificationQr(pdf, request, { type: 'job-card', id: params.id, documentTimestamp: new Date(job.created_at).toISOString() });
  let y = drawPdfHeader(page, { logo, qr: qr.image, font, bold, settings, title: 'Job card', subtitle: `${job.number} · ${job.title}` });
  y = drawPdfSectionHeading(page, { title: 'Installation details', y, font, bold });
  page.drawText(`Client: ${job.client_name}`, { x: 42, y, size: 10, font });
  page.drawText(`Status: ${job.status}`, { x: 330, y, size: 10, font }); y -= 18;
  page.drawText(`Scheduled: ${job.scheduled_for ? formatOrganizationDate(job.scheduled_for, settings) : 'Unscheduled'}`, { x: 42, y, size: 9, font });
  page.drawText(`Installer: ${job.installer_name || 'Unassigned'}`, { x: 330, y, size: 9, font }); y -= 18;
  page.drawText(`Client contact: ${job.client_email || job.client_phone || 'No contact recorded'}`, { x: 42, y, size: 9, font }); y -= 28;
  y = drawPdfSectionHeading(page, { title: 'Serialized devices and configuration checklist', y, font, bold }); y += 3;
  page.drawRectangle({ x: 42, y: y - 8, width: 511, height: 22, color: rgb(.94, .96, .98) });
  page.drawText('Serial number', { x: 50, y, size: 8, font: bold }); page.drawText('Checklist progress', { x: 300, y, size: 8, font: bold }); y -= 26;
  for (const item of job.items as Array<{ serialNumber: string; checklist?: Array<{ done: boolean }> }>) {
    const checklist = item.checklist || [];
    const complete = checklist.filter(entry => entry.done).length;
    page.drawText(item.serialNumber, { x: 50, y, size: 9, font });
    page.drawText(`${complete}/${checklist.length || 0} complete`, { x: 300, y, size: 9, font });
    y -= 20;
  }
  if (!job.items.length) { page.drawText('No serialized devices assigned.', { x: 50, y, size: 9, font, color: rgb(.45, .5, .58) }); y -= 20; }
  y -= 10;
  y = drawPdfSectionHeading(page, { title: 'Notes', y, font, bold });
  y = drawPdfWrappedText(page, job.notes || 'No installation notes recorded.', { x: 42, y, maxWidth: 511, font, size: 9, color: job.notes ? rgb(.06, .12, .22) : rgb(.45, .5, .58), maxLines: 4 });
  y -= 12;
  if (job.signoff_name) { page.drawText(`Signed off by: ${job.signoff_name}`, { x: 42, y, size: 9, font }); y -= 16; page.drawText(`Sign-off date: ${job.signed_at ? formatOrganizationDate(job.signed_at, settings) : '—'}`, { x: 42, y, size: 9, font }); }
  drawPdfFooter(page, { font, generatedAt: formatOrganizationDate(qr.generatedAt, settings), pageNumber: 1, totalPages: 1 });
  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${job.number}.pdf"` } });
}
