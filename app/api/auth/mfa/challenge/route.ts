import * as QRCode from 'qrcode';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createSession, publicUser, setSessionCookie } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { withTransaction } from '@/lib/db';
import {
  buildOtpAuthUri,
  clearMfaChallengeCookie,
  consumeMatchingRecoveryHash,
  decryptMfaSecret,
  generateRecoveryCodes,
  hashChallengeToken,
  readMfaChallengeCookie,
  verifyTotpCode,
} from '@/lib/mfa';
import { consumeRateLimit, requestAddress, resetRateLimit } from '@/lib/rate-limit';
import { sendNotification } from '@/lib/notifications';

export const runtime = 'nodejs';

const codeSchema = z.object({ code: z.string().trim().min(1).max(128) });
const MFA_LIMIT = 20;
const MFA_WINDOW_MS = 5 * 60 * 1000;

type ChallengeKind = 'enroll' | 'verify';
type ChallengeRow = {
  id: string;
  user_id: string;
  organization_id: string;
  remember: boolean;
  kind: ChallengeKind;
  pending_secret_encrypted: string | null;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
};
type MfaUserRow = {
  id: string;
  organization_id: string;
  email: string;
  full_name: string;
  role: string;
  mfa_secret_encrypted: string | null;
  mfa_recovery_code_hashes: unknown;
};

function invalidChallengeResponse() {
  const response = NextResponse.json({ error: 'Invalid or expired MFA challenge.' }, { status: 401 });
  clearMfaChallengeCookie(response);
  return response;
}

function parseRecoveryHashes(value: unknown) {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : [];
}

