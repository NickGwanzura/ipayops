import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, hasRole, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.inventoryRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const search = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  const status = request.nextUrl.searchParams.get('status')?.trim() || '';
  const costColumn = hasRole(session.user.role, ['ceo', 'manager', 'finance']) ? 'cost_price' : 'NULL::numeric';
  const result = await query(
    `SELECT id, serial_number, sku, description, location, status, client_name, received_at, updated_at,
            product_type, supplier_product_id, ${costColumn} AS cost_price, selling_price
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
