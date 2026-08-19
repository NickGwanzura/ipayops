import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });

    const organizationId = session.user.organizationId;
    const [summary, performance, activity, stockByCategory, approvals] = await Promise.all([
      query(`SELECT
        COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.organization_id = $1 AND s.confirmed_at >= date_trunc('month', current_date)), 0) AS revenue,
        COALESCE((SELECT COUNT(*) FROM sales s WHERE s.organization_id = $1 AND s.confirmed_at >= date_trunc('month', current_date)), 0)::int AS confirmed_sales,
        COALESCE((SELECT COUNT(*) FROM inventory_items i WHERE i.organization_id = $1 AND i.status IN ('Available', 'Reserved')), 0)::int AS units_in_stock,
        COALESCE((SELECT COUNT(*) FROM job_cards j WHERE j.organization_id = $1 AND j.status IN ('Scheduled', 'In progress')), 0)::int AS open_jobs`, [organizationId]),
      query(`SELECT to_char(days.day, 'DD Mon') AS day,
        COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.organization_id = $1 AND s.confirmed_at::date = days.day::date), 0) AS sales,
        COALESCE((SELECT COUNT(*) FROM inventory_items i WHERE i.organization_id = $1 AND i.received_at::date = days.day::date), 0)::int AS stock
        FROM generate_series(current_date - interval '29 days', current_date, interval '1 day') AS days(day)
        ORDER BY days.day`, [organizationId]),
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
      query(`SELECT COALESCE(NULLIF(split_part(i.sku, '-', 1), ''), 'Other') AS name, COUNT(*)::int AS value
        FROM inventory_items i WHERE i.organization_id = $1 AND i.status = 'Available'
        GROUP BY 1 ORDER BY value DESC, name LIMIT 8`, [organizationId]),
      query(`SELECT
        COALESCE((SELECT COUNT(*) FROM purchase_orders WHERE organization_id = $1 AND status = 'Pending approval'), 0)::int AS purchase_orders,
        COALESCE((SELECT COUNT(*) FROM expense_claims WHERE organization_id = $1 AND status = 'Pending'), 0)::int AS expenses,
        COALESCE((SELECT COUNT(*) FROM warranty_claims WHERE organization_id = $1 AND status IN ('Open', 'Under assessment')), 0)::int AS warranty_exceptions,
        COALESCE((SELECT COUNT(*) FROM inventory_reservations WHERE organization_id = $1 AND status = 'Active'), 0)::int AS stock_adjustments`, [organizationId]),
    ]);

    const approvalRows = approvals.rows[0] || { purchase_orders: 0, expenses: 0, warranty_exceptions: 0, stock_adjustments: 0 };
    return NextResponse.json({
      summary: summary.rows[0],
      performance: performance.rows,
      activity: activity.rows,
      stockByCategory: stockByCategory.rows,
      approvals: { ...approvalRows, total: Object.values(approvalRows).reduce((total, count) => total + Number(count), 0) },
    });
  } catch (error) {
    console.error('Dashboard summary failed', error);
    return NextResponse.json({ error: 'Unable to load dashboard data.' }, { status: 500 });
  }
}
