import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, publicUser, setSessionCookie, verifyPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { query, withTransaction } from '@/lib/db';
import { isPrivilegedMfaRequired } from '@/lib/server-env';
import { encryptMfaSecret, generateChallengeToken, generateTotpSecret, MFA_CHALLENGE_SECONDS, setMfaChallengeCookie } from '@/lib/mfa';
import { consumeRateLimit, requestAddress, resetRateLimit } from '@/lib/rate-limit';
import { sendNotification } from '@/lib/notifications';
import { setDbRequestId } from '@/lib/db-request-context';

export const runtime = 'nodejs';

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(8).max(128), remember: z.boolean().optional().default(false) });
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  try {
    setDbRequestId(request.headers.get('x-request-id'));
    const address = requestAddress(request);
    const limit = await consumeRateLimit(`login:${address}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!limit.allowed) return NextResponse.json({ error: 'Too many login attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'X-RateLimit-Remaining': '0' } });
    const body = loginSchema.parse(await request.json());
    const result = await query<{ id: string; organization_id: string; email: string; full_name: string; role: string; password_hash: string; mfa_secret_encrypted: string | null; mfa_enabled_at: Date | null }>(
      `SELECT id, organization_id, email, full_name, role, password_hash, mfa_secret_encrypted, mfa_enabled_at
       FROM users WHERE lower(email) = lower($1) AND is_active = true LIMIT 1`,
      [body.email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash))) return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    const authUser = publicUser(user);
    const privileged = authUser.role === 'ceo' || authUser.role === 'finance';
    if (privileged && isPrivilegedMfaRequired()) {
      const kind = user.mfa_secret_encrypted || user.mfa_enabled_at ? 'verify' : 'enroll';
      const pendingSecretEncrypted = kind === 'enroll' ? encryptMfaSecret(generateTotpSecret()) : null;
      const { rawToken, tokenHash } = generateChallengeToken();
      await withTransaction(async client => {
        await client.query('UPDATE mfa_login_challenges SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL', [user.id]);
        await client.query(
          `INSERT INTO mfa_login_challenges (user_id, organization_id, token_hash, remember, kind, pending_secret_encrypted, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::integer * interval '1 second'))`,
          [user.id, user.organization_id, tokenHash, body.remember, kind, pendingSecretEncrypted, MFA_CHALLENGE_SECONDS],
        );
      });
      const response = NextResponse.json({ mfaRequired: true, enrollmentRequired: kind === 'enroll' }, { status: 202 });
      setMfaChallengeCookie(response, rawToken);
      return response;
    }
    const session = await createSession(authUser, body.remember, false);
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await resetRateLimit(`login:${address}`);
    await writeAuditLog({ organizationId: authUser.organizationId, actorUserId: authUser.id, action: 'auth.login', entityType: 'user', entityId: authUser.id, request });
    await sendNotification({ organizationId: authUser.organizationId, eventType: 'auth.login', recipientEmail: authUser.email, recipientName: authUser.fullName, subject: 'New iPayTech sign-in', eyebrow: 'Security activity', title: 'A new sign-in was recorded', summary: 'Your iPayTech Operations account was just used to sign in.', fields: [{ label: 'Account', value: authUser.email }, { label: 'IP address', value: address }, { label: 'Time', value: new Date().toLocaleString('en-GB') }], action: { label: 'Review profile', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/profile` } });
    const response = NextResponse.json({ user: authUser });
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, { status: 400 });
    console.error('Login failed');
    return NextResponse.json({ error: 'Authentication service is unavailable.' }, { status: 503 });
  }
}
