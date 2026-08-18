import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(
    `SELECT s.id, s.number, s.status, s.total, s.confirmed_at, c.name AS client_name,
            COALESCE(json_agg(json_build_object('id', si.id, 'serialNumber', si.serial_number, 'sku', si.sku, 'description', si.description, 'amount', si.amount, 'returned', si.returned)
              ORDER BY si.serial_number) FILTER (WHERE si.id IS NOT NULL), '[]'::json) AS items
     FROM sales s JOIN clients c ON c.id = s.client_id LEFT JOIN sale_items si ON si.sale_id = s.id
     WHERE s.organization_id = $1 GROUP BY s.id, c.id ORDER BY s.created_at DESC LIMIT 200`,
    [session.user.organizationId],
  );
  return NextResponse.json({ sales: result.rows });
}
