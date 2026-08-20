import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireRole(request, ACCESS.reports);
  if ('response' in auth) return auth.response;
  const organizationId = auth.session.user.organizationId;
  const [regions, products] = await Promise.all([
    query(`SELECT DISTINCT location AS region FROM inventory_items WHERE organization_id = $1 AND location IS NOT NULL AND location <> '' ORDER BY location`, [organizationId]),
    query(`SELECT sku, MAX(description) AS description FROM inventory_items WHERE organization_id = $1 GROUP BY sku ORDER BY sku`, [organizationId]),
  ]);
  return NextResponse.json({ regions: regions.rows.map(row => row.region), products: products.rows });
}
