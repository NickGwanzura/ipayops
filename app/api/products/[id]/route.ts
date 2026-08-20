import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';

const priceSchema = z.object({ costPrice: z.number().nonnegative().max(100000000).optional(), sellingPrice: z.number().nonnegative().max(100000000).optional() }).refine(value => value.costPrice !== undefined || value.sellingPrice !== undefined, 'At least one price is required.');

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.productManage);
    if ('response' in auth) return auth.response;
    const body = priceSchema.parse(await request.json());
    const result = await query(`UPDATE supplier_products SET cost_price = COALESCE($1, cost_price), unit_cost = COALESCE($1, unit_cost), selling_price = COALESCE($2, selling_price), updated_at = now() WHERE id = $3 AND organization_id = $4 RETURNING id, product_name, sku, cost_price, selling_price, currency`, [body.costPrice ?? null, body.sellingPrice ?? null, params.id, auth.session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'product.prices_updated', entityType: 'supplier_product', entityId: result.rows[0].id, metadata: { sku: result.rows[0].sku, costPrice: body.costPrice, sellingPrice: body.sellingPrice }, request });
    return NextResponse.json({ product: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid cost price or selling price.' }, { status: 400 });
    console.error('Product price update failed', error);
    return NextResponse.json({ error: 'Unable to update product prices.' }, { status: 500 });
  }
}
