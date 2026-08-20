import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.commissionRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(
    `SELECT ce.id, ce.sale_id, ce.consultant_id, ce.rate, ce.amount, ce.status, ce.created_at,
            s.number AS sale_number, s.total AS sale_total, c.name AS client_name, u.full_name AS consultant_name
     FROM commission_entries ce JOIN sales s ON s.id = ce.sale_id JOIN clients c ON c.id = s.client_id
     LEFT JOIN users u ON u.id = ce.consultant_id
     WHERE ce.organization_id = $1 AND ($2::text IS NULL OR ce.consultant_id = $2::uuid) ORDER BY ce.created_at DESC LIMIT 200`,
    [session.user.organizationId, session.user.role === 'sales_consultant' ? session.user.id : null],
  );
  return NextResponse.json({ commissions: result.rows });
}
