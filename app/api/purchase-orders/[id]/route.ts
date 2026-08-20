import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';

const itemSchema = z.object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(100000), unitCost: z.number().nonnegative().max(100000000) });
const updateSchema = z.object({ supplierId: z.string().uuid().optional(), destination: z.string().trim().min(2).max(160).optional(), expectedAt: z.string().date().nullable().optional(), status: z.enum(['Draft', 'Pending approval', 'Cancelled']).optional(), items: z.array(itemSchema).min(1).max(200).optional() });

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const { session } = auth;

  const result = await query(
    `SELECT po.id, po.number, po.destination, po.status, po.currency, po.total, po.expected_at, po.created_at,
            s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
            COALESCE(json_agg(json_build_object(
              'id', poi.id,
              'productId', poi.supplier_product_id,
              'productType', poi.product_type,
              'sku', poi.sku,
              'description', poi.description,
              'quantity', poi.quantity,
              'receivedQuantity', poi.received_quantity,
              'unitCost', poi.unit_cost
            ) ORDER BY poi.created_at) FILTER (WHERE poi.id IS NOT NULL), '[]'::json) AS items,
            COALESCE((SELECT json_agg(json_build_object('id', gr.id, 'number', gr.number, 'receivedAt', gr.received_at, 'notes', gr.notes, 'receivedBy', ru.full_name) ORDER BY gr.received_at DESC) FROM goods_receipts gr LEFT JOIN users ru ON ru.id = gr.received_by WHERE gr.purchase_order_id = po.id), '[]'::json) AS receipts
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
     WHERE po.id = $1 AND po.organization_id = $2
     GROUP BY po.id, s.id`,
    [params.id, session.user.organizationId],
  );

  if (!result.rows[0]) return NextResponse.json({ error: 'Purchase order not found.' }, { status: 404 });
  return NextResponse.json({ purchaseOrder: result.rows[0] });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const order = await withTransaction(async client => {
      const existing = await client.query(`SELECT id, status FROM purchase_orders WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [params.id, auth.session.user.organizationId]);
      if (!existing.rows[0]) throw Object.assign(new Error('Purchase order not found.'), { code: 'NOT_FOUND' });
      const received = await client.query(`SELECT COALESCE(SUM(received_quantity), 0)::int AS received_quantity FROM purchase_order_items WHERE purchase_order_id = $1`, [params.id]);
      if (received.rows[0].received_quantity > 0 && (body.items || body.supplierId)) throw Object.assign(new Error('Received orders cannot change supplier or lines.'), { code: 'RECEIVED' });
      if (existing.rows[0].status === 'Fully received') throw Object.assign(new Error('Fully received orders cannot be edited.'), { code: 'LOCKED' });
      if (body.supplierId) { const supplier = await client.query(`SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2 AND status = 'Active'`, [body.supplierId, auth.session.user.organizationId]); if (!supplier.rows[0]) throw Object.assign(new Error('Supplier not found.'), { code: 'SUPPLIER_NOT_FOUND' }); }
      let total: number | null = null;
      if (body.items) {
        total = body.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
        await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [params.id]);
        for (const item of body.items) {
          const product = await client.query(`SELECT id, product_type, product_name, sku, serial_required FROM supplier_products WHERE id = $1 AND supplier_id = COALESCE($2, (SELECT supplier_id FROM purchase_orders WHERE id = $3)) AND organization_id = $4 AND status = 'Active'`, [item.productId, body.supplierId || null, params.id, auth.session.user.organizationId]);
          if (!product.rows[0]) throw Object.assign(new Error('Supplier product not found.'), { code: 'PRODUCT_NOT_FOUND' });
          await client.query('INSERT INTO purchase_order_items (purchase_order_id, supplier_product_id, product_type, serial_required, sku, description, quantity, unit_cost) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [params.id, product.rows[0].id, product.rows[0].product_type, product.rows[0].serial_required, product.rows[0].sku, product.rows[0].product_name, item.quantity, item.unitCost]);
        }
      }
      const result = await client.query(`UPDATE purchase_orders SET supplier_id = COALESCE($1, supplier_id), destination = COALESCE($2, destination), expected_at = COALESCE($3, expected_at), status = COALESCE($4, status), total = COALESCE($5, total), updated_at = now() WHERE id = $6 RETURNING id, number, supplier_id, destination, status, total, expected_at, updated_at`, [body.supplierId ?? null, body.destination ?? null, body.expectedAt ?? null, body.status ?? null, total, params.id]);
      return result.rows[0];
    });
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'purchase_order.updated', entityType: 'purchase_order', entityId: order.id, metadata: { number: order.number, status: order.status }, request });
    return NextResponse.json({ purchaseOrder: order });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid purchase-order update.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND' || code === 'SUPPLIER_NOT_FOUND' || code === 'PRODUCT_NOT_FOUND') return NextResponse.json({ error: 'Purchase order, active supplier, or supplier product not found.' }, { status: 404 });
    if (code === 'RECEIVED' || code === 'LOCKED') return NextResponse.json({ error: 'Received purchase orders cannot change supplier or lines.' }, { status: 409 });
    console.error('Purchase-order update failed', error);
    return NextResponse.json({ error: 'Unable to update purchase order.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE purchase_orders SET status = 'Cancelled', updated_at = now() WHERE id = $1 AND organization_id = $2 AND status NOT IN ('Fully received', 'Cancelled') RETURNING id, number, status`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Purchase order not found or cannot be cancelled.' }, { status: 409 });
  await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'purchase_order.cancelled', entityType: 'purchase_order', entityId: result.rows[0].id, metadata: { number: result.rows[0].number }, request });
  return NextResponse.json({ purchaseOrder: result.rows[0], archived: true });
}
