import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';
import { notifyOrganizationRoles } from '@/lib/notifications';

const convertSchema = z.object({
  items: z.array(z.object({ quotationItemId: z.string().uuid(), inventoryItemIds: z.array(z.string().uuid()).min(1) })).min(1),
});

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = convertSchema.parse(await request.json());
    const sale = await withTransaction(async client => {
      const quoteResult = await client.query(
        `SELECT q.id, q.number, q.client_id, q.status, q.total FROM quotations q
         WHERE q.id = $1 AND q.organization_id = $2 AND ($3::uuid IS NULL OR q.created_by = $3) FOR UPDATE`,
        [params.id, session.user.organizationId, session.user.role === 'sales_consultant' ? session.user.id : null],
      );
      const quote = quoteResult.rows[0];
      if (!quote) throw Object.assign(new Error('Quotation not found.'), { code: 'QUOTE_NOT_FOUND' });
      if (quote.status === 'Converted' || quote.status === 'Cancelled') throw Object.assign(new Error('Quotation cannot be converted.'), { code: 'QUOTE_LOCKED' });
      const lines = await client.query('SELECT id, sku, description, quantity, unit_price FROM quotation_items WHERE quotation_id = $1', [params.id]);
      const lineMap = new Map(lines.rows.map(line => [line.id, line]));
      const requestedLineIds = body.items.map(item => item.quotationItemId);
      if (new Set(requestedLineIds).size !== requestedLineIds.length) throw Object.assign(new Error('Quotation lines must be unique.'), { code: 'DUPLICATE_LINES' });
      if (lines.rows.length !== body.items.length || lines.rows.some(line => !lineMap.has(line.id) || !requestedLineIds.includes(line.id))) throw Object.assign(new Error('Every quotation line must be assigned exactly once.'), { code: 'LINE_SET_MISMATCH' });
      const allItemIds = body.items.flatMap(item => item.inventoryItemIds);
      if (new Set(allItemIds).size !== allItemIds.length) throw Object.assign(new Error('Inventory items must be unique.'), { code: 'DUPLICATE_ITEMS' });
      const inventory = await client.query(
        `SELECT id, serial_number, sku, description, status, cost_price, selling_price FROM inventory_items
         WHERE organization_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [session.user.organizationId, allItemIds],
      );
      if (inventory.rows.length !== allItemIds.length) throw Object.assign(new Error('Inventory item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (inventory.rows.some(item => !['Available', 'Reserved'].includes(item.status))) throw Object.assign(new Error('Inventory item is not available for sale.'), { code: 'ITEM_UNAVAILABLE' });
      const inventoryMap = new Map(inventory.rows.map(item => [item.id, item]));
      for (const requested of body.items) {
        const line = lineMap.get(requested.quotationItemId);
        if (!line || requested.inventoryItemIds.length !== line.quantity) throw Object.assign(new Error('Sale serials do not match quotation quantities.'), { code: 'QUANTITY_MISMATCH' });
        if (requested.inventoryItemIds.some(id => inventoryMap.get(id)?.sku !== line.sku)) throw Object.assign(new Error('Sale serial SKU does not match quotation line.'), { code: 'SKU_MISMATCH' });
      }
      const total = lines.rows.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0);
      if (Math.abs(total - Number(quote.total)) > 0.005) throw Object.assign(new Error('Quotation total does not match its complete line total.'), { code: 'TOTAL_MISMATCH' });
      const number = `SAL-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const saleResult = await client.query(
        `INSERT INTO sales (organization_id, number, quotation_id, client_id, total, consultant_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, number, status, total, confirmed_at`,
        [session.user.organizationId, number, params.id, quote.client_id, total, session.user.role === 'sales_consultant' ? session.user.id : null, session.user.id],
      );
      for (const requested of body.items) {
        const line = lineMap.get(requested.quotationItemId)!;
        const amount = Number(line.unit_price);
        for (const inventoryItemId of requested.inventoryItemIds) {
          const item = inventoryMap.get(inventoryItemId);
          await client.query(
            `INSERT INTO sale_items (sale_id, quotation_item_id, inventory_item_id, serial_number, sku, description, amount, purchase_cost, selling_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [saleResult.rows[0].id, line.id, item.id, item.serial_number, item.sku, item.description, amount, Number(item.cost_price || 0), amount],
          );
          await client.query(`UPDATE inventory_items SET status = 'Sold', client_name = (SELECT name FROM clients WHERE id = $1), updated_at = now() WHERE id = $2`, [quote.client_id, item.id]);
          await client.query(
            `INSERT INTO warranty_contracts (organization_id, inventory_item_id, client_id, sale_id, starts_at, expires_at, terms)
             VALUES ($1, $2, $3, $4, CURRENT_DATE, CURRENT_DATE + INTERVAL '365 days', 'Standard 12-month warranty')
             ON CONFLICT (inventory_item_id) DO NOTHING`,
            [session.user.organizationId, item.id, quote.client_id, saleResult.rows[0].id],
          );
        }
      }
      await client.query(`UPDATE quotations SET status = 'Converted', updated_at = now() WHERE id = $1`, [params.id]);
      return saleResult.rows[0];
    });
    await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager'], excludeUserId: session.user.id, eventType: 'quotation.converted', subject: `Quotation converted to sale ${sale.number}`, eyebrow: 'Sales conversion', title: 'Quotation converted', summary: `${session.user.fullName} converted a quotation into a confirmed serialized sale.`, fields: [{ label: 'Sale', value: sale.number }, { label: 'Total', value: String(sale.total) }, { label: 'Status', value: sale.status }], action: { label: 'Open Sales & CRM', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Sales%20%26%20CRM` } });
    return NextResponse.json({ sale }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Quotation line serial assignments are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'QUOTE_NOT_FOUND' || code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Quotation or inventory item not found.' }, { status: 404 });
    if (['QUOTE_LOCKED', 'DUPLICATE_LINES', 'LINE_SET_MISMATCH', 'DUPLICATE_ITEMS', 'ITEM_UNAVAILABLE', 'QUANTITY_MISMATCH', 'SKU_MISMATCH', 'TOTAL_MISMATCH'].includes(code || '')) return NextResponse.json({ error: 'Quotation conversion failed validation.' }, { status: 409 });
    console.error('Quotation conversion failed', error);
    return NextResponse.json({ error: 'Unable to convert quotation to sale.' }, { status: 500 });
  }
}
