import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withTransaction } from '@/lib/db';
import { generatePasswordResetToken } from '@/lib/password-reset';
import { consumeRateLimit, requestAddress } from '@/lib/rate-limit';
import { sendNotification } from '@/lib/notifications';
import { setDbRequestId } from '@/lib/db-request-context';

export const runtime = 'nodejs';

const requestSchema = z.object({
  email: z.string().trim().email().max(320),
});
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const GENERIC_MESSAGE = 'If an account matches that email address, reset instructions have been sent.';

function genericResponse() {
  return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}

function emailRateLimitKey(email: string) {
  const digest = createHash('sha256').update(email, 'utf8').digest('hex');
  return `password-reset:email:${digest}`;
}

export async function POST(request: Request) {
  setDbRequestId(request.headers.get('x-request-id'));
  const address = requestAddress(request);
  try {
    const addressLimit = await consumeRateLimit(`password-reset:address:${address}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!addressLimit.allowed) {
      return NextResponse.json({ error: 'Too many password reset requests. Try again later.' }, { status: 429, headers: { 'Retry-After': String(addressLimit.retryAfter), 'X-RateLimit-Remaining': '0' } });
    }

    const body = requestSchema.parse(await request.json());
    const email = body.email.toLowerCase();
    const emailLimit = await consumeRateLimit(emailRateLimitKey(email), RATE_LIMIT, RATE_WINDOW_MS);
    if (!emailLimit.allowed) {
      return NextResponse.json({ error: 'Too many password reset requests. Try again later.' }, { status: 429, headers: { 'Retry-After': String(emailLimit.retryAfter), 'X-RateLimit-Remaining': '0' } });
    }

    try {
      const { rawToken, tokenHash } = generatePasswordResetToken();
      const user = await withTransaction(async client => {
        const result = await client.query<{ id: string; organization_id: string; email: string; full_name: string }>(
          `SELECT id, organization_id, email, full_name
           FROM users
           WHERE lower(email) = $1 AND is_active = true
           LIMIT 1
           FOR UPDATE`,
          [email],
        );
        const activeUser = result.rows[0];
        if (!activeUser) return null;

        await client.query(
          `UPDATE password_reset_tokens
           SET used_at = COALESCE(used_at, now())
           WHERE user_id = $1 AND organization_id = $2 AND used_at IS NULL`,
          [activeUser.id, activeUser.organization_id],
        );
        await client.query(
          `INSERT INTO password_reset_tokens (organization_id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, now() + interval '30 minutes')`,
          [activeUser.organization_id, activeUser.id, tokenHash],
        );
        return activeUser;
      });

      if (user) {
        const appUrl = (process.env.APP_URL || 'https://ipaytechops.com').replace(/\/+$/, '');
        await sendNotification({
          organizationId: user.organization_id,
          eventType: 'auth.password_reset_requested',
          recipientEmail: user.email,
          recipientName: user.full_name,
          subject: 'Reset your iPayTech password',
          eyebrow: 'Account security',
          title: 'Password reset requested',
          summary: 'Use the secure link below to choose a new password for your iPayTech Operations account. This link expires in 30 minutes.',
          action: { label: 'Reset password', url: `${appUrl}/reset-password/${rawToken}` },
        });
      }
    } catch {
      // Keep account existence and reset tokens out of logs and responses.
      console.error('Password reset request failed');
    }

    return genericResponse();
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    console.error('Password reset request service unavailable');
    return NextResponse.json({ error: 'Password reset is temporarily unavailable.' }, { status: 503 });
  }
}
