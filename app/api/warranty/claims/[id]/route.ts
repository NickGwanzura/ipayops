import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ACCESS.field);
  if ('response' in auth) return auth.response;
  const result = await query(`SELECT wc.id, wc.number, wc.status, wc.issue, wc.resolution, wc.created_at, wc.updated_at, ii.serial_number, ii.sku, ii.description, ii.client_name, COALESCE((SELECT json_agg(json_build_object('id', rr.id, 'number', rr.number, 'description', rr.description, 'estimatedCost', rr.estimated_cost, 'status', rr.status, 'createdAt', rr.created_at) ORDER BY rr.created_at DESC) FROM repair_requisitions rr WHERE rr.claim_id = wc.id), '[]'::json) AS requisitions, COALESCE((SELECT json_agg(json_build_object('id', ri.id, 'originalSerial', original.serial_number, 'replacementSerial', replacement.serial_number, 'reason', ri.reason, 'createdAt', ri.created_at) ORDER BY ri.created_at DESC) FROM replacement_items ri JOIN inventory_items original ON original.id = ri.original_inventory_item_id JOIN inventory_items replacement ON replacement.id = ri.replacement_inventory_item_id WHERE ri.claim_id = wc.id), '[]'::json) AS replacements FROM warranty_claims wc JOIN inventory_items ii ON ii.id = wc.inventory_item_id WHERE wc.id = $1 AND wc.organization_id = $2 GROUP BY wc.id, ii.id`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Warranty claim not found.' }, { status: 404 });
  return NextResponse.json({ claim: result.rows[0] });
}
