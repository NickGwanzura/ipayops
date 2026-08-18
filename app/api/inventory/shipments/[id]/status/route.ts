import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const statusSchema = z.object({ status: z.enum(['Draft', 'Dispatched', 'In transit', 'Delivered', 'Cancelled']) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = statusSchema.parse(await request.json());
    const result = await query(
      `UPDATE shipments SET status = $1,
         shipped_at = CASE WHEN $1 IN ('Dispatched', 'In transit', 'Delivered') AND shipped_at IS NULL THEN now() ELSE shipped_at END,
         delivered_at = CASE WHEN $1 = 'Delivered' THEN COALESCE(delivered_at, now()) ELSE delivered_at END
       WHERE id = $2 AND organization_id = $3
       RETURNING id, number, status, carrier, tracking_number, shipped_at, delivered_at`,
      [body.status, params.id, session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Shipment not found.' }, { status: 404 });
    return NextResponse.json({ shipment: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A valid shipment status is required.' }, { status: 400 });
    console.error('Shipment status update failed', error);
    return NextResponse.json({ error: 'Unable to update shipment status.' }, { status: 500 });
  }
}
