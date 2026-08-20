import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const itemSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(200),
  quantity: z.number().int().positive().max(100000),
  unitCost: z.number().nonnegative().max(100000000),
});

const purchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  destination: z.string().trim().min(2).max(160),
  expectedAt: z.string().date().optional(),
  status: z.enum(['Draft', 'Pending approval', 'Approved']).optional().default('Pending approval'),
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
        await client.query(
          `INSERT INTO purchase_order_items (purchase_order_id, sku, description, quantity, unit_cost)
           VALUES ($1, $2, $3, $4, $5)`,
          [header.rows[0].id, item.sku, item.description, item.quantity, item.unitCost],
        );
      }
      return header.rows[0];
    });
    return NextResponse.json({ purchaseOrder: order }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Supplier, destination, and at least one valid line item are required.' }, { status: 400 });
    if ((error as { code?: string }).code === 'SUPPLIER_NOT_FOUND') return NextResponse.json({ error: 'Active supplier not found.' }, { status: 404 });
    console.error('Purchase order create failed', error);
    return NextResponse.json({ error: 'Unable to create purchase order.' }, { status: 500 });
  }
}
