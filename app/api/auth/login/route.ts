import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, publicUser, setSessionCookie, verifyPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { query } from '@/lib/db';
import { consumeRateLimit, requestAddress, resetRateLimit } from '@/lib/rate-limit';
import { sendNotification } from '@/lib/notifications';

export const runtime = 'nodejs';

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(8).max(128), remember: z.boolean().optional().default(false) });
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const address = requestAddress(request);
    const limit = await consumeRateLimit(`login:${address}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!limit.allowed) return NextResponse.json({ error: 'Too many login attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'X-RateLimit-Remaining': '0' } });
    const body = loginSchema.parse(await request.json());
    const result = await query<{ id: string; organization_id: string; email: string; full_name: string; role: string; password_hash: string }>(
      `SELECT id, organization_id, email, full_name, role, password_hash FROM users WHERE lower(email) = lower($1) AND is_active = true LIMIT 1`,
      [body.email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(body.password, user.password_hash))) return NextResponse.json({ error: 'Invalid email or password.' }, { status: 401 });
    const authUser = publicUser(user);
    const session = await createSession(authUser, body.remember);
    await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await resetRateLimit(`login:${address}`);
    await writeAuditLog({ organizationId: authUser.organizationId, actorUserId: authUser.id, action: 'auth.login', entityType: 'user', entityId: authUser.id, request });
    void sendNotification({ organizationId: authUser.organizationId, eventType: 'auth.login', recipientEmail: authUser.email, recipientName: authUser.fullName, subject: 'New iPayTech sign-in', eyebrow: 'Security activity', title: 'A new sign-in was recorded', summary: 'Your iPayTech Operations account was just used to sign in.', fields: [{ label: 'Account', value: authUser.email }, { label: 'IP address', value: address }, { label: 'Time', value: new Date().toLocaleString('en-GB') }], action: { label: 'Review profile', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/profile` } });
    const response = NextResponse.json({ user: authUser });
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, { status: 400 });
    console.error('Login failed', error);
    return NextResponse.json({ error: 'Authentication service is unavailable.' }, { status: 503 });
  }
}
