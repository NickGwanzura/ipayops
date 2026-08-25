import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { notifyOrganizationRoles } from '@/lib/notifications';

const statusSchema = z.object({ status: z.enum(['Draft', 'Dispatched', 'In transit', 'Delivered', 'Cancelled']) });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
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
    await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'shipment.status_changed', subject: `Shipment ${result.rows[0].number} is ${result.rows[0].status}`, eyebrow: 'Shipping oversight', title: 'Shipment status updated', summary: `${session.user.fullName} updated a shipment status.`, fields: [{ label: 'Shipment', value: result.rows[0].number }, { label: 'Status', value: result.rows[0].status }, { label: 'Carrier', value: result.rows[0].carrier || 'Not specified' }, { label: 'Tracking', value: result.rows[0].tracking_number || 'Not specified' }], action: { label: 'Open inventory', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Inventory` } });
    return NextResponse.json({ shipment: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A valid shipment status is required.' }, { status: 400 });
    console.error('Shipment status update failed', error);
    return NextResponse.json({ error: 'Unable to update shipment status.' }, { status: 500 });
  }
}
