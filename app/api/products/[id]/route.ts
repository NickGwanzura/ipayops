import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';

const productSchema = z.object({
  productName: z.string().trim().min(2).max(160).optional(),
  manufacturer: z.string().trim().max(120).optional(),
  model: z.string().trim().max(120).optional(),
  sku: z.string().trim().min(2).max(80).optional(),
  warrantyMonths: z.number().int().min(0).max(120).optional(),
  costPrice: z.number().nonnegative().max(100000000).optional(),
  sellingPrice: z.number().nonnegative().max(100000000).optional(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).optional(),
}).refine(value => Object.values(value).some(item => item !== undefined), 'At least one product field is required.');

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.productManage);
    if ('response' in auth) return auth.response;
    const body = productSchema.parse(await request.json());
    const result = await query(`UPDATE supplier_products SET product_name = COALESCE($1, product_name), manufacturer = COALESCE($2, manufacturer), model = COALESCE($3, model), sku = COALESCE($4, sku), warranty_months = COALESCE($5, warranty_months), cost_price = COALESCE($6, cost_price), unit_cost = COALESCE($6, unit_cost), selling_price = COALESCE($7, selling_price), currency = COALESCE($8, currency), updated_at = now() WHERE id = $9 AND organization_id = $10 RETURNING id, supplier_id, product_type, product_name, manufacturer, model, sku, warranty_months, cost_price, selling_price, currency, serial_required, status`, [body.productName ?? null, body.manufacturer ?? null, body.model ?? null, body.sku ?? null, body.warrantyMonths ?? null, body.costPrice ?? null, body.sellingPrice ?? null, body.currency?.toUpperCase() ?? null, params.id, auth.session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'product.updated', entityType: 'supplier_product', entityId: result.rows[0].id, metadata: { sku: result.rows[0].sku, costPrice: body.costPrice, sellingPrice: body.sellingPrice }, request });
    return NextResponse.json({ product: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter at least one valid product field.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'That SKU already exists for this supplier.' }, { status: 409 });
    console.error('Product update failed', error);
    return NextResponse.json({ error: 'Unable to update product.' }, { status: 500 });
  }
}
