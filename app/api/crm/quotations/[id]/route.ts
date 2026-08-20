import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const itemSchema = z.object({ productId: z.string().uuid().optional(), sku: z.string().trim().min(1).max(80).optional(), description: z.string().trim().min(1).max(200).optional(), quantity: z.number().int().positive().max(100000), unitPrice: z.number().nonnegative().max(100000000).optional() });
const updateSchema = z.object({ clientId: z.string().uuid().optional(), validUntil: z.string().date().nullable().optional(), status: z.enum(['Draft', 'Sent', 'Accepted', 'Expired', 'Cancelled']).optional(), items: z.array(itemSchema).min(1).max(200).optional() });

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const scope = auth.session.user.role === 'sales_consultant' ? ' AND q.created_by = $3' : '';
  const result = await query(
    `SELECT q.id, q.number, q.status, q.currency, q.total, q.valid_until, q.created_at, q.updated_at, c.id AS client_id, c.name AS client_name,
            COALESCE(json_agg(json_build_object('id', qi.id, 'productId', qi.supplier_product_id, 'productType', qi.product_type, 'sku', qi.sku, 'description', qi.description, 'quantity', qi.quantity, 'unitPrice', qi.unit_price) ORDER BY qi.created_at) FILTER (WHERE qi.id IS NOT NULL), '[]'::json) AS items
     FROM quotations q JOIN clients c ON c.id = q.client_id LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
     WHERE q.id = $1 AND q.organization_id = $2${scope} GROUP BY q.id, c.id`,
    auth.session.user.role === 'sales_consultant' ? [params.id, auth.session.user.organizationId, auth.session.user.id] : [params.id, auth.session.user.organizationId],
  );
  if (!result.rows[0]) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
  return NextResponse.json({ quotation: result.rows[0] });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const quotation = await withTransaction(async client => {
      const scope = auth.session.user.role === 'sales_consultant' ? ' AND created_by = $3' : '';
      const existing = await client.query(`SELECT id, status FROM quotations WHERE id = $1 AND organization_id = $2${scope} FOR UPDATE`, auth.session.user.role === 'sales_consultant' ? [params.id, auth.session.user.organizationId, auth.session.user.id] : [params.id, auth.session.user.organizationId]);
      if (!existing.rows[0]) throw Object.assign(new Error('Quotation not found.'), { code: 'NOT_FOUND' });
      if (existing.rows[0].status === 'Converted') throw Object.assign(new Error('Converted quotations cannot be edited.'), { code: 'LOCKED' });
      if (body.clientId) {
        const clientResult = await client.query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [body.clientId, auth.session.user.organizationId]);
        if (!clientResult.rows[0]) throw Object.assign(new Error('Client not found.'), { code: 'CLIENT_NOT_FOUND' });
      }
      let total: number | null = null;
      if (body.items) { const resolvedItems: Array<{ productId: string | null; productType: string | null; sku: string; description: string; quantity: number; unitPrice: number }> = []; for (const item of body.items) { const product = item.productId ? (await client.query(`SELECT id, product_type, product_name, sku, selling_price FROM supplier_products WHERE id = $1 AND organization_id = $2 AND status = 'Active'`, [item.productId, auth.session.user.organizationId])).rows[0] : null; if (item.productId && !product) throw Object.assign(new Error('Product not found.'), { code: 'PRODUCT_NOT_FOUND' }); const sku = product?.sku || item.sku; const description = product?.product_name || item.description; const unitPrice = product ? Number(product.selling_price) : item.unitPrice; if (!sku || !description || unitPrice === undefined) throw Object.assign(new Error('Quotation line is incomplete.'), { code: 'LINE_INVALID' }); resolvedItems.push({ productId: product?.id || null, productType: product?.product_type || null, sku, description, quantity: item.quantity, unitPrice }); } total = resolvedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0); await client.query('DELETE FROM quotation_items WHERE quotation_id = $1', [params.id]); for (const item of resolvedItems) await client.query('INSERT INTO quotation_items (quotation_id, supplier_product_id, product_type, sku, description, quantity, unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)', [params.id, item.productId, item.productType, item.sku, item.description, item.quantity, item.unitPrice]); }
      const result = await client.query(`UPDATE quotations SET client_id = COALESCE($1, client_id), valid_until = COALESCE($2, valid_until), status = COALESCE($3, status), total = COALESCE($4, total), updated_at = now() WHERE id = $5 RETURNING id, number, status, total, valid_until, updated_at`, [body.clientId ?? null, body.validUntil ?? null, body.status ?? null, total, params.id]);
      return result.rows[0];
    });
    return NextResponse.json({ quotation });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid quotation update.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
    if (code === 'CLIENT_NOT_FOUND') return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    if (code === 'PRODUCT_NOT_FOUND') return NextResponse.json({ error: 'Product not found.' }, { status: 404 });
    if (code === 'LINE_INVALID') return NextResponse.json({ error: 'Every quotation line must select a product or provide SKU, description, and price.' }, { status: 400 });
    if (code === 'LOCKED') return NextResponse.json({ error: 'Converted quotations cannot be edited.' }, { status: 409 });
    console.error('Quotation update failed', error);
    return NextResponse.json({ error: 'Unable to update quotation.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const scope = auth.session.user.role === 'sales_consultant' ? ' AND created_by = $3' : '';
  const values = auth.session.user.role === 'sales_consultant' ? [params.id, auth.session.user.organizationId, auth.session.user.id] : [params.id, auth.session.user.organizationId];
  const result = await query(`UPDATE quotations SET status = 'Cancelled', updated_at = now() WHERE id = $1 AND organization_id = $2 AND status <> 'Converted'${scope} RETURNING id, status`, values);
  if (!result.rows[0]) return NextResponse.json({ error: 'Quotation not found or already converted.' }, { status: 404 });
  return NextResponse.json({ quotation: result.rows[0], archived: true });
}
