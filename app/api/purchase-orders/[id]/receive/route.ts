import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { notifyOrganizationRoles, sendNotification } from '@/lib/notifications';
import { writeAuditLog } from '@/lib/audit';

const receiptSchema = z.object({
  notes: z.string().trim().max(500).optional().default(''),
  items: z.array(z.object({
    purchaseOrderItemId: z.string().uuid(),
    quantity: z.number().int().positive().max(100000),
    serialNumbers: z.array(z.string().trim().min(1).max(160)).min(1),
    location: z.string().trim().min(1).max(160),
  })).min(1),
});

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = receiptSchema.parse(await request.json());
    for (const item of body.items) {
      if (item.serialNumbers.length !== item.quantity) throw new Error('Each received unit requires one serial number.');
    }
    const serials = body.items.flatMap(item => item.serialNumbers.map(serial => serial.trim().toLowerCase()));
    if (new Set(serials).size !== serials.length) throw new Error('Serial numbers must be unique within a receipt.');
    const receipt = await withTransaction(async client => {
      const orderResult = await client.query(
        `SELECT id, number, supplier_id, created_by, status FROM purchase_orders
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [params.id, session.user.organizationId],
      );
      const order = orderResult.rows[0];
      if (!order || order.status === 'Cancelled') throw Object.assign(new Error('Purchase order not found.'), { code: 'ORDER_NOT_FOUND' });
      if (!['Approved', 'Partially received'].includes(order.status)) throw Object.assign(new Error('Purchase order is not approved for receiving.'), { code: 'ORDER_NOT_APPROVED' });
      const number = `GR-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const receiptResult = await client.query(
        `INSERT INTO goods_receipts (organization_id, purchase_order_id, number, received_by, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, number, received_at`,
        [session.user.organizationId, params.id, number, session.user.id, body.notes],
      );
      for (const item of body.items) {
        const itemResult = await client.query(
          `SELECT poi.id, poi.supplier_product_id, poi.product_type, poi.serial_required, poi.sku, poi.description, poi.quantity, poi.received_quantity, poi.unit_cost
           FROM purchase_order_items poi
           WHERE poi.id = $1 AND poi.purchase_order_id = $2
           FOR UPDATE OF poi`,
          [item.purchaseOrderItemId, params.id],
        );
        const orderItemBase = itemResult.rows[0];
        const supplierProduct = orderItemBase?.supplier_product_id
          ? (await client.query(
              `SELECT cost_price, selling_price
               FROM supplier_products
               WHERE id = $1 AND organization_id = $2`,
              [orderItemBase.supplier_product_id, session.user.organizationId],
            )).rows[0]
          : null;
        const orderItem = orderItemBase && {
          ...orderItemBase,
          cost_price: supplierProduct?.cost_price ?? orderItemBase.unit_cost,
          selling_price: supplierProduct?.selling_price ?? 0,
        };
        if (!orderItem) throw Object.assign(new Error('Purchase order line not found.'), { code: 'LINE_NOT_FOUND' });
        if (orderItem.received_quantity + item.quantity > orderItem.quantity) throw Object.assign(new Error('Receipt exceeds outstanding quantity.'), { code: 'OVER_RECEIPT' });
        await client.query(
          'INSERT INTO goods_receipt_items (goods_receipt_id, purchase_order_item_id, quantity) VALUES ($1, $2, $3)',
          [receiptResult.rows[0].id, item.purchaseOrderItemId, item.quantity],
        );
        await client.query(
          'UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id = $2',
          [item.quantity, item.purchaseOrderItemId],
        );
        for (const serialNumber of item.serialNumbers) {
          await client.query(
            `INSERT INTO inventory_items (organization_id, purchase_order_item_id, supplier_product_id, product_type, serial_number, sku, description, location, cost_price, selling_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [session.user.organizationId, item.purchaseOrderItemId, orderItem.supplier_product_id, orderItem.product_type, serialNumber.trim(), orderItem.sku, orderItem.description, item.location, orderItem.cost_price, orderItem.selling_price],
          );
        }
      }
      const outstanding = await client.query(
        `SELECT COUNT(*)::int AS count FROM purchase_order_items
         WHERE purchase_order_id = $1 AND received_quantity < quantity`,
        [params.id],
      );
      await client.query(
        `UPDATE purchase_orders SET status = $1, updated_at = now() WHERE id = $2`,
        [outstanding.rows[0].count === 0 ? 'Fully received' : 'Partially received', params.id],
      );
      return { ...receiptResult.rows[0], orderNumber: order.number, createdBy: order.created_by };
    });
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'goods_receipt.posted', entityType: 'goods_receipt', entityId: receipt.id, metadata: { number: receipt.number, purchaseOrder: receipt.orderNumber, serialCount: serials.length }, request });
    if (receipt.createdBy) {
      const creator = await query<{ email: string; full_name: string }>('SELECT email, full_name FROM users WHERE id = $1 AND organization_id = $2', [receipt.createdBy, session.user.organizationId]);
      if (creator.rows[0]) await sendNotification({ organizationId: session.user.organizationId, eventType: 'goods_receipt.posted', recipientEmail: creator.rows[0].email, recipientName: creator.rows[0].full_name, subject: `Goods receipt ${receipt.number} posted`, eyebrow: 'Serialized receiving', title: 'Goods receipt posted', summary: 'Serialized inventory has been received against your purchase order.', fields: [{ label: 'Receipt', value: receipt.number }, { label: 'Purchase order', value: receipt.orderNumber }, { label: 'Serial units', value: String(serials.length) }], action: { label: 'Open inventory', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Inventory` } });
    }
    await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'goods_receipt.posted', subject: `Goods receipt ${receipt.number} posted`, eyebrow: 'Inventory oversight', title: 'Serialized stock received', summary: 'A goods receipt has added serialized stock to the organization inventory.', fields: [{ label: 'Receipt', value: receipt.number }, { label: 'Purchase order', value: receipt.orderNumber }, { label: 'Serial units', value: String(serials.length) }], action: { label: 'Open inventory', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Inventory` } });
    return NextResponse.json({ receipt }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || ['Each received unit requires one serial number.', 'Serial numbers must be unique within a receipt.'].includes((error as Error).message)) return NextResponse.json({ error: 'Receipt lines and one unique serial number per unit are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'ORDER_NOT_FOUND' || code === 'LINE_NOT_FOUND') return NextResponse.json({ error: 'Purchase order or line not found.' }, { status: 404 });
    if (code === 'ORDER_NOT_APPROVED') return NextResponse.json({ error: 'Purchase order must be approved before receiving.' }, { status: 409 });
    if (code === 'OVER_RECEIPT') return NextResponse.json({ error: 'Receipt exceeds the outstanding quantity.' }, { status: 409 });
    if (code === '23505') return NextResponse.json({ error: 'One or more serial numbers already exist.' }, { status: 409 });
    console.error('Goods receipt failed', error);
    return NextResponse.json({ error: 'Unable to receive stock.' }, { status: 500 });
  }
}
