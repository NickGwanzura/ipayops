import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(
    `SELECT ce.id, ce.sale_id, ce.consultant_id, ce.rate, ce.amount, ce.status, ce.created_at,
            s.number AS sale_number, s.total AS sale_total, c.name AS client_name, u.full_name AS consultant_name
     FROM commission_entries ce JOIN sales s ON s.id = ce.sale_id JOIN clients c ON c.id = s.client_id
     LEFT JOIN users u ON u.id = ce.consultant_id
     WHERE ce.organization_id = $1 ORDER BY ce.created_at DESC LIMIT 200`,
    [session.user.organizationId],
  );
  return NextResponse.json({ commissions: result.rows });
}
