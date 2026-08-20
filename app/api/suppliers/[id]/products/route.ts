import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const productSchema = z.object({
  productType: z.enum(['Laptop', 'POS']),
  productName: z.string().trim().min(2).max(160),
  manufacturer: z.string().trim().max(120).optional().default(''),
  model: z.string().trim().max(120).optional().default(''),
  sku: z.string().trim().min(2).max(80),
  warrantyMonths: z.number().int().min(0).max(120).default(12),
  unitCost: z.number().nonnegative().max(100000000).default(0),
  costPrice: z.number().nonnegative().max(100000000).optional(),
  sellingPrice: z.number().nonnegative().max(100000000).default(0),
  currency: z.string().trim().min(3).max(3).default('USD'),
});

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const result = await query(
      `SELECT id, supplier_id, product_type, product_name, manufacturer, model, sku,
            warranty_months, unit_cost, cost_price, selling_price, currency, serial_required, status
     FROM supplier_products
     WHERE supplier_id = $1 AND organization_id = $2
     ORDER BY product_type, product_name`,
    [params.id, auth.session.user.organizationId],
  );
  return NextResponse.json({ products: result.rows });
}

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const body = productSchema.parse(await request.json());
    const supplier = await query(`SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2`, [params.id, auth.session.user.organizationId]);
    if (!supplier.rows[0]) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 });
    const result = await query(
      `INSERT INTO supplier_products (organization_id, supplier_id, product_type, product_name, manufacturer, model, sku, warranty_months, unit_cost, cost_price, selling_price, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)
       RETURNING id, supplier_id, product_type, product_name, manufacturer, model, sku, warranty_months, unit_cost, cost_price, selling_price, currency, serial_required, status`,
      [auth.session.user.organizationId, params.id, body.productType, body.productName, body.manufacturer, body.model, body.sku, body.warrantyMonths, body.costPrice ?? body.unitCost, body.sellingPrice, body.currency.toUpperCase()],
    );
    return NextResponse.json({ product: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Product type, name, SKU, and valid warranty and cost details are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'That SKU already exists for this supplier.' }, { status: 409 });
    console.error('Supplier product create failed', error);
    return NextResponse.json({ error: 'Unable to add supplier product.' }, { status: 500 });
  }
}
