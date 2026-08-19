import { NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';

const receiptSchema = z.object({
  notes: z.string().trim().max(500).optional().default(''),
  items: z.array(z.object({
    purchaseOrderItemId: z.string().uuid(),
    quantity: z.number().int().positive().max(100000),
    serialNumbers: z.array(z.string().trim().min(1).max(160)).min(1),
    location: z.string().trim().min(1).max(160),
  })).min(1),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = receiptSchema.parse(await request.json());
    for (const item of body.items) {
      if (item.serialNumbers.length !== item.quantity) throw new Error('Each received unit requires one serial number.');
    }
    const receipt = await withTransaction(async client => {
      const orderResult = await client.query(
        `SELECT id, supplier_id, status FROM purchase_orders
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [params.id, session.user.organizationId],
      );
      const order = orderResult.rows[0];
      if (!order || order.status === 'Cancelled') throw Object.assign(new Error('Purchase order not found.'), { code: 'ORDER_NOT_FOUND' });
      const number = `GR-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const receiptResult = await client.query(
        `INSERT INTO goods_receipts (organization_id, purchase_order_id, number, received_by, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, number, received_at`,
        [session.user.organizationId, params.id, number, session.user.id, body.notes],
      );
      for (const item of body.items) {
        const itemResult = await client.query(
          `SELECT id, sku, description, quantity, received_quantity
           FROM purchase_order_items WHERE id = $1 AND purchase_order_id = $2 FOR UPDATE`,
          [item.purchaseOrderItemId, params.id],
        );
        const orderItem = itemResult.rows[0];
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
            `INSERT INTO inventory_items (organization_id, purchase_order_item_id, serial_number, sku, description, location)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [session.user.organizationId, item.purchaseOrderItemId, serialNumber, orderItem.sku, orderItem.description, item.location],
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
      return receiptResult.rows[0];
    });
    return NextResponse.json({ receipt }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError || (error as Error).message === 'Each received unit requires one serial number.') return NextResponse.json({ error: 'Receipt lines and one serial number per unit are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'ORDER_NOT_FOUND' || code === 'LINE_NOT_FOUND') return NextResponse.json({ error: 'Purchase order or line not found.' }, { status: 404 });
    if (code === 'OVER_RECEIPT') return NextResponse.json({ error: 'Receipt exceeds the outstanding quantity.' }, { status: 409 });
    if (code === '23505') return NextResponse.json({ error: 'One or more serial numbers already exist.' }, { status: 409 });
    console.error('Goods receipt failed', error);
    return NextResponse.json({ error: 'Unable to receive stock.' }, { status: 500 });
  }
}
