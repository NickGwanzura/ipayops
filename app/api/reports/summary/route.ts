import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const from = request.nextUrl.searchParams.get('from') || `${new Date().getFullYear()}-01-01`;
  const to = request.nextUrl.searchParams.get('to') || new Date().toISOString().slice(0, 10);
  const [summary, periods] = await Promise.all([
    query(`SELECT COALESCE((SELECT SUM(total) FROM sales WHERE organization_id = $1 AND confirmed_at::date BETWEEN $2::date AND $3::date), 0) AS revenue, COALESCE((SELECT COUNT(*) FROM inventory_items WHERE organization_id = $1 AND status IN ('Sold', 'Installed')), 0)::int AS devices_delivered, COALESCE((SELECT COUNT(*) FROM job_cards WHERE organization_id = $1 AND status = 'Completed' AND created_at::date BETWEEN $2::date AND $3::date), 0)::int AS jobs_completed, COALESCE((SELECT COUNT(*) FROM warranty_claims WHERE organization_id = $1 AND created_at::date BETWEEN $2::date AND $3::date), 0)::int AS warranty_claims`, [session.user.organizationId, from, to]),
    query(`SELECT to_char(date_trunc('week', s.confirmed_at), 'DD Mon') || '–' || to_char(date_trunc('week', s.confirmed_at) + interval '6 days', 'DD Mon') AS period, COALESCE(SUM(s.total), 0) AS revenue, COUNT(si.id)::int AS units, COALESCE((SELECT COUNT(*) FROM job_cards j WHERE j.organization_id = s.organization_id AND j.created_at::date BETWEEN date_trunc('week', s.confirmed_at)::date AND (date_trunc('week', s.confirmed_at) + interval '6 days')::date), 0)::int AS jobs FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id WHERE s.organization_id = $1 AND s.confirmed_at::date BETWEEN $2::date AND $3::date GROUP BY s.organization_id, date_trunc('week', s.confirmed_at) ORDER BY date_trunc('week', s.confirmed_at) DESC LIMIT 20`, [session.user.organizationId, from, to]),
  ]);
  return NextResponse.json({ from, to, summary: summary.rows[0], periods: periods.rows });
}
