import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const dispatchSchema = z.object({
  saleId: z.string().uuid(),
  saleItemIds: z.array(z.string().uuid()).min(1).max(100),
  destinationTown: z.string().trim().min(2).max(120),
  driverName: z.string().trim().min(2).max(160),
  driverPhone: z.string().trim().min(5).max(60),
  vehicleRegistration: z.string().trim().max(40).optional().default(''),
  transportCompany: z.string().trim().max(120).optional().default(''),
  dispatchedAt: z.string().datetime().optional(),
  status: z.enum(['Prepared', 'In transit', 'Delivered', 'Cancelled']).optional().default('In transit'),
  driverFee: z.coerce.number().min(0).max(100000000).optional().default(0),
  paymentStatus: z.enum(['Pending', 'Paid']).optional().default('Pending'),
  paymentReference: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(500).optional().default(''),
});

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.dispatchRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') || '1') || 1);
  const pageSize = Math.min(100, Math.max(10, Number(request.nextUrl.searchParams.get('pageSize') || '50') || 50));
  const offset = (page - 1) * pageSize;
  const search = request.nextUrl.searchParams.get('q')?.trim() || null;
  const consultantClause = session.user.role === 'sales_consultant' ? ' AND d.created_by = $2' : '';
  const searchClause = search ? ` AND (d.number ILIKE $${session.user.role === 'sales_consultant' ? 3 : 2} OR d.destination_town ILIKE $${session.user.role === 'sales_consultant' ? 3 : 2} OR d.driver_name ILIKE $${session.user.role === 'sales_consultant' ? 3 : 2} OR d.driver_phone ILIKE $${session.user.role === 'sales_consultant' ? 3 : 2} OR c.name ILIKE $${session.user.role === 'sales_consultant' ? 3 : 2} OR s.number ILIKE $${session.user.role === 'sales_consultant' ? 3 : 2})` : '';
  const parameters: Array<string | number> = session.user.role === 'sales_consultant' ? [session.user.organizationId, session.user.id] : [session.user.organizationId];
  if (search) parameters.push(`%${search}%`);
  parameters.push(pageSize, offset);
  const limitPosition = parameters.length - 1;
  const offsetPosition = parameters.length;
  const result = await query(
    `SELECT d.id, d.number, d.sale_id, d.destination_town, d.driver_name, d.driver_phone,
            d.vehicle_registration, d.transport_company, d.dispatched_at, d.status,
            d.driver_fee, d.payment_status, d.payment_reference, d.paid_at, d.notes,
            d.created_at, d.updated_at, s.number AS sale_number, c.name AS client_name,
            u.full_name AS created_by_name,
            COALESCE(json_agg(json_build_object('id', di.id, 'saleItemId', di.sale_item_id, 'inventoryItemId', di.inventory_item_id, 'serialNumber', di.serial_number)
              ORDER BY di.serial_number) FILTER (WHERE di.id IS NOT NULL), '[]'::json) AS items,
            COUNT(*) OVER()::int AS total_count
     FROM intertown_dispatches d
     JOIN sales s ON s.id = d.sale_id
     JOIN clients c ON c.id = s.client_id
     LEFT JOIN users u ON u.id = d.created_by
     LEFT JOIN intertown_dispatch_items di ON di.dispatch_id = d.id
     WHERE d.organization_id = $1${consultantClause}${searchClause}
     GROUP BY d.id, s.number, c.name, u.full_name
     ORDER BY d.dispatched_at DESC, d.created_at DESC
     LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
    parameters,
  );
  const total = result.rows[0]?.total_count || 0;
  return NextResponse.json({ dispatches: result.rows.map(({ total_count: _totalCount, ...dispatch }) => dispatch), pagination: { page, pageSize, total, hasMore: offset + result.rows.length < total } });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.dispatchWrite);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = dispatchSchema.parse(await request.json());
    if (new Set(body.saleItemIds).size !== body.saleItemIds.length) return NextResponse.json({ error: 'Each device can only be selected once.' }, { status: 409 });
    const dispatch = await withTransaction(async client => {
      const ownerCondition = session.user.role === 'sales_consultant' ? ' AND (s.consultant_id = $3 OR s.created_by = $3)' : '';
      const saleParameters = session.user.role === 'sales_consultant' ? [body.saleId, session.user.organizationId, session.user.id] : [body.saleId, session.user.organizationId];
      const saleResult = await client.query(`SELECT s.id, s.status FROM sales s WHERE s.id = $1 AND s.organization_id = $2${ownerCondition} FOR UPDATE`, saleParameters);
      if (!saleResult.rows[0]) throw Object.assign(new Error('Sale not found.'), { code: 'SALE_NOT_FOUND' });
      if (['Cancelled', 'Returned'].includes(saleResult.rows[0].status)) throw Object.assign(new Error('Only active sales can be dispatched.'), { code: 'SALE_INACTIVE' });

      const saleItems = await client.query(
        `SELECT si.id, si.inventory_item_id, si.serial_number, si.returned
         FROM sale_items si WHERE si.sale_id = $1 AND si.id = ANY($2::uuid[]) FOR UPDATE`,
        [body.saleId, body.saleItemIds],
      );
      if (saleItems.rows.length !== body.saleItemIds.length) throw Object.assign(new Error('One or more selected devices are not part of the sale.'), { code: 'ITEM_NOT_IN_SALE' });
      if (saleItems.rows.some(item => item.returned)) throw Object.assign(new Error('Returned devices cannot be dispatched.'), { code: 'ITEM_RETURNED' });
      const existing = await client.query(
        `SELECT di.sale_item_id FROM intertown_dispatch_items di JOIN intertown_dispatches d ON d.id = di.dispatch_id
         WHERE di.sale_item_id = ANY($1::uuid[]) AND d.organization_id = $2 AND d.status <> 'Cancelled' LIMIT 1`,
        [body.saleItemIds, session.user.organizationId],
      );
      if (existing.rows[0]) throw Object.assign(new Error('One or more selected devices already have an active dispatch.'), { code: 'ITEM_ALREADY_DISPATCHED' });

      const number = `DSP-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const paidAt = body.paymentStatus === 'Paid' ? new Date().toISOString() : null;
      const inserted = await client.query(
        `INSERT INTO intertown_dispatches (organization_id, number, sale_id, destination_town, driver_name, driver_phone, vehicle_registration, transport_company, dispatched_at, status, driver_fee, payment_status, payment_reference, paid_at, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, ''), COALESCE($9::timestamptz, now()), $10, $11, $12, NULLIF($13, ''), $14, NULLIF($15, ''), $16)
         RETURNING id, number, status, payment_status, created_at`,
        [session.user.organizationId, number, body.saleId, body.destinationTown, body.driverName, body.driverPhone, body.vehicleRegistration, body.transportCompany, body.dispatchedAt || null, body.status, body.driverFee, body.paymentStatus, body.paymentReference, paidAt, body.notes, session.user.id],
      );
      for (const item of saleItems.rows) {
        await client.query(`INSERT INTO intertown_dispatch_items (dispatch_id, sale_item_id, inventory_item_id, serial_number) VALUES ($1, $2, $3, $4)`, [inserted.rows[0].id, item.id, item.inventory_item_id, item.serial_number]);
      }
      return inserted.rows[0];
    });
    return NextResponse.json({ dispatch }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A sale, at least one device, destination town, and driver details are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'SALE_NOT_FOUND') return NextResponse.json({ error: 'The selected sale is not available to this user.' }, { status: 404 });
    if (code === 'SALE_INACTIVE') return NextResponse.json({ error: 'Only active sales can be dispatched.' }, { status: 409 });
    if (code === 'ITEM_NOT_IN_SALE' || code === 'ITEM_RETURNED' || code === 'ITEM_ALREADY_DISPATCHED') return NextResponse.json({ error: 'One or more selected devices cannot be dispatched.' }, { status: 409 });
    if (code === '23505') return NextResponse.json({ error: 'One or more selected devices already have a dispatch record.' }, { status: 409 });
    console.error('Dispatch create failed', error);
    return NextResponse.json({ error: 'Unable to create dispatch record.' }, { status: 500 });
  }
}
