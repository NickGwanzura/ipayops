import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const quotationSchema = z.object({
  clientId: z.string().uuid(), opportunityId: z.string().uuid().optional(), validUntil: z.string().date().optional(),
  items: z.array(z.object({ productId: z.string().uuid().optional(), sku: z.string().trim().min(1).max(80).optional(), description: z.string().trim().min(1).max(200).optional(), quantity: z.number().int().positive().max(100000), unitPrice: z.number().nonnegative().max(100000000).optional() })).min(1).max(200),
});

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const ownershipClause = session.user.role === 'sales_consultant' ? ' AND q.created_by = $2' : '';
  const parameters = session.user.role === 'sales_consultant' ? [session.user.organizationId, session.user.id] : [session.user.organizationId];
  const result = await query(
    `SELECT q.id, q.number, q.status, q.currency, q.total, q.valid_until, q.created_at, c.id AS client_id, c.name AS client_name,
            COALESCE(json_agg(json_build_object('id', qi.id, 'productId', qi.supplier_product_id, 'productType', qi.product_type, 'sku', qi.sku, 'description', qi.description, 'quantity', qi.quantity, 'unitPrice', qi.unit_price)
              ORDER BY qi.created_at) FILTER (WHERE qi.id IS NOT NULL), '[]'::json) AS items
     FROM quotations q JOIN clients c ON c.id = q.client_id LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
     WHERE q.organization_id = $1${ownershipClause} GROUP BY q.id, c.id ORDER BY q.created_at DESC LIMIT 200`,
    parameters,
  );
  return NextResponse.json({ quotations: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = quotationSchema.parse(await request.json());
    const quotation = await withTransaction(async client => {
      const clientResult = await client.query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [body.clientId, session.user.organizationId]);
      if (!clientResult.rows[0]) throw Object.assign(new Error('Client not found.'), { code: 'CLIENT_NOT_FOUND' });
      if (body.opportunityId) {
        const opportunityResult = await client.query('SELECT id FROM opportunities WHERE id = $1 AND organization_id = $2', [body.opportunityId, session.user.organizationId]);
        if (!opportunityResult.rows[0]) throw Object.assign(new Error('Opportunity not found.'), { code: 'OPPORTUNITY_NOT_FOUND' });
      }
      const number = `QUO-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const resolvedItems = [] as Array<{ productId: string | null; productType: string | null; sku: string; description: string; quantity: number; unitPrice: number }>;
      for (const item of body.items) {
        const product = item.productId ? (await client.query(`SELECT id, product_type, product_name, sku, selling_price FROM supplier_products WHERE id = $1 AND organization_id = $2 AND status = 'Active'`, [item.productId, session.user.organizationId])).rows[0] : null;
        if (item.productId && !product) throw Object.assign(new Error('Product not found.'), { code: 'PRODUCT_NOT_FOUND' });
        const sku = product?.sku || item.sku; const description = product?.product_name || item.description; const unitPrice = product ? Number(product.selling_price) : item.unitPrice;
        if (!sku || !description || unitPrice === undefined) throw Object.assign(new Error('Product or quotation line details are incomplete.'), { code: 'LINE_INVALID' });
        resolvedItems.push({ productId: product?.id || null, productType: product?.product_type || null, sku, description, quantity: item.quantity, unitPrice });
      }
      const total = resolvedItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      const header = await client.query(
        `INSERT INTO quotations (organization_id, number, client_id, opportunity_id, total, valid_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, number, status, total, valid_until, created_at`,
        [session.user.organizationId, number, body.clientId, body.opportunityId || null, total, body.validUntil || null, session.user.id],
      );
      for (const item of resolvedItems) await client.query('INSERT INTO quotation_items (quotation_id, supplier_product_id, product_type, sku, description, quantity, unit_price) VALUES ($1, $2, $3, $4, $5, $6, $7)', [header.rows[0].id, item.productId, item.productType, item.sku, item.description, item.quantity, item.unitPrice]);
      return header.rows[0];
    });
    return NextResponse.json({ quotation }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Client and at least one valid quotation line are required.' }, { status: 400 });
    if ((error as { code?: string }).code === 'LINE_INVALID') return NextResponse.json({ error: 'Every quotation line must select a product or provide SKU, description, and price.' }, { status: 400 });
    if ((error as { code?: string }).code === 'CLIENT_NOT_FOUND' || (error as { code?: string }).code === 'PRODUCT_NOT_FOUND') return NextResponse.json({ error: 'Client or product not found.' }, { status: 404 });
    if ((error as { code?: string }).code === 'OPPORTUNITY_NOT_FOUND') return NextResponse.json({ error: 'Opportunity not found.' }, { status: 404 });
    console.error('Quotation create failed', error);
    return NextResponse.json({ error: 'Unable to create quotation.' }, { status: 500 });
  }
}
