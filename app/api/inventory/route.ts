import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, hasRole, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.inventoryRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const search = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  const status = request.nextUrl.searchParams.get('status')?.trim() || '';
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || '1') || 1);
  const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get('pageSize') || '50') || 50));
  const offset = (page - 1) * pageSize;
  const costColumn = hasRole(session.user.role, ['ceo', 'manager', 'finance']) ? 'cost_price' : 'NULL::numeric';
  const result = await query(
    `SELECT id, serial_number, sku, description, location, status, client_name, received_at, updated_at,
            product_type, supplier_product_id, ${costColumn} AS cost_price, selling_price,
            COUNT(*) OVER()::int AS total_count
     FROM inventory_items
     WHERE organization_id = $1
       AND ($2 = '' OR lower(serial_number) LIKE '%' || $2 || '%' OR lower(sku) LIKE '%' || $2 || '%' OR lower(description) LIKE '%' || $2 || '%')
       AND ($3 = '' OR status = $3)
     ORDER BY received_at DESC
     LIMIT $4 OFFSET $5`,
    [session.user.organizationId, search, status, pageSize, offset],
  );
  const total = result.rows[0]?.total_count || 0;
  return NextResponse.json({ inventory: result.rows.map(({ total_count: _totalCount, ...item }) => item), pagination: { page, pageSize, total, hasMore: offset + result.rows.length < total } });
}
