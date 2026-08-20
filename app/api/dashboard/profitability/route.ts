import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const from = params.get('from') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = params.get('to') || new Date().toISOString().slice(0, 10);
  const region = params.get('region')?.trim() || null;
  const product = params.get('product')?.trim() || null;
  const values = [auth.session.user.organizationId, from, to, region, product];
  const where = `s.organization_id = $1 AND s.confirmed_at::date BETWEEN $2::date AND $3::date AND s.status <> 'Cancelled'
    AND ($4::text IS NULL OR ii.location = $4)
    AND ($5::text IS NULL OR ii.sku = $5 OR ii.product_type = $5 OR ii.description ILIKE '%' || $5 || '%')`;
  const [summary, rows] = await Promise.all([
    query(`SELECT COALESCE(SUM(si.amount), 0) AS revenue, COALESCE(SUM(si.purchase_cost), 0) AS buying_cost,
                  COALESCE(SUM(si.amount - si.purchase_cost), 0) AS gross_profit,
                  CASE WHEN COALESCE(SUM(si.amount), 0) = 0 THEN 0 ELSE ROUND((SUM(si.amount - si.purchase_cost) / SUM(si.amount)) * 100, 2) END AS gross_margin,
                  COUNT(DISTINCT s.id)::int AS sales_count, COUNT(si.id)::int AS units
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN inventory_items ii ON ii.id = si.inventory_item_id
           WHERE ${where}`, values),
    query(`SELECT COALESCE(ii.product_type, 'Other') AS product_type, ii.sku, ii.description,
                  COALESCE(SUM(si.amount), 0) AS revenue, COALESCE(SUM(si.purchase_cost), 0) AS buying_cost,
                  COALESCE(SUM(si.amount - si.purchase_cost), 0) AS gross_profit, COUNT(si.id)::int AS units
           FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN inventory_items ii ON ii.id = si.inventory_item_id
           WHERE ${where}
           GROUP BY ii.product_type, ii.sku, ii.description ORDER BY gross_profit DESC, ii.sku LIMIT 100`, values),
  ]);
  return NextResponse.json({ filters: { from, to, region: region || '', product: product || '' }, summary: summary.rows[0], rows: rows.rows });
}
