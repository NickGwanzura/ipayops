import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { embedIpaytechLogo } from '@/lib/pdf-brand';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return new Response(JSON.stringify({ error: 'Unauthenticated.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const type = request.nextUrl.searchParams.get('type') ?? 'csv';
  if (!['csv', 'xlsx', 'pdf'].includes(type)) return new Response(JSON.stringify({ error: 'Unsupported export type.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  const from = request.nextUrl.searchParams.get('from') || `${new Date().getFullYear()}-01-01`;
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const result = await query<{ reference: string; counterparty: string; status: string; value: string | number }>(
    `SELECT reference, counterparty, status, value FROM (
      SELECT po.number AS reference, s.name AS counterparty, po.status, po.total::numeric AS value, po.created_at AS occurred_at
      FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
      WHERE po.organization_id = $1
      UNION ALL
      SELECT sa.number, c.name, sa.status, sa.total::numeric, sa.created_at
      FROM sales sa JOIN clients c ON c.id = sa.client_id
      WHERE sa.organization_id = $1
      UNION ALL
      SELECT j.number, c.name, j.status, COUNT(jci.id)::numeric, j.created_at
      FROM job_cards j JOIN clients c ON c.id = j.client_id LEFT JOIN job_card_items jci ON jci.job_card_id = j.id
      WHERE j.organization_id = $1 GROUP BY j.id, c.name
      UNION ALL
      SELECT wc.number, COALESCE(ii.client_name, 'Unassigned'), wc.status, 0::numeric, wc.created_at
      FROM warranty_claims wc JOIN inventory_items ii ON ii.id = wc.inventory_item_id
      WHERE wc.organization_id = $1
    ) records WHERE occurred_at::date BETWEEN $2::date AND $3::date ORDER BY occurred_at DESC LIMIT 1000`,
    [session.user.organizationId, from, to],
  );
  const rows = [['Reference', 'Client / Supplier', 'Status', 'Value'], ...result.rows.map(row => [row.reference, row.counterparty, row.status, String(row.value)])];
  if (type === 'csv') {
    const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(',')).join('\n');
    return new Response(csv, { headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="ipaytech-operations-${from}-to-${to}.csv"`} });
  }
  if (type === 'xlsx') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Operations');
    const buffer = XLSX.write(workbook, { bookType:'xlsx', type:'buffer' });
    return new Response(buffer, { headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="ipaytech-operations-${from}-to-${to}.xlsx"`} });
  }
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595,842]); const logo = await embedIpaytechLogo(pdf); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawImage(logo, {x:42,y:748,width:175,height:73}); page.drawText('Operations summary export', {x:42,y:730,size:11,font,color:rgb(.35,.42,.52)});
  page.drawText(`Generated ${new Date().toLocaleDateString('en-GB')}`, {x:42,y:712,size:9,font,color:rgb(.45,.5,.58)});
  rows.forEach((row, index) => row.forEach((cell, col) => page.drawText(cell, {x:42 + col*130,y:680-index*28,size:index===0?9:10,font:index===0?bold:font,color:rgb(.1,.15,.22)})));
  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), { headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="ipaytech-operations-${from}-to-${to}.pdf"`} });
}
