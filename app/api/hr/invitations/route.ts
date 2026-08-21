import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, canManageEmployee, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { createInvitationToken, invitationUrl, INVITATION_TTL_HOURS } from '@/lib/invitations';
import { query, withTransaction } from '@/lib/db';
import { sendNotification } from '@/lib/notifications';

const invitationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  role: z.enum(['ceo', 'manager', 'finance', 'sales_consultant']).default('sales_consultant'),
});

export async function GET(request: Request) {
  const auth = await requireRole(request, ACCESS.hr);
  if ('response' in auth) return auth.response;
  const result = await query(`
    SELECT i.id, i.email, i.full_name, i.role, i.expires_at, i.sent_at, i.sent_count, i.accepted_at, i.revoked_at,
           CASE WHEN i.revoked_at IS NOT NULL THEN 'Revoked'
                WHEN i.accepted_at IS NOT NULL THEN 'Accepted'
                WHEN i.expires_at <= now() THEN 'Expired'
                ELSE 'Pending' END AS status,
           creator.full_name AS created_by_name
    FROM user_invitations i
    LEFT JOIN users creator ON creator.id = i.created_by
    WHERE i.organization_id = $1
    ORDER BY CASE WHEN i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now() THEN 0 ELSE 1 END, i.created_at DESC
    LIMIT 100`, [auth.session.user.organizationId]);
  return NextResponse.json({ invitations: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.hr);
    if ('response' in auth) return auth.response;
    const body = invitationSchema.parse(await request.json());
    if (!canManageEmployee(auth.session, undefined, body.role)) return NextResponse.json({ error: 'You cannot invite this role.' }, { status: 403 });
    const email = body.email.toLowerCase();
    const existingUser = await query('SELECT id FROM users WHERE lower(email) = $1', [email]);
    if (existingUser.rows[0]) return NextResponse.json({ error: 'That email address already has an account.' }, { status: 409 });
    const token = createInvitationToken();
    const invitation = await withTransaction(async client => {
      const result = await client.query(`
        INSERT INTO user_invitations (organization_id, email, full_name, role, token_hash, expires_at, created_by)
        VALUES ($1, $2, $3, $4, $5, now() + ($6 * interval '1 hour'), $7)
        RETURNING id, email, full_name, role, expires_at, sent_at, sent_count`,
        [auth.session.user.organizationId, email, body.fullName, body.role, token.tokenHash, INVITATION_TTL_HOURS, auth.session.user.id]);
      return result.rows[0];
    });
    const notification = await sendNotification({
      organizationId: auth.session.user.organizationId,
      eventType: 'employee.invited',
      recipientEmail: invitation.email,
      recipientName: invitation.full_name,
      subject: 'You are invited to iPayTech Operations',
      eyebrow: 'Account invitation',
      title: 'Complete your iPayTech Operations account',
      summary: 'You have been invited to join the iPayTech Operations workspace. Set your password using the secure link below.',
      fields: [{ label: 'Role', value: invitation.role }, { label: 'Link expires', value: `${INVITATION_TTL_HOURS} hours` }],
      action: { label: 'Accept invitation', url: invitationUrl(token.token) },
    });
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'employee.invite_created', entityType: 'user_invitation', entityId: invitation.id, metadata: { email: invitation.email, role: invitation.role, emailStatus: notification.status }, request });
    return NextResponse.json({ invitation, emailStatus: notification.status }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Name, work email, and role are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'An active invitation already exists for that email address.' }, { status: 409 });
    console.error('Invitation create failed', error);
    return NextResponse.json({ error: 'Unable to create invitation.' }, { status: 500 });
  }
}
