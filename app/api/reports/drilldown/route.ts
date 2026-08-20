import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const definitions = {
  stock: { title: 'Stock valuation', columns: ['SKU', 'Description', 'Location', 'Status', 'Units'], sql: `SELECT sku, description, location, status, COUNT(*)::int AS units FROM inventory_items WHERE organization_id = $1 AND ($4::text IS NULL OR location = $4) AND ($5::text IS NULL OR sku = $5) GROUP BY sku, description, location, status ORDER BY sku, location` },
  pipeline: { title: 'Pipeline conversion', columns: ['Stage', 'Opportunities', 'Pipeline value'], sql: `SELECT stage, COUNT(*)::int AS opportunities, COALESCE(SUM(value), 0)::numeric AS pipeline_value FROM opportunities WHERE organization_id = $1 AND created_at::date BETWEEN $2::date AND $3::date GROUP BY stage ORDER BY stage` },
  warranty: { title: 'Warranty performance', columns: ['Status', 'Claims', 'Open issues'], sql: `SELECT wc.status, COUNT(*)::int AS claims, COUNT(*) FILTER (WHERE wc.status IN ('Open', 'Under assessment', 'Repair', 'Replacement'))::int AS open_issues FROM warranty_claims wc JOIN inventory_items ii ON ii.id = wc.inventory_item_id WHERE wc.organization_id = $1 AND wc.created_at::date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR ii.location = $4) AND ($5::text IS NULL OR ii.sku = $5) GROUP BY wc.status ORDER BY wc.status` },
  installation: { title: 'Installation turnaround', columns: ['Status', 'Jobs', 'Signed off'], sql: `SELECT j.status, COUNT(DISTINCT j.id)::int AS jobs, COUNT(DISTINCT j.id) FILTER (WHERE j.signed_at IS NOT NULL)::int AS signed_off FROM job_cards j LEFT JOIN job_card_items jci ON jci.job_card_id = j.id LEFT JOIN inventory_items ii ON ii.id = jci.inventory_item_id WHERE j.organization_id = $1 AND j.created_at::date BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR ii.location = $4) AND ($5::text IS NULL OR ii.sku = $5) GROUP BY j.status ORDER BY j.status` },
} as const;

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.reports);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const type = request.nextUrl.searchParams.get('type') as keyof typeof definitions | null;
  const definition = type ? definitions[type] : null;
  if (!definition) return NextResponse.json({ error: 'Unknown report drill-down.' }, { status: 400 });
  const from = request.nextUrl.searchParams.get('from') || `${new Date().getFullYear()}-01-01`;
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const region = request.nextUrl.searchParams.get('region') || null;
  const product = request.nextUrl.searchParams.get('product') || null;
  const values = type === 'stock' ? [session.user.organizationId, from, to, region, product] : type === 'pipeline' ? [session.user.organizationId, from, to] : [session.user.organizationId, from, to, region, product];
  const result = await query(definition.sql, values);
  return NextResponse.json({ title: definition.title, columns: definition.columns, rows: result.rows });
}
