import { NextResponse } from 'next/server';
import { ACCESS, canManageEmployee, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createInvitationToken, invitationUrl, INVITATION_TTL_HOURS } from '@/lib/invitations';
import { withTransaction } from '@/lib/db';
import { sendNotification } from '@/lib/notifications';

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.hr);
  if ('response' in auth) return auth.response;
  try {
    const token = createInvitationToken();
    const invitation = await withTransaction(async client => {
      const existing = await client.query(`
        SELECT id, email, full_name, role
        FROM user_invitations
        WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL
        FOR UPDATE`, [params.id, auth.session.user.organizationId]);
      if (!existing.rows[0]) return null;
      if (!canManageEmployee(auth.session, existing.rows[0].role)) throw Object.assign(new Error('You cannot manage this invitation.'), { code: 'INVITATION_FORBIDDEN' });
      const result = await client.query(`
        UPDATE user_invitations
        SET token_hash = $1, expires_at = now() + ($2 * interval '1 hour'), sent_at = now(), sent_count = sent_count + 1, revoked_at = NULL, updated_at = now()
        WHERE id = $3 AND organization_id = $4 AND accepted_at IS NULL
        RETURNING id, email, full_name, role, expires_at`,
        [token.tokenHash, INVITATION_TTL_HOURS, params.id, auth.session.user.organizationId]);
      return result.rows[0];
    });
    if (!invitation) return NextResponse.json({ error: 'Pending invitation not found.' }, { status: 404 });
    const notification = await sendNotification({
      organizationId: auth.session.user.organizationId,
      eventType: 'employee.invited',
      recipientEmail: invitation.email,
      recipientName: invitation.full_name,
      subject: 'Your iPayTech Operations invitation was renewed',
      eyebrow: 'Account invitation',
      title: 'Your secure invitation link is ready',
      summary: 'Use the renewed link below to set your password and activate your iPayTech Operations account.',
      fields: [{ label: 'Role', value: invitation.role }, { label: 'Link expires', value: `${INVITATION_TTL_HOURS} hours` }],
      action: { label: 'Accept invitation', url: invitationUrl(token.token) },
    });
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'employee.invite_resent', entityType: 'user_invitation', entityId: invitation.id, metadata: { email: invitation.email, emailStatus: notification.status }, request });
    return NextResponse.json({ invitation, emailStatus: notification.status });
  } catch (error) {
    if ((error as { code?: string }).code === 'INVITATION_FORBIDDEN') return NextResponse.json({ error: 'You cannot manage an invitation for this role.' }, { status: 403 });
    console.error('Invitation resend failed', error);
    return NextResponse.json({ error: 'Unable to resend invitation.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.hr);
  if ('response' in auth) return auth.response;
  try {
    const result = await withTransaction(async client => {
      const existing = await client.query(`
        SELECT id, email, role
        FROM user_invitations
        WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
        FOR UPDATE`, [params.id, auth.session.user.organizationId]);
      if (!existing.rows[0]) return null;
      if (!canManageEmployee(auth.session, existing.rows[0].role)) throw Object.assign(new Error('You cannot manage this invitation.'), { code: 'INVITATION_FORBIDDEN' });
      const updated = await client.query(`
        UPDATE user_invitations
        SET revoked_at = now(), updated_at = now()
        WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING id, email`, [params.id, auth.session.user.organizationId]);
      return updated.rows[0] || null;
    });
    if (!result) return NextResponse.json({ error: 'Pending invitation not found.' }, { status: 404 });
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'employee.invite_revoked', entityType: 'user_invitation', entityId: params.id, metadata: { email: result.email }, request });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'INVITATION_FORBIDDEN') return NextResponse.json({ error: 'You cannot manage an invitation for this role.' }, { status: 403 });
    console.error('Invitation revoke failed', error);
    return NextResponse.json({ error: 'Unable to revoke invitation.' }, { status: 500 });
  }
}
