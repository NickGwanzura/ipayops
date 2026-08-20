import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';
import { notifyOrganizationRoles, sendNotification } from '@/lib/notifications';

const intakeSchema = z.object({ category: z.enum(['Laptop', 'POS']), productName: z.string().trim().min(2).max(160), sku: z.string().trim().min(2).max(80), location: z.string().trim().min(2).max(120), serialNumbers: z.array(z.string().trim().min(2).max(120)).min(1).max(500), supplierProductId: z.string().uuid().optional(), notes: z.string().trim().max(500).optional().default('') });

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = intakeSchema.parse(await request.json());
    const product = body.supplierProductId ? (await query(`SELECT id, product_type, sku, product_name, cost_price, selling_price FROM supplier_products WHERE id = $1 AND organization_id = $2 AND status = 'Active'`, [body.supplierProductId, session.user.organizationId])).rows[0] : null;
    if (body.supplierProductId && !product) return NextResponse.json({ error: 'Supplier product not found.' }, { status: 404 });
    if (product && (product.product_type !== body.category || product.sku !== body.sku)) return NextResponse.json({ error: 'Selected supplier product does not match the product type or SKU.' }, { status: 400 });
    const normalizedSerials = body.serialNumbers.map(serial => serial.trim()).filter(Boolean);
    if (new Set(normalizedSerials.map(serial => serial.toLowerCase())).size !== normalizedSerials.length) return NextResponse.json({ error: 'Serial numbers must be unique.' }, { status: 400 });
    const result = await withTransaction(async client => {
      const duplicate = await client.query('SELECT serial_number FROM inventory_items WHERE organization_id = $1 AND lower(serial_number) = ANY($2::text[]) LIMIT 1', [session.user.organizationId, normalizedSerials.map(serial => serial.toLowerCase())]);
      if (duplicate.rows[0]) throw Object.assign(new Error(`Serial ${duplicate.rows[0].serial_number} already exists.`), { code: 'DUPLICATE_SERIAL' });
      const items = [];
      for (const serial of normalizedSerials) {
        const inserted = await client.query(`INSERT INTO inventory_items (organization_id, supplier_product_id, product_type, serial_number, sku, description, location, cost_price, selling_price, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Available') RETURNING id, serial_number, sku, description, location, status`, [session.user.organizationId, product?.id || null, body.category, serial, body.sku, `${body.category} · ${body.productName}`, body.location, product?.cost_price || 0, product?.selling_price || 0]);
        items.push(inserted.rows[0]);
      }
      return items;
    });
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'inventory.received', entityType: 'inventory_items', metadata: { category: body.category, sku: body.sku, location: body.location, count: result.length, notes: body.notes } });
    void Promise.all([
      sendNotification({ organizationId: session.user.organizationId, eventType: 'inventory.received', recipientEmail: session.user.email, recipientName: session.user.fullName, subject: `${result.length} serialized stock unit${result.length === 1 ? '' : 's'} added`, eyebrow: 'Inventory activity', title: 'Serialized stock added', summary: 'New serialized stock has been added to available inventory.', fields: [{ label: 'Product', value: body.productName }, { label: 'Type', value: body.category }, { label: 'SKU', value: body.sku }, { label: 'Units', value: String(result.length) }, { label: 'Location', value: body.location }], action: { label: 'Open inventory', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Inventory` } }),
      notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'inventory.received', subject: `${result.length} serialized stock unit${result.length === 1 ? '' : 's'} added`, eyebrow: 'Inventory oversight', title: 'New serialized stock received', summary: `${session.user.fullName} added new stock to inventory.`, fields: [{ label: 'Product', value: body.productName }, { label: 'SKU', value: body.sku }, { label: 'Units', value: String(result.length) }, { label: 'Location', value: body.location }], action: { label: 'Open inventory', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Inventory` } }),
    ]);
    return NextResponse.json({ received: result.length, items: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Choose Laptop or POS and provide product, location, and serial numbers.' }, { status: 400 });
    if ((error as { code?: string }).code === 'DUPLICATE_SERIAL') return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    console.error('Inventory intake failed', error); return NextResponse.json({ error: 'Unable to receive serialized stock.' }, { status: 500 });
  }
}
