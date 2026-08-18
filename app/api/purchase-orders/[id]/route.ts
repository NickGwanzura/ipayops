import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });

  const result = await query(
    `SELECT po.id, po.number, po.destination, po.status, po.currency, po.total, po.expected_at, po.created_at,
            s.id AS supplier_id, s.code AS supplier_code, s.name AS supplier_name,
            COALESCE(json_agg(json_build_object(
              'id', poi.id,
              'sku', poi.sku,
              'description', poi.description,
              'quantity', poi.quantity,
              'receivedQuantity', poi.received_quantity,
              'unitCost', poi.unit_cost
            ) ORDER BY poi.created_at) FILTER (WHERE poi.id IS NOT NULL), '[]'::json) AS items
     FROM purchase_orders po
     JOIN suppliers s ON s.id = po.supplier_id
     LEFT JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
     WHERE po.id = $1 AND po.organization_id = $2
     GROUP BY po.id, s.id`,
    [params.id, session.user.organizationId],
  );

  if (!result.rows[0]) return NextResponse.json({ error: 'Purchase order not found.' }, { status: 404 });
  return NextResponse.json({ purchaseOrder: result.rows[0] });
}
