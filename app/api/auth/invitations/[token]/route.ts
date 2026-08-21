import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, hashPassword, publicUser, setSessionCookie } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { hashInvitationToken } from '@/lib/invitations';
import { query, withTransaction } from '@/lib/db';

const acceptSchema = z.object({ password: z.string().min(12).max(128) });

async function findInvitation(token: string) {
  return query(`SELECT i.id, i.organization_id, i.email, i.full_name, i.role, i.expires_at, o.name AS organization_name
    FROM user_invitations i JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL`, [hashInvitationToken(token)]);
}

export async function GET(_request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  const result = await findInvitation(token);
  const invitation = result.rows[0];
  if (!invitation || new Date(invitation.expires_at).getTime() <= Date.now()) return NextResponse.json({ error: 'This invitation is expired or unavailable.' }, { status: 410 });
  return NextResponse.json({ invitation: { fullName: invitation.full_name, email: invitation.email, role: invitation.role, organizationName: invitation.organization_name, expiresAt: invitation.expires_at } });
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  try {
    const body = acceptSchema.parse(await request.json());
    const accepted = await withTransaction(async client => {
      const result = await client.query(`SELECT id, organization_id, email, full_name, role, expires_at FROM user_invitations WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`, [hashInvitationToken(token)]);
      const invitation = result.rows[0];
      if (!invitation || new Date(invitation.expires_at).getTime() <= Date.now()) throw Object.assign(new Error('Invitation expired.'), { code: 'INVITATION_INVALID' });
      const existing = await client.query('SELECT id FROM users WHERE lower(email) = lower($1)', [invitation.email]);
      if (existing.rows[0]) throw Object.assign(new Error('An account already exists for this email.'), { code: 'ACCOUNT_EXISTS' });
      const passwordHash = await hashPassword(body.password);
      const userResult = await client.query(`INSERT INTO users (organization_id, email, full_name, password_hash, role) VALUES ($1, lower($2), $3, $4, $5) RETURNING id, organization_id, email, full_name, role`, [invitation.organization_id, invitation.email, invitation.full_name, passwordHash, invitation.role]);
      await client.query('UPDATE user_invitations SET accepted_at = now(), accepted_user_id = $1, updated_at = now() WHERE id = $2', [userResult.rows[0].id, invitation.id]);
      await client.query(`INSERT INTO employee_lifecycle_events (organization_id, user_id, event_type, status, notes, created_by) VALUES ($1, $2, 'Onboarding', 'Completed', 'Employee accepted an invitation and activated their account.', NULL)`, [invitation.organization_id, userResult.rows[0].id]);
      return userResult.rows[0];
    });
    const authUser = publicUser(accepted);
    const session = await createSession(authUser, true);
    await writeAuditLog({ organizationId: authUser.organizationId, actorUserId: authUser.id, action: 'employee.invite_accepted', entityType: 'user', entityId: authUser.id, request });
    const response = NextResponse.json({ user: authUser });
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Choose a password with at least 12 characters.' }, { status: 400 });
    if ((error as { code?: string }).code === 'INVITATION_INVALID') return NextResponse.json({ error: 'This invitation is expired or unavailable.' }, { status: 410 });
    if ((error as { code?: string }).code === 'ACCOUNT_EXISTS' || (error as { code?: string }).code === '23505') return NextResponse.json({ error: 'An account already exists for this email address.' }, { status: 409 });
    console.error('Invitation acceptance failed', error);
    return NextResponse.json({ error: 'Unable to activate this invitation.' }, { status: 500 });
  }
}
