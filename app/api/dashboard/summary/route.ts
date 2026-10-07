import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { organizationTimeZone } from '@/lib/timezone';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.leadership);
    if ('response' in auth) return auth.response;
    const { session } = auth;

    const organizationId = session.user.organizationId;
    const timeZone = await organizationTimeZone(organizationId);
    const [summary, performance, activity, stockByCategory, approvals, dispatchOversight] = await Promise.all([
      query(`SELECT
        COALESCE((SELECT SUM(si.amount) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.organization_id = $1 AND si.returned = false AND (s.confirmed_at AT TIME ZONE $2) >= date_trunc('month', now() AT TIME ZONE $2) AND s.status NOT IN ('Cancelled', 'Returned')), 0) AS revenue,
        COALESCE((SELECT COUNT(*) FROM sales s WHERE s.organization_id = $1 AND (s.confirmed_at AT TIME ZONE $2) >= date_trunc('month', now() AT TIME ZONE $2) AND s.status NOT IN ('Cancelled', 'Returned')), 0)::int AS confirmed_sales,
        COALESCE((SELECT COUNT(*) FROM inventory_items i WHERE i.organization_id = $1 AND i.status IN ('Available', 'Reserved')), 0)::int AS units_in_stock,
        COALESCE((SELECT COUNT(*) FROM intertown_dispatches d WHERE d.organization_id = $1 AND d.status IN ('Prepared', 'In transit')), 0)::int AS open_dispatches`, [organizationId, timeZone]),
      query(`SELECT to_char(days.day, 'DD Mon') AS day,
        COALESCE((SELECT SUM(si.amount) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.organization_id = $1 AND si.returned = false AND (s.confirmed_at AT TIME ZONE $2)::date = days.day::date AND s.status NOT IN ('Cancelled', 'Returned')), 0) AS sales,
        COALESCE((SELECT COUNT(*) FROM inventory_items i WHERE i.organization_id = $1 AND (i.received_at AT TIME ZONE $2)::date = days.day::date), 0)::int AS stock
        FROM generate_series(((now() AT TIME ZONE $2)::date - 29)::timestamp, (now() AT TIME ZONE $2)::date::timestamp, interval '1 day') AS days(day)
        ORDER BY days.day`, [organizationId, timeZone]),
      query(`SELECT event, detail, status, occurred_at FROM (
        SELECT 'Sale ' || s.number AS event, c.name || ' · ' || COUNT(si.id)::text || ' item(s)' AS detail, s.status, s.confirmed_at AS occurred_at
        FROM sales s JOIN clients c ON c.id = s.client_id LEFT JOIN sale_items si ON si.sale_id = s.id
        WHERE s.organization_id = $1 GROUP BY s.id, c.name
        UNION ALL
        SELECT 'Goods received ' || gr.number, COALESCE(s.name, 'Supplier') || ' · ' || COUNT(gri.id)::text || ' line(s)', 'Received', gr.received_at
        FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.purchase_order_id JOIN suppliers s ON s.id = po.supplier_id LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id = gr.id
        WHERE gr.organization_id = $1 GROUP BY gr.id, s.name
        UNION ALL
        SELECT 'Warranty claim ' || wc.number, COALESCE(ii.client_name, 'Unassigned') || ' · ' || ii.serial_number, wc.status, wc.created_at
        FROM warranty_claims wc JOIN inventory_items ii ON ii.id = wc.inventory_item_id
        WHERE wc.organization_id = $1
        UNION ALL
        SELECT 'Transfer ' || st.number, st.source_location || ' → ' || st.destination_location, st.status, st.created_at
        FROM stock_transfers st WHERE st.organization_id = $1
      ) events ORDER BY occurred_at DESC LIMIT 8`, [organizationId]),
      query(`SELECT COALESCE(NULLIF(i.product_type, ''), NULLIF(split_part(i.sku, '-', 1), ''), 'Other') AS name, COUNT(*)::int AS value
        FROM inventory_items i WHERE i.organization_id = $1 AND i.status = 'Available'
        GROUP BY 1 ORDER BY value DESC, name LIMIT 8`, [organizationId]),
      query(`SELECT
        COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE organization_id = $1 AND status = 'Pending approval'), 0)::int AS purchase_orders,
        COALESCE((SELECT COUNT(*) FROM expense_claims WHERE organization_id = $1 AND status = 'Pending'), 0)::int AS expenses,
        COALESCE((SELECT COUNT(*) FROM warranty_claims WHERE organization_id = $1 AND status IN ('Open', 'Under assessment')), 0)::int AS warranty_exceptions,
        COALESCE((SELECT COUNT(*) FROM inventory_reservations WHERE organization_id = $1 AND status = 'Active'), 0)::int AS stock_adjustments`, [organizationId]),
      query(`WITH recent AS (
        SELECT d.number, d.destination_town, d.driver_name, d.status, d.payment_status, d.driver_fee, d.dispatched_at,
               COUNT(di.id)::int AS item_count
        FROM intertown_dispatches d
        LEFT JOIN intertown_dispatch_items di ON di.dispatch_id = d.id
        WHERE d.organization_id = $1
        GROUP BY d.id
        ORDER BY d.dispatched_at DESC
        LIMIT 6
      )
      SELECT COUNT(*)::int AS total_dispatches,
             COUNT(*) FILTER (WHERE d.status IN ('Prepared', 'In transit'))::int AS in_transit,
             COUNT(*) FILTER (WHERE d.payment_status = 'Pending' AND d.status <> 'Cancelled')::int AS pending_payments,
             COALESCE(SUM(d.driver_fee) FILTER (WHERE d.payment_status = 'Pending' AND d.status <> 'Cancelled'), 0) AS pending_driver_fees,
             COUNT(*) FILTER (WHERE d.status = 'Delivered' AND (d.dispatched_at AT TIME ZONE $2)::date >= date_trunc('month', now() AT TIME ZONE $2)::date)::int AS delivered_this_month,
             COALESCE((SELECT json_agg(recent ORDER BY recent.dispatched_at DESC) FROM recent), '[]'::json) AS recent_dispatches
      FROM intertown_dispatches d
      WHERE d.organization_id = $1`, [organizationId, timeZone]),
    ]);

    const approvalRows = approvals.rows[0] || { purchase_orders: 0, expenses: 0, warranty_exceptions: 0, stock_adjustments: 0 };
    return NextResponse.json({
      summary: summary.rows[0],
      performance: performance.rows,
      activity: activity.rows,
      stockByCategory: stockByCategory.rows,
      approvals: { ...approvalRows, total: Object.values(approvalRows).reduce((total, count) => total + Number(count), 0) },
      dispatchOversight: dispatchOversight.rows[0] || { total_dispatches: 0, in_transit: 0, pending_payments: 0, pending_driver_fees: 0, delivered_this_month: 0, recent_dispatches: [] },
    });
  } catch (error) {
    console.error('Dashboard summary failed', error);
    return NextResponse.json({ error: 'Unable to load dashboard data.' }, { status: 500 });
  }
}
