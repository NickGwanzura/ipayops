import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const serial = request.nextUrl.searchParams.get('serial')?.trim() || '';
  if (!serial) return NextResponse.json({ error: 'Serial number is required.' }, { status: 400 });
  const result = await query(
    `SELECT ii.id, ii.serial_number, ii.sku, ii.description, ii.status AS inventory_status, ii.client_name,
            wc.id AS warranty_id, wc.starts_at, wc.expires_at,
            CASE WHEN wc.status = 'Active' AND wc.expires_at >= CURRENT_DATE THEN 'Active' ELSE COALESCE(wc.status, 'No coverage') END AS warranty_status,
            COALESCE(json_agg(json_build_object('id', wc2.id, 'number', wc2.number, 'status', wc2.status, 'issue', wc2.issue)
              ORDER BY wc2.created_at DESC) FILTER (WHERE wc2.id IS NOT NULL), '[]'::json) AS claims
     FROM inventory_items ii LEFT JOIN warranty_contracts wc ON wc.inventory_item_id = ii.id
     LEFT JOIN warranty_claims wc2 ON wc2.inventory_item_id = ii.id
     WHERE ii.organization_id = $1 AND lower(ii.serial_number) = lower($2)
     GROUP BY ii.id, wc.id`,
    [session.user.organizationId, serial],
  );
  if (!result.rows[0]) return NextResponse.json({ error: 'Serial number not found.' }, { status: 404 });
  return NextResponse.json({ warranty: result.rows[0] });
}
