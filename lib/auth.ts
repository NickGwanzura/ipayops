import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SignJWT, jwtVerify } from 'jose';
import { query } from '@/lib/db';

export const SESSION_COOKIE = 'ipaytech_session';
const DEFAULT_SESSION_SECONDS = 60 * 60 * 8;
const REMEMBER_SESSION_SECONDS = 60 * 60 * 24 * 30;

export type AuthUser = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  role: string;
};

export const ROLE = {
  CEO: 'ceo',
  ADMIN: 'admin',
  MANAGER: 'manager',
  OPERATOR: 'operator',
  FINANCE: 'finance',
  HR: 'hr',
  INSTALLER: 'installer',
  VIEWER: 'viewer',
} as const;

export const ACCESS = {
  leadership: [ROLE.CEO, ROLE.ADMIN, ROLE.MANAGER] as const,
  finance: [ROLE.CEO, ROLE.ADMIN, ROLE.MANAGER, ROLE.FINANCE] as const,
  hr: [ROLE.CEO, ROLE.ADMIN, ROLE.MANAGER, ROLE.HR] as const,
  operations: [ROLE.CEO, ROLE.ADMIN, ROLE.MANAGER, ROLE.OPERATOR] as const,
  field: [ROLE.CEO, ROLE.ADMIN, ROLE.MANAGER, ROLE.OPERATOR, ROLE.INSTALLER] as const,
  expenseSubmitter: [ROLE.CEO, ROLE.ADMIN, ROLE.MANAGER, ROLE.OPERATOR, ROLE.FINANCE, ROLE.HR, ROLE.INSTALLER] as const,
} as const;

export type AuthSession = { user: AuthUser; sessionId: string };

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters.');
  return new TextEncoder().encode(secret);
}

export function publicUser(row: { id: string; organization_id: string; email: string; full_name: string; role: string }): AuthUser {
  return { id: row.id, organizationId: row.organization_id, email: row.email, fullName: row.full_name, role: row.role };
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function createSession(user: AuthUser, remember: boolean) {
  const id = randomUUID();
  const maxAge = remember ? REMEMBER_SESSION_SECONDS : DEFAULT_SESSION_SECONDS;
  await query('INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + ($3 * interval \'1 second\'))', [id, user.id, maxAge]);
  const token = await new SignJWT({ sid: id, org: user.organizationId, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${maxAge}s`)
    .sign(authSecret());
  return { token, maxAge };
}

export function setSessionCookie(response: NextResponse, token: string, maxAge: number) {
  response.cookies.set({ name: SESSION_COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({ name: SESSION_COOKIE, value: '', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
}

async function readSessionToken(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
    const result = await query<{ id: string; organization_id: string; email: string; full_name: string; role: string }>(
      `SELECT u.id, u.organization_id, u.email, u.full_name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now() AND u.is_active = true`,
      [payload.sid],
    );
    if (!result.rows[0]) return null;
    await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [payload.sid]);
    return { user: publicUser(result.rows[0]), sessionId: payload.sid };
  } catch {
    return null;
  }
}

export async function getSession(request?: Request): Promise<AuthSession | null> {
  const token = request?.headers.get('cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? cookies().get(SESSION_COOKIE)?.value;
  return readSessionToken(token);
}

export async function requireRole(request: Request, roles: readonly string[]) {
  const session = await getSession(request);
  if (!session) return { response: NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 }) } as const;
  if (!roles.includes(session.user.role.toLowerCase())) return { response: NextResponse.json({ error: 'You do not have permission to perform this action.' }, { status: 403 }) } as const;
  return { session } as const;
}

export async function deleteSession(request: Request) {
  const token = request.headers.get('cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const session = await readSessionToken(token);
  if (session) await query('DELETE FROM sessions WHERE id = $1', [session.sessionId]);
}
