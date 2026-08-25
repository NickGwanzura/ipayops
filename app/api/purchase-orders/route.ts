import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { notifyOrganizationRoles } from '@/lib/notifications';
import { writeAuditLog } from '@/lib/audit';

const itemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(100000),
  unitCost: z.number().nonnegative().max(100000000),
});

const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  destination: z.string().trim().min(2).max(160),
  expectedAt: z.string().date().optional(),
  status: z.enum(['Draft', 'Pending approval']).optional().default('Pending approval'),
  items: z.array(itemSchema).min(1).max(200),
});

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(
    `SELECT po.id, po.number, po.destination, po.status, po.currency, po.total, po.expected_at, po.created_at,
            s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
            COALESCE(SUM(poi.quantity), 0)::int AS ordered_quantity,
            COALESCE(SUM(poi.received_quantity), 0)::int AS received_quantity
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
     WHERE po.organization_id = $1
     GROUP BY po.id, s.id
     ORDER BY po.created_at DESC`,
    [session.user.organizationId],
  );
  return NextResponse.json({ purchaseOrders: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = purchaseOrderSchema.parse(await request.json());
    const order = await withTransaction(async client => {
      const supplier = await client.query(
        'SELECT id FROM suppliers WHERE id = $1 AND organization_id = $2 AND status = \'Active\' FOR SHARE',
        [body.supplierId, session.user.organizationId],
      );
      if (!supplier.rows[0]) throw Object.assign(new Error('Supplier not found.'), { code: 'SUPPLIER_NOT_FOUND' });
      const number = `PO-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const total = body.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
      const header = await client.query(
        `INSERT INTO purchase_orders (organization_id, number, supplier_id, destination, status, total, expected_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, number, supplier_id, destination, status, currency, total, expected_at, created_at`,
        [session.user.organizationId, number, body.supplierId, body.destination, body.status, total, body.expectedAt || null, session.user.id],
      );
      for (const item of body.items) {
        const product = await client.query(
          `SELECT id, product_type, product_name, sku, serial_required
           FROM supplier_products
           WHERE id = $1 AND supplier_id = $2 AND organization_id = $3 AND status = 'Active'`,
          [item.productId, body.supplierId, session.user.organizationId],
        );
        if (!product.rows[0]) throw Object.assign(new Error('Supplier product not found.'), { code: 'PRODUCT_NOT_FOUND' });
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, supplier_product_id, product_type, serial_required, sku, description, quantity, unit_cost)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [header.rows[0].id, product.rows[0].id, product.rows[0].product_type, product.rows[0].serial_required, product.rows[0].sku, product.rows[0].product_name, item.quantity, item.unitCost],
        );
      }
      return header.rows[0];
    });
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'purchase_order.submitted', entityType: 'purchase_order', entityId: order.id, metadata: { number: order.number, status: order.status, total: order.total }, request });
    await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager'], excludeUserId: session.user.id, eventType: 'purchase_order.submitted', subject: `Purchase order ${order.number} requires approval`, eyebrow: 'Procurement approval', title: 'Purchase order submitted', summary: 'A serialized procurement order is waiting for approval before receiving can begin.', fields: [{ label: 'Purchase order', value: order.number }, { label: 'Status', value: order.status }, { label: 'Total', value: String(order.total) }], action: { label: 'Open procurement', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Procurement` } });
    return NextResponse.json({ purchaseOrder: order }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Supplier, destination, and at least one valid line item are required.' }, { status: 400 });
    if ((error as { code?: string }).code === 'SUPPLIER_NOT_FOUND' || (error as { code?: string }).code === 'PRODUCT_NOT_FOUND') return NextResponse.json({ error: 'Active supplier or supplier product not found.' }, { status: 404 });
    console.error('Purchase order create failed', error);
    return NextResponse.json({ error: 'Unable to create purchase order.' }, { status: 500 });
  }
}
