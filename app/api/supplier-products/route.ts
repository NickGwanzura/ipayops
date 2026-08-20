import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const supplierId = request.nextUrl.searchParams.get('supplierId');
  const result = await query(
    `SELECT sp.id, sp.supplier_id, s.code AS supplier_code, s.name AS supplier_name,
            sp.product_type, sp.product_name, sp.manufacturer, sp.model, sp.sku,
            sp.warranty_months, sp.unit_cost, sp.cost_price,
            sp.selling_price, sp.currency, sp.serial_required, sp.status
     FROM supplier_products sp
     JOIN suppliers s ON s.id = sp.supplier_id
     WHERE sp.organization_id = $1 AND sp.status = 'Active'
       AND ($2::uuid IS NULL OR sp.supplier_id = $2)
     ORDER BY s.name, sp.product_type, sp.product_name`,
    [auth.session.user.organizationId, supplierId || null],
  );
  return NextResponse.json({ products: result.rows });
}
