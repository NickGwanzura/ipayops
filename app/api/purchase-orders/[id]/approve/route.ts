import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { notifyOrganizationRoles, sendNotification } from '@/lib/notifications';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.management);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(
    `UPDATE purchase_orders
     SET status = 'Approved', approved_by = $1, approved_at = now(), updated_at = now()
     WHERE id = $2 AND organization_id = $3 AND status = 'Pending approval' AND created_by <> $1
     RETURNING id, number, status, total, created_by`,
    [session.user.id, params.id, session.user.organizationId],
  );
  if (!result.rows[0]) return NextResponse.json({ error: 'Purchase order is missing, already processed, or cannot be self-approved.' }, { status: 409 });
  await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'purchase_order.approved', entityType: 'purchase_order', entityId: result.rows[0].id, metadata: { number: result.rows[0].number, total: result.rows[0].total }, request });
  const creator = await query<{ email: string; full_name: string }>('SELECT email, full_name FROM users WHERE id = $1 AND organization_id = $2', [result.rows[0].created_by, session.user.organizationId]);
  if (creator.rows[0]) void sendNotification({ organizationId: session.user.organizationId, eventType: 'purchase_order.approved', recipientEmail: creator.rows[0].email, recipientName: creator.rows[0].full_name, subject: `Purchase order ${result.rows[0].number} approved`, eyebrow: 'Procurement approval', title: 'Purchase order approved', summary: 'The purchase order is approved and can now be received with serialized stock controls.', fields: [{ label: 'Purchase order', value: result.rows[0].number }, { label: 'Approved by', value: session.user.fullName }, { label: 'Total', value: String(result.rows[0].total) }], action: { label: 'Open procurement', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Procurement` } });
  void notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['finance'], excludeUserId: session.user.id, eventType: 'purchase_order.approved', subject: `Purchase order ${result.rows[0].number} approved`, eyebrow: 'Procurement approval', title: 'Approved purchase order', summary: 'A purchase order has been approved and is ready for serialized receiving.', fields: [{ label: 'Purchase order', value: result.rows[0].number }, { label: 'Approved by', value: session.user.fullName }], action: { label: 'Open procurement', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Procurement` } });
  return NextResponse.json({ purchaseOrder: result.rows[0] });
}
