import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const supplierSchema = z.object({
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(160),
  contactName: z.string().trim().max(160).optional().default(''),
  phone: z.string().trim().max(60).optional().default(''),
  paymentTerms: z.string().trim().max(80).optional().default(''),
  leadTimeDays: z.number().int().min(0).max(365).optional().default(0),
  products: z.array(z.object({
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
  })).min(1).max(50).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const search = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  const result = await query(
    `SELECT id, code, name, contact_name, phone, payment_terms, lead_time_days, status, created_at, updated_at
     FROM suppliers
     WHERE organization_id = $1
       AND ($2 = '' OR lower(name) LIKE '%' || $2 || '%' OR lower(code) LIKE '%' || $2 || '%')
     ORDER BY name ASC`,
    [session.user.organizationId, search],
  );
  return NextResponse.json({ suppliers: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = supplierSchema.parse(await request.json());
    const code = body.code || `SUP-${Date.now().toString().slice(-6)}`;
    const result = await withTransaction(async client => {
      const supplierResult = await client.query(
        `INSERT INTO suppliers (organization_id, code, name, contact_name, phone, payment_terms, lead_time_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, code, name, contact_name, phone, payment_terms, lead_time_days, status, created_at, updated_at`,
        [session.user.organizationId, code, body.name, body.contactName, body.phone, body.paymentTerms, body.leadTimeDays],
      );
      const products = [];
      for (const product of body.products || []) {
        const productResult = await client.query(
          `INSERT INTO supplier_products (organization_id, supplier_id, product_type, product_name, manufacturer, model, sku, warranty_months, unit_cost, cost_price, selling_price, currency)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11)
           RETURNING id, product_type, product_name, manufacturer, model, sku, warranty_months, unit_cost, cost_price, selling_price, currency, serial_required, status`,
          [session.user.organizationId, supplierResult.rows[0].id, product.productType, product.productName, product.manufacturer, product.model, product.sku, product.warrantyMonths, product.costPrice ?? product.unitCost, product.sellingPrice, product.currency.toUpperCase()],
        );
        products.push(productResult.rows[0]);
      }
      return { supplier: supplierResult.rows[0], products };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Supplier name and valid supplier details are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'Supplier code already exists.' }, { status: 409 });
    console.error('Supplier create failed', error);
    return NextResponse.json({ error: 'Unable to create supplier.' }, { status: 500 });
  }
}
