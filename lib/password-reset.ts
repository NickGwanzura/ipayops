import { createHash, randomBytes } from 'node:crypto';

export function generatePasswordResetToken() {
  const rawToken = randomBytes(32).toString('base64url');
  return { rawToken, tokenHash: hashPasswordResetToken(rawToken) };
}

export function hashPasswordResetToken(rawToken: string) {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}
