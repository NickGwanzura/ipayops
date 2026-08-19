import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const definitions = {
  stock: { title: 'Stock valuation', columns: ['SKU', 'Description', 'Location', 'Status', 'Units'], sql: `SELECT sku, description, location, status, COUNT(*)::int AS units FROM inventory_items WHERE organization_id = $1 GROUP BY sku, description, location, status ORDER BY sku, location` },
  pipeline: { title: 'Pipeline conversion', columns: ['Stage', 'Opportunities', 'Pipeline value'], sql: `SELECT stage, COUNT(*)::int AS opportunities, COALESCE(SUM(value), 0)::numeric AS pipeline_value FROM opportunities WHERE organization_id = $1 AND created_at::date BETWEEN $2::date AND $3::date GROUP BY stage ORDER BY stage` },
  warranty: { title: 'Warranty performance', columns: ['Status', 'Claims', 'Open issues'], sql: `SELECT status, COUNT(*)::int AS claims, COUNT(*) FILTER (WHERE status IN ('Open', 'Under assessment', 'Repair', 'Replacement'))::int AS open_issues FROM warranty_claims WHERE organization_id = $1 AND created_at::date BETWEEN $2::date AND $3::date GROUP BY status ORDER BY status` },
  installation: { title: 'Installation turnaround', columns: ['Status', 'Jobs', 'Signed off'], sql: `SELECT status, COUNT(*)::int AS jobs, COUNT(*) FILTER (WHERE signed_at IS NOT NULL)::int AS signed_off FROM job_cards WHERE organization_id = $1 AND created_at::date BETWEEN $2::date AND $3::date GROUP BY status ORDER BY status` },
} as const;

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const type = request.nextUrl.searchParams.get('type') as keyof typeof definitions | null;
  const definition = type ? definitions[type] : null;
  if (!definition) return NextResponse.json({ error: 'Unknown report drill-down.' }, { status: 400 });
  const from = request.nextUrl.searchParams.get('from') || `${new Date().getFullYear()}-01-01`;
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const values = type === 'stock' ? [session.user.organizationId] : [session.user.organizationId, from, to];
  const result = await query(definition.sql, values);
  return NextResponse.json({ title: definition.title, columns: definition.columns, rows: result.rows });
}
