export type QuotationLineInput = { productId?: string; sku?: string; description?: string; quantity: number; unitPrice?: number };
export type ResolvedQuotationLine = { productId: string | null; productType: string | null; sku: string; description: string; quantity: number; unitPrice: number };

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

const PRICE_OVERRIDE_ROLES = ['ceo', 'manager'];

function lineError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

/**
 * Prices every quotation line from the product catalogue. Free-typed SKUs must exist in the catalogue
 * (stock can only be sold against catalogued SKUs anyway), and a typed price below catalogue cost is
 * rejected unless a manager or CEO is quoting.
 */
export async function resolveQuotationLines(db: Queryable, organizationId: string, role: string, items: QuotationLineInput[]) {
  const resolved: ResolvedQuotationLine[] = [];
  for (const item of items) {
    const found = item.productId
      ? await db.query(`SELECT id, product_type, product_name, sku, selling_price, cost_price FROM supplier_products WHERE id = $1 AND organization_id = $2 AND status = 'Active'`, [item.productId, organizationId])
      : item.sku
        ? await db.query(`SELECT id, product_type, product_name, sku, selling_price, cost_price FROM supplier_products WHERE organization_id = $1 AND status = 'Active' AND lower(sku) = lower($2) ORDER BY updated_at DESC LIMIT 1`, [organizationId, item.sku])
        : { rows: [] };
    const product = found.rows[0];
    if (item.productId && !product) throw lineError('PRODUCT_NOT_FOUND', 'Product not found.');
    if (!item.productId && !product) throw lineError('SKU_NOT_IN_CATALOGUE', 'SKU is not in the product catalogue.');
    const catalogueLine = Boolean(item.productId);
    const unitPrice = catalogueLine || item.unitPrice === undefined ? Number(product.selling_price) : item.unitPrice;
    const description = catalogueLine ? String(product.product_name) : item.description || String(product.product_name);
    if (!catalogueLine && Number(product.cost_price) > 0 && unitPrice < Number(product.cost_price) && !PRICE_OVERRIDE_ROLES.includes(role)) {
      throw lineError('BELOW_COST', 'A quoted price is below cost.');
    }
    resolved.push({ productId: String(product.id), productType: String(product.product_type), sku: String(product.sku), description, quantity: item.quantity, unitPrice });
  }
  return resolved;
}

export const QUOTATION_LINE_ERRORS: Record<string, { status: number; message: string }> = {
  PRODUCT_NOT_FOUND: { status: 404, message: 'Client or product not found.' },
  SKU_NOT_IN_CATALOGUE: { status: 422, message: 'Every quotation line must use a SKU from the product catalogue.' },
  BELOW_COST: { status: 422, message: 'A quoted price is below cost. Ask a manager to approve the discount.' },
};
