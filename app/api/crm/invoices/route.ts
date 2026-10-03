import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { organizationTimeZone } from '@/lib/timezone';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.financeRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const timeZone = await organizationTimeZone(session.user.organizationId);
  const [result, totals] = await Promise.all([query(`SELECT i.id, i.number, i.status, i.total, i.paid_amount, (i.total - i.paid_amount) AS outstanding, i.issued_at, i.due_at, c.name AS client_name, s.number AS sale_number FROM invoices i JOIN clients c ON c.id = i.client_id JOIN sales s ON s.id = i.sale_id WHERE i.organization_id = $1 ORDER BY i.created_at DESC LIMIT 200`, [session.user.organizationId]),
    // Debtor totals are computed over every open invoice, not just the 200 most recent rows listed above.
    query(`SELECT COALESCE(SUM(i.total - i.paid_amount), 0) AS outstanding,
                  COUNT(*) FILTER (WHERE i.due_at < (now() AT TIME ZONE $2)::date)::int AS overdue_count,
                  COALESCE(SUM(i.total - i.paid_amount) FILTER (WHERE i.due_at < (now() AT TIME ZONE $2)::date), 0) AS overdue_amount
           FROM invoices i WHERE i.organization_id = $1 AND i.status = 'Issued' AND i.total > i.paid_amount`, [session.user.organizationId, timeZone])]);
  return NextResponse.json({ invoices: result.rows, summary: totals.rows[0] });
}
