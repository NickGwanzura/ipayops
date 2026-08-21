import { createHash, randomBytes } from 'node:crypto';

export const INVITATION_TTL_HOURS = 24;

export function createInvitationToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function invitationUrl(token: string) {
  const baseUrl = (process.env.APP_URL || 'https://ipaytechops.com').replace(/\/$/, '');
  return `${baseUrl}/invite/${encodeURIComponent(token)}`;
}
