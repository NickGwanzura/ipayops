import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getSession } from '@/lib/auth';

const rows = [
  ['Reference','Client / Supplier','Status','Value'],
  ['PO-2026-000084','TechCore Distributors','Partially received','$42,680'],
  ['PRE-2026-000094','Mavuno Foods','Under review','$8,420'],
  ['JOB-2026-000184','Apex Retail','In progress','4 devices'],
];

export async function GET(request: NextRequest) {
  if (!await getSession(request)) return new Response(JSON.stringify({ error: 'Unauthenticated.' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const type = request.nextUrl.searchParams.get('type') ?? 'csv';
  if (!['csv', 'xlsx', 'pdf'].includes(type)) return new Response(JSON.stringify({ error: 'Unsupported export type.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  if (type === 'csv') {
    const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(',')).join('\n');
    return new Response(csv, { headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="ipaytech-operations.csv"'} });
  }
  if (type === 'xlsx') {
    const XLSX = await import('xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Operations');
    const buffer = XLSX.write(workbook, { bookType:'xlsx', type:'buffer' });
    return new Response(buffer, { headers:{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="ipaytech-operations.xlsx"'} });
  }
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595,842]); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('iPayTech Ops', {x:42,y:790,size:18,font:bold,color:rgb(.08,.18,.32)}); page.drawText('Operations summary export', {x:42,y:766,size:11,font,color:rgb(.35,.42,.52)});
  page.drawText(`Generated ${new Date().toLocaleDateString('en-GB')}`, {x:42,y:744,size:9,font,color:rgb(.45,.5,.58)});
  rows.forEach((row, index) => row.forEach((cell, col) => page.drawText(cell, {x:42 + col*130,y:700-index*28,size:index===0?9:10,font:index===0?bold:font,color:rgb(.1,.15,.22)})));
  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), { headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="ipaytech-operations.pdf"'} });
}
