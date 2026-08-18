import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const shipmentSchema = z.object({
  transferId: z.string().uuid().optional(),
  saleId: z.string().uuid().optional(),
  carrier: z.string().trim().max(100).optional().default(''),
  trackingNumber: z.string().trim().max(120).optional().default(''),
  status: z.enum(['Draft', 'Dispatched', 'In transit', 'Delivered', 'Cancelled']).optional().default('Draft'),
}).refine(value => value.transferId || value.saleId, { message: 'A transfer or sale is required.' });

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(
    `SELECT id, number, transfer_id, sale_id, carrier, tracking_number, status, shipped_at, delivered_at, created_at
     FROM shipments WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [session.user.organizationId],
  );
  return NextResponse.json({ shipments: result.rows });
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = shipmentSchema.parse(await request.json());
    const number = `SHP-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const result = await query(
      `INSERT INTO shipments (organization_id, number, transfer_id, sale_id, carrier, tracking_number, status, shipped_at, delivered_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7 IN ('Dispatched', 'In transit', 'Delivered') THEN now() END, CASE WHEN $7 = 'Delivered' THEN now() END, $8)
       RETURNING id, number, transfer_id, sale_id, carrier, tracking_number, status, shipped_at, delivered_at, created_at`,
      [session.user.organizationId, number, body.transferId || null, body.saleId || null, body.carrier, body.trackingNumber, body.status, session.user.id],
    );
    return NextResponse.json({ shipment: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A transfer or sale and valid shipping details are required.' }, { status: 400 });
    console.error('Shipment create failed', error);
    return NextResponse.json({ error: 'Unable to create shipment.' }, { status: 500 });
  }
}
