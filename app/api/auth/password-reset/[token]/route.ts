import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { withTransaction } from '@/lib/db';
import { hashPasswordResetToken } from '@/lib/password-reset';
import { consumeRateLimit, requestAddress } from '@/lib/rate-limit';

export const runtime = 'nodejs';

const passwordSchema = z.object({
  password: z.string().min(12).max(128),
  passwordConfirmation: z.string().min(12).max(128),
}).refine(value => value.password === value.passwordConfirmation, {
  message: 'Passwords do not match.',
  path: ['passwordConfirmation'],
});
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,256}$/;
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60 * 1000;

function tokenIsWellFormed(token: string) {
  return RESET_TOKEN_PATTERN.test(token);
}

async function tokenIsValid(token: string) {
  if (!tokenIsWellFormed(token)) return false;
  try {
    const result = await withTransaction(async client => client.query(
      `SELECT 1
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id AND u.organization_id = t.organization_id
       WHERE t.token_hash = $1
         AND t.used_at IS NULL
         AND t.expires_at > now()
         AND u.is_active = true
       LIMIT 1`,
      [hashPasswordResetToken(token)],
    ));
    return Boolean(result.rows[0]);
  } catch {
    console.error('Password reset token check failed');
    return false;
  }
}

export async function GET(_request: Request, props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return NextResponse.json({ valid: await tokenIsValid(token) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const address = requestAddress(request);
  try {
    const limit = await consumeRateLimit(`password-reset:complete:${address}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!limit.allowed) return NextResponse.json({ error: 'Too many password reset attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'X-RateLimit-Remaining': '0' } });

    const { token } = await props.params;
    const body = passwordSchema.parse(await request.json());
    if (!tokenIsWellFormed(token)) return NextResponse.json({ error: 'This password reset link is invalid or has expired.' }, { status: 400 });

    const completed = await withTransaction(async client => {
      const result = await client.query<{ id: string; organization_id: string; user_id: string }>(
        `SELECT t.id, t.organization_id, t.user_id
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id AND u.organization_id = t.organization_id
         WHERE t.token_hash = $1
           AND t.used_at IS NULL
           AND t.expires_at > now()
           AND u.is_active = true
         FOR UPDATE OF t, u`,
        [hashPasswordResetToken(token)],
      );
      const resetToken = result.rows[0];
      if (!resetToken) throw Object.assign(new Error('Invalid password reset token.'), { code: 'PASSWORD_RESET_INVALID' });

      const passwordHash = await hashPassword(body.password);
      const userUpdate = await client.query(
        `UPDATE users
         SET password_hash = $1, updated_at = now()
         WHERE id = $2 AND organization_id = $3 AND is_active = true`,
        [passwordHash, resetToken.user_id, resetToken.organization_id],
      );
      if (userUpdate.rowCount !== 1) throw Object.assign(new Error('Invalid password reset user.'), { code: 'PASSWORD_RESET_INVALID' });

      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1 AND used_at IS NULL', [resetToken.id]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [resetToken.user_id]);
      return resetToken;
    });

    await writeAuditLog({
      organizationId: completed.organization_id,
      action: 'auth.password_reset_completed',
      entityType: 'user',
      entityId: completed.user_id,
      metadata: { source: 'password_reset_token' },
      request,
    });
    return NextResponse.json({ ok: true, message: 'Password updated. You can now sign in.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Choose a password between 12 and 128 characters and confirm it.' }, { status: 400 });
    if ((error as { code?: string }).code === 'PASSWORD_RESET_INVALID') return NextResponse.json({ error: 'This password reset link is invalid or has expired.' }, { status: 400 });
    console.error('Password reset completion failed');
    return NextResponse.json({ error: 'Unable to reset your password right now.' }, { status: 503 });
  }
}
