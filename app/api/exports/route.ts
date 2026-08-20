import { NextRequest } from 'next/server';
import { PDFDocument, rgb } from 'pdf-lib';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { embedIpaytechFonts, embedIpaytechLogo, embedReportVerificationQr } from '@/lib/pdf-brand';
import { formatOrganizationDate } from '@/lib/organization-settings';
import { getOrganizationSettings } from '@/lib/server-organization-settings';
import { createXlsxWorkbook } from '@/lib/xlsx-export';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.reports);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const type = request.nextUrl.searchParams.get('type') ?? 'csv';
  if (!['csv', 'xlsx', 'pdf'].includes(type)) return new Response(JSON.stringify({ error: 'Unsupported export type.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const from = request.nextUrl.searchParams.get('from') || `${new Date().getFullYear()}-01-01`;
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const region = request.nextUrl.searchParams.get('region') || null;
  const product = request.nextUrl.searchParams.get('product') || null;
  const settings = await getOrganizationSettings(session.user.organizationId);
  const result = await query<{ reference: string; counterparty: string; status: string; value: string | number }>(
    `SELECT reference, counterparty, status, value FROM (
      SELECT po.number AS reference, s.name AS counterparty, po.status, po.total::numeric AS value, po.created_at AS occurred_at
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.organization_id = $1 AND ($4::text IS NULL OR po.destination = $4) AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id AND poi.sku = $5))
      UNION ALL
      SELECT sa.number, c.name, sa.status, sa.total::numeric, sa.created_at
      FROM sales sa JOIN clients c ON c.id = sa.client_id
      WHERE sa.organization_id = $1 AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM sale_items si JOIN inventory_items ii ON ii.id = si.inventory_item_id WHERE si.sale_id = sa.id AND ii.location = $4)) AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = sa.id AND si.sku = $5))
      UNION ALL
      SELECT j.number, c.name, j.status, COUNT(jci.id)::numeric, j.created_at
      FROM job_cards j JOIN clients c ON c.id = j.client_id LEFT JOIN job_card_items jci ON jci.job_card_id = j.id
      WHERE j.organization_id = $1 AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM job_card_items jci JOIN inventory_items ii ON ii.id = jci.inventory_item_id WHERE jci.job_card_id = j.id AND ii.location = $4)) AND ($5::text IS NULL OR EXISTS (SELECT 1 FROM job_card_items jci JOIN inventory_items ii ON ii.id = jci.inventory_item_id WHERE jci.job_card_id = j.id AND ii.sku = $5)) GROUP BY j.id, c.name
      UNION ALL
      SELECT wc.number, COALESCE(ii.client_name, 'Unassigned'), wc.status, 0::numeric, wc.created_at
      FROM warranty_claims wc JOIN inventory_items ii ON ii.id = wc.inventory_item_id
      WHERE wc.organization_id = $1 AND ($4::text IS NULL OR ii.location = $4) AND ($5::text IS NULL OR ii.sku = $5)
    ) records WHERE occurred_at::date BETWEEN $2::date AND $3::date ORDER BY occurred_at DESC LIMIT 1000`,
    [session.user.organizationId, from, to, region, product],
  );
  const rows = [['Reference', 'Client / Supplier', 'Status', 'Value'], ...result.rows.map(row => [row.reference, row.counterparty, row.status, String(row.value)])];
  if (type === 'csv') {
    const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(',')).join('\n');
    return new Response(csv, { headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="ipaytech-operations-${from}-to-${to}.csv"`} });
  }
  if (type === 'xlsx') {
    const buffer = createXlsxWorkbook(rows);
    return new Response(buffer.buffer as ArrayBuffer, { headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="ipaytech-operations-${from}-to-${to}.xlsx"`} });
  }
  const pdf = await PDFDocument.create(); const logo = await embedIpaytechLogo(pdf); const { regular: font, semibold: bold } = await embedIpaytechFonts(pdf); const qr = await embedReportVerificationQr(pdf, request, { from, to, region, product });
  const rowsPerPage = 22; const dataRows = rows.slice(1); const totalPages = Math.max(1, Math.ceil(dataRows.length / rowsPerPage));
  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const page = pdf.addPage([595, 842]);
    if (pageIndex === 0) {
      page.drawImage(logo, {x:42,y:748,width:175,height:73}); page.drawImage(qr.image, {x:482,y:735,width:78,height:78}); page.drawText('Operations summary export', {x:42,y:730,size:11,font,color:rgb(.35,.42,.52)});
      page.drawText(`Generated ${formatOrganizationDate(new Date(), settings)}`, {x:42,y:712,size:9,font,color:rgb(.45,.5,.58)}); page.drawText(`Filters: ${region || 'All regions'} · ${product || 'All products'}`, {x:42,y:698,size:8,font,color:rgb(.45,.5,.58)}); page.drawText('Scan QR to verify export', {x:450,y:34,size:7,font});
    } else {
      page.drawText('Operations summary export - continued', {x:42,y:790,size:11,font: bold,color:rgb(.35,.42,.52)});
      page.drawText(`Page ${pageIndex + 1} of ${totalPages}`, {x:460,y:790,size:8,font,color:rgb(.45,.5,.58)});
    }
    const pageRows = [rows[0], ...dataRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage)];
    pageRows.forEach((row, index) => row.forEach((cell, col) => page.drawText(cell, {x:42 + col*130,y:pageIndex === 0 ? 660-index*28 : 750-index*28,size:index===0?9:10,font:index===0?bold:font,color:rgb(.1,.15,.22)})));
    page.drawText(`Page ${pageIndex + 1} of ${totalPages}`, {x:42,y:34,size:7,font,color:rgb(.45,.5,.58)});
  }
  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), { headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="ipaytech-operations-${from}-to-${to}.pdf"`} });
}
