import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, hasRole, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';

const productSchema = z.object({
  supplierId: z.string().uuid(),
  productType: z.enum(['Laptop', 'POS']),
  productName: z.string().trim().min(2).max(160),
  manufacturer: z.string().trim().max(120).optional().default(''),
  model: z.string().trim().max(120).optional().default(''),
  sku: z.string().trim().min(2).max(80),
  warrantyMonths: z.number().int().min(0).max(120),
  costPrice: z.number().nonnegative().max(100000000),
  sellingPrice: z.number().nonnegative().max(100000000),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).default('USD'),
});

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.productManage);
    if ('response' in auth) return auth.response;
    const body = productSchema.parse(await request.json());
    const supplier = await query(`SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2 AND status = 'Active'`, [body.supplierId, auth.session.user.organizationId]);
    if (!supplier.rows[0]) return NextResponse.json({ error: 'Active supplier not found.' }, { status: 404 });
    const result = await query(
      `INSERT INTO supplier_products (organization_id, supplier_id, product_type, product_name, manufacturer, model, sku, warranty_months, unit_cost, cost_price, selling_price, currency, serial_required)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, true)
       RETURNING id, supplier_id, product_type, product_name, manufacturer, model, sku, warranty_months, cost_price, selling_price, currency, serial_required, status`,
      [auth.session.user.organizationId, body.supplierId, body.productType, body.productName, body.manufacturer, body.model, body.sku, body.warrantyMonths, body.costPrice, body.sellingPrice, body.currency.toUpperCase()],
    );
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'product.created', entityType: 'supplier_product', entityId: result.rows[0].id, metadata: { sku: body.sku, productType: body.productType }, request });
    return NextResponse.json({ product: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid supplier, Laptop/POS type, product, SKU, warranty, and prices.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'That SKU already exists for this supplier.' }, { status: 409 });
    console.error('Product creation failed', error);
    return NextResponse.json({ error: 'Unable to create product.' }, { status: 500 });
  }
}

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
