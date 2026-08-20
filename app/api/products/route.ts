import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, hasRole, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.productRead);
  if ('response' in auth) return auth.response;
  const search = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  const costColumn = hasRole(auth.session.user.role, ['ceo', 'manager', 'finance']) ? 'sp.cost_price' : 'NULL::numeric';
  const result = await query(
    `SELECT sp.id, sp.supplier_id, s.name AS supplier_name, sp.product_type, sp.product_name,
            sp.manufacturer, sp.model, sp.sku, sp.warranty_months, ${costColumn} AS cost_price,
            sp.selling_price, sp.currency, sp.serial_required, sp.status,
            COUNT(ii.id)::int AS stock_count,
            COUNT(ii.id) FILTER (WHERE ii.status = 'Available')::int AS available_count
     FROM supplier_products sp JOIN suppliers s ON s.id = sp.supplier_id
     LEFT JOIN inventory_items ii ON ii.supplier_product_id = sp.id
     WHERE sp.organization_id = $1 AND sp.status = 'Active'
       AND ($2 = '' OR lower(sp.product_name) LIKE '%' || $2 || '%' OR lower(sp.sku) LIKE '%' || $2 || '%' OR lower(sp.product_type) LIKE '%' || $2 || '%')
     GROUP BY sp.id, s.name
     ORDER BY sp.product_type, sp.product_name`,
    [auth.session.user.organizationId, search],
  );
  return NextResponse.json({ products: result.rows });
}
