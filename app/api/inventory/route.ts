import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const search = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  const status = request.nextUrl.searchParams.get('status')?.trim() || '';
  const result = await query(
    `SELECT id, serial_number, sku, description, location, status, client_name, received_at, updated_at
     FROM inventory_items
     WHERE organization_id = $1
       AND ($2 = '' OR lower(serial_number) LIKE '%' || $2 || '%' OR lower(sku) LIKE '%' || $2 || '%' OR lower(description) LIKE '%' || $2 || '%')
       AND ($3 = '' OR status = $3)
     ORDER BY received_at DESC
     LIMIT 500`,
    [session.user.organizationId, search, status],
  );
  return NextResponse.json({ inventory: result.rows });
}
