import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, publicUser, setSessionCookie, verifyPassword } from '@/lib/auth';
import { query } from '@/lib/db';

export const runtime = 'nodejs';

const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(8).max(128), remember: z.boolean().optional().default(false) });

export async function POST(request: Request) {
  try {
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
    const response = NextResponse.json({ user: authUser });
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid email and a password of at least 8 characters.' }, { status: 400 });
    console.error('Login failed', error);
    return NextResponse.json({ error: 'Authentication service is unavailable.' }, { status: 503 });
  }
}
