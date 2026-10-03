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
        `SELECT q.id, q.number, q.client_id, q.status, q.total, q.created_by, q.opportunity_id, (q.valid_until IS NOT NULL AND q.valid_until < current_date) AS lapsed FROM quotations q
         WHERE q.id = $1 AND q.organization_id = $2 AND ($3::uuid IS NULL OR q.created_by = $3) FOR UPDATE`,
        [params.id, session.user.organizationId, session.user.role === 'sales_consultant' ? session.user.id : null],
      );
      const quote = quoteResult.rows[0];
      if (!quote) throw Object.assign(new Error('Quotation not found.'), { code: 'QUOTE_NOT_FOUND' });
      if (['Converted', 'Cancelled', 'Expired'].includes(quote.status)) throw Object.assign(new Error('Quotation cannot be converted.'), { code: 'QUOTE_LOCKED' });
      if (quote.lapsed && quote.status !== 'Accepted') throw Object.assign(new Error('Quotation has lapsed.'), { code: 'QUOTE_LOCKED' });
      const lines = await client.query('SELECT id, sku, description, quantity, unit_price FROM quotation_items WHERE quotation_id = $1', [params.id]);
      const lineMap = new Map(lines.rows.map(line => [line.id, line]));
      const requestedLineIds = body.items.map(item => item.quotationItemId);
      if (new Set(requestedLineIds).size !== requestedLineIds.length) throw Object.assign(new Error('Quotation lines must be unique.'), { code: 'DUPLICATE_LINES' });
      if (lines.rows.length !== body.items.length || lines.rows.some(line => !lineMap.has(line.id) || !requestedLineIds.includes(line.id))) throw Object.assign(new Error('Every quotation line must be assigned exactly once.'), { code: 'LINE_SET_MISMATCH' });
      const allItemIds = body.items.flatMap(item => item.inventoryItemIds);
      if (new Set(allItemIds).size !== allItemIds.length) throw Object.assign(new Error('Inventory items must be unique.'), { code: 'DUPLICATE_ITEMS' });
      const inventory = await client.query(
        `SELECT id, serial_number, sku, description, status, cost_price, selling_price, supplier_product_id FROM inventory_items
         WHERE organization_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [session.user.organizationId, allItemIds],
      );
      if (inventory.rows.length !== allItemIds.length) throw Object.assign(new Error('Inventory item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (inventory.rows.some(item => !['Available', 'Reserved'].includes(item.status))) throw Object.assign(new Error('Inventory item is not available for sale.'), { code: 'ITEM_UNAVAILABLE' });
      // Stock held for a different quotation can only be sold by the person who reserved it or by a manager/CEO.
      const holds = await client.query(`SELECT reference_type, reference_id, reserved_by FROM inventory_reservations WHERE organization_id = $1 AND inventory_item_id = ANY($2::uuid[]) AND status = 'Active'`, [session.user.organizationId, allItemIds]);
      const canOverrideHold = ['ceo', 'manager'].includes(session.user.role);
      if (!canOverrideHold && holds.rows.some(hold => !(hold.reference_type === 'quotation' && hold.reference_id === params.id) && hold.reserved_by !== session.user.id)) throw Object.assign(new Error('Inventory is reserved for another quotation.'), { code: 'ITEM_RESERVED' });
      const inventoryMap = new Map(inventory.rows.map(item => [item.id, item]));
      for (const requested of body.items) {
        const line = lineMap.get(requested.quotationItemId);
        if (!line || requested.inventoryItemIds.length !== line.quantity) throw Object.assign(new Error('Sale serials do not match quotation quantities.'), { code: 'QUANTITY_MISMATCH' });
        if (requested.inventoryItemIds.some(id => inventoryMap.get(id)?.sku !== line.sku)) throw Object.assign(new Error('Sale serial SKU does not match quotation line.'), { code: 'SKU_MISMATCH' });
      }
      const total = lines.rows.reduce((sum, line) => sum + Number(line.quantity) * Number(line.unit_price), 0);
      if (Math.abs(total - Number(quote.total)) > 0.005) throw Object.assign(new Error('Quotation total does not match its complete line total.'), { code: 'TOTAL_MISMATCH' });
      const number = `SAL-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      // When a manager or CEO converts on a consultant's behalf, commission still belongs to the consultant who owns the quote.
      let consultantId: string | null = session.user.role === 'sales_consultant' ? session.user.id : null;
      if (!consultantId) {
        const owner = await client.query(`SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true AND role = 'sales_consultant'`, [quote.created_by, session.user.organizationId]);
        consultantId = owner.rows[0]?.id || null;
      }
      const saleResult = await client.query(
        `INSERT INTO sales (organization_id, number, quotation_id, client_id, total, consultant_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, number, status, total, confirmed_at`,
        [session.user.organizationId, number, params.id, quote.client_id, total, consultantId, session.user.id],
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
          await client.query(`UPDATE inventory_reservations SET status = 'Converted' WHERE inventory_item_id = $1 AND status = 'Active'`, [item.id]);
          // Warranty follows the product's catalogue term (12 months when the item has no catalogue product); a 0-month product carries none.
          const warrantyMonths = item.supplier_product_id ? Number((await client.query('SELECT warranty_months FROM supplier_products WHERE id = $1', [item.supplier_product_id])).rows[0]?.warranty_months ?? 12) : 12;
          await client.query(
            `INSERT INTO warranty_contracts (organization_id, inventory_item_id, client_id, sale_id, starts_at, expires_at, terms)
             SELECT $1::uuid, $2::uuid, $3::uuid, $4::uuid, CURRENT_DATE, CURRENT_DATE + make_interval(months => $5::int), $6::text WHERE $5::int > 0
             ON CONFLICT (inventory_item_id) DO NOTHING`,
            [session.user.organizationId, item.id, quote.client_id, saleResult.rows[0].id, warrantyMonths, `Standard ${warrantyMonths}-month warranty`],
          );
        }
      }
      await client.query(`UPDATE quotations SET status = 'Converted', updated_at = now() WHERE id = $1`, [params.id]);
      if (quote.opportunity_id) await client.query(`UPDATE opportunities SET stage = 'Won', updated_at = now() WHERE id = $1`, [quote.opportunity_id]);
      return saleResult.rows[0];
    });
    await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager'], excludeUserId: session.user.id, eventType: 'quotation.converted', subject: `Quotation converted to sale ${sale.number}`, eyebrow: 'Sales conversion', title: 'Quotation converted', summary: `${session.user.fullName} converted a quotation into a confirmed serialized sale.`, fields: [{ label: 'Sale', value: sale.number }, { label: 'Total', value: String(sale.total) }, { label: 'Status', value: sale.status }], action: { label: 'Open Sales & CRM', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Sales%20%26%20CRM` } });
    return NextResponse.json({ sale }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Quotation line serial assignments are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'QUOTE_NOT_FOUND' || code === 'ITEM_NOT_FOUND') return NextResponse.json({ error: 'Quotation or inventory item not found.' }, { status: 404 });
    if (code === 'ITEM_RESERVED') return NextResponse.json({ error: 'One or more units are reserved for a different quotation. Choose other units or ask a manager.' }, { status: 409 });
    if (['QUOTE_LOCKED', 'DUPLICATE_LINES', 'LINE_SET_MISMATCH', 'DUPLICATE_ITEMS', 'ITEM_UNAVAILABLE', 'QUANTITY_MISMATCH', 'SKU_MISMATCH', 'TOTAL_MISMATCH'].includes(code || '')) return NextResponse.json({ error: 'Quotation conversion failed validation.' }, { status: 409 });
    console.error('Quotation conversion failed', error);
    return NextResponse.json({ error: 'Unable to convert quotation to sale.' }, { status: 500 });
  }
}