export async function GET(request: Request) {
  const address = requestAddress(request);
  const limit = await consumeRateLimit(`mfa:${address}`, MFA_LIMIT, MFA_WINDOW_MS);
  if (!limit.allowed) return NextResponse.json({ error: 'Too many MFA attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'X-RateLimit-Remaining': '0' } });

  const rawToken = readMfaChallengeCookie(request);
  if (!rawToken) return invalidChallengeResponse();
  try {
    const result = await withTransaction(async client => client.query<ChallengeRow>(
      `SELECT id, user_id, organization_id, remember, kind, pending_secret_encrypted, attempts, expires_at, consumed_at
       FROM mfa_login_challenges
       WHERE token_hash = $1 AND consumed_at IS NULL AND expires_at > now()
       LIMIT 1`,
      [hashChallengeToken(rawToken)],
    ));
    const challenge = result.rows[0];
    if (!challenge) return invalidChallengeResponse();
    const userResult = await withTransaction(async client => client.query<MfaUserRow>(
      `SELECT id, organization_id, email, full_name, role, mfa_secret_encrypted, mfa_recovery_code_hashes
       FROM users
       WHERE id = $1 AND organization_id = $2 AND is_active = true
       LIMIT 1`,
      [challenge.user_id, challenge.organization_id],
    ));
    const user = userResult.rows[0];
    if (!user) return invalidChallengeResponse();
    if (challenge.kind === 'verify') return NextResponse.json({ kind: 'verify' });
    if (!challenge.pending_secret_encrypted) return invalidChallengeResponse();
    const manualKey = decryptMfaSecret(challenge.pending_secret_encrypted);
    const otpauthUri = buildOtpAuthUri(user.email, manualKey);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri, { width: 240, margin: 1, errorCorrectionLevel: 'M' });
    return NextResponse.json({ kind: 'enroll', otpauthUri, manualKey, qrDataUrl });
  } catch {
    return invalidChallengeResponse();
  }
}

export async function POST(request: Request) {
  const address = requestAddress(request);
  const limit = await consumeRateLimit(`mfa:${address}`, MFA_LIMIT, MFA_WINDOW_MS);
  if (!limit.allowed) return NextResponse.json({ error: 'Too many MFA attempts. Try again later.' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfter), 'X-RateLimit-Remaining': '0' } });

  const rawToken = readMfaChallengeCookie(request);
  if (!rawToken) return invalidChallengeResponse();
  let body: z.infer<typeof codeSchema>;
  try {
    body = codeSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Enter a valid MFA code.' }, { status: 400 });
  }

  type Success = { user: ReturnType<typeof publicUser>; remember: boolean; recoveryCodes?: string[] };
  let success: Success | null = null;
  let failure: string = 'invalid';
  try {
    success = await withTransaction(async client => {
      const challengeResult = await client.query<ChallengeRow>(
        `SELECT id, user_id, organization_id, remember, kind, pending_secret_encrypted, attempts, expires_at, consumed_at
         FROM mfa_login_challenges
         WHERE token_hash = $1 AND consumed_at IS NULL
         FOR UPDATE`,
        [hashChallengeToken(rawToken)],
      );
      const challenge = challengeResult.rows[0];
      if (!challenge || challenge.expires_at <= new Date() || challenge.consumed_at) {
        failure = 'invalid';
        if (challenge && challenge.expires_at <= new Date()) await client.query('UPDATE mfa_login_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [challenge.id]);
        return null;
      }
      const userResult = await client.query<MfaUserRow>(
        `SELECT id, organization_id, email, full_name, role, mfa_secret_encrypted, mfa_recovery_code_hashes
         FROM users
         WHERE id = $1 AND organization_id = $2 AND is_active = true
         FOR UPDATE`,
        [challenge.user_id, challenge.organization_id],
      );
      const user = userResult.rows[0];
      if (!user) {
        failure = 'invalid';
        return null;
      }
      if (challenge.attempts >= 8) {
        failure = 'attempts';
        return null;
      }

      let verified = false;
      let consumedRecoveryHashes: string[] | null = null;
      if (challenge.kind === 'enroll') {
        if (challenge.pending_secret_encrypted) {
          try {
            verified = verifyTotpCode(decryptMfaSecret(challenge.pending_secret_encrypted), body.code);
          } catch {
            verified = false;
          }
        }
      } else {
        if (user.mfa_secret_encrypted) {
          try {
            verified = verifyTotpCode(decryptMfaSecret(user.mfa_secret_encrypted), body.code);
          } catch {
            verified = false;
          }
        }
        if (!verified) consumedRecoveryHashes = consumeMatchingRecoveryHash(parseRecoveryHashes(user.mfa_recovery_code_hashes), body.code);
        verified = verified || consumedRecoveryHashes !== null;
      }

      if (!verified) {
        failure = 'wrong';
        const updatedChallenge = await client.query<{ attempts: number }>('UPDATE mfa_login_challenges SET attempts = LEAST(attempts + 1, 8) WHERE id = $1 AND attempts < 8 RETURNING attempts', [challenge.id]);
        if (Number(updatedChallenge.rows[0]?.attempts) >= 8) failure = 'attempts';
        return null;
      }

      let recoveryCodes: string[] | undefined;
      if (challenge.kind === 'enroll') {
        if (!challenge.pending_secret_encrypted) {
          failure = 'invalid';
          return null;
        }
        const generated = generateRecoveryCodes();
        recoveryCodes = generated.codes;
        await client.query(
          `UPDATE users
           SET mfa_secret_encrypted = $1, mfa_enabled_at = now(), mfa_recovery_code_hashes = $2::jsonb, last_login_at = now(), updated_at = now()
           WHERE id = $3 AND organization_id = $4`,
          [challenge.pending_secret_encrypted, JSON.stringify(generated.hashes), user.id, user.organization_id],
        );
      } else {
        if (consumedRecoveryHashes) {
          await client.query(
            `UPDATE users SET mfa_recovery_code_hashes = $1::jsonb, last_login_at = now(), updated_at = now()
             WHERE id = $2 AND organization_id = $3`,
            [JSON.stringify(consumedRecoveryHashes), user.id, user.organization_id],
          );
        } else {
          await client.query('UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1 AND organization_id = $2', [user.id, user.organization_id]);
        }
      }
      await client.query('DELETE FROM sessions WHERE user_id = $1 AND mfa_assured = false', [user.id]);
      await client.query('UPDATE mfa_login_challenges SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [challenge.id]);
      return { user: publicUser(user), remember: challenge.remember, recoveryCodes };
    });
  } catch {
    return NextResponse.json({ error: 'Authentication service is unavailable.' }, { status: 503 });
  }

  if (!success) {
    const response = NextResponse.json({ error: failure === 'attempts' ? 'This MFA challenge has expired. Start again.' : 'Invalid MFA code.' }, { status: 401 });
    if (failure === 'invalid' || failure === 'attempts') clearMfaChallengeCookie(response);
    return response;
  }

  try {
    const session = await createSession(success.user, success.remember, true);
    await resetRateLimit(`mfa:${address}`);
    await resetRateLimit(`login:${address}`);
    await writeAuditLog({ organizationId: success.user.organizationId, actorUserId: success.user.id, action: 'auth.login', entityType: 'user', entityId: success.user.id, request });
    await sendNotification({ organizationId: success.user.organizationId, eventType: 'auth.login', recipientEmail: success.user.email, recipientName: success.user.fullName, subject: 'New iPayTech sign-in', eyebrow: 'Security activity', title: 'A new sign-in was recorded', summary: 'Your iPayTech Operations account was just used to sign in.', fields: [{ label: 'Account', value: success.user.email }, { label: 'IP address', value: address }, { label: 'Time', value: new Date().toLocaleString('en-GB') }], action: { label: 'Review profile', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/profile` } });
    const response = NextResponse.json({ user: success.user, ...(success.recoveryCodes ? { recoveryCodes: success.recoveryCodes } : {}) });
    clearMfaChallengeCookie(response);
    setSessionCookie(response, session.token, session.maxAge);
    return response;
  } catch {
    return NextResponse.json({ error: 'Authentication service is unavailable.' }, { status: 503 });
  }
}
