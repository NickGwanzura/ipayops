import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const MFA_CHALLENGE_COOKIE = 'ipaytech_mfa_challenge';
export const MFA_CHALLENGE_SECONDS = 5 * 60;
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SECRET_DOMAIN = 'ipaytech:mfa-secret:v1\0';
const RECOVERY_DOMAIN = 'ipaytech:mfa-recovery:v1\0';
const ENCRYPTION_VERSION = 'v1';

function base64UrlEncode(value: Buffer) {
  return value.toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url');
}

export function encodeBase32(value: Buffer) {
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let index = 0; index < value.length; index += 1) {
    const byte = value[index];
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
    if (bits > 0) buffer &= (1 << bits) - 1;
    else buffer = 0;
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return output;
}

export function decodeBase32(value: string) {
  const normalized = value.replace(/[\s=-]/g, '').toUpperCase();
  if (!normalized || normalized.length % 8 === 1) throw new Error('Invalid Base32 value.');
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid Base32 value.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 0xff);
    }
    if (bits > 0) buffer &= (1 << bits) - 1;
    else buffer = 0;
  }
  return Buffer.from(output);
}

export function generateTotpSecret() {
  return encodeBase32(randomBytes(20));
}

function encryptionKey() {
  const authSecret = process.env.AUTH_SECRET;
  if (!authSecret || authSecret.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters.');
  return createHash('sha256').update(SECRET_DOMAIN).update(authSecret, 'utf8').digest();
}

export function encryptMfaSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENCRYPTION_VERSION, base64UrlEncode(iv), base64UrlEncode(tag), base64UrlEncode(ciphertext)].join('.');
}

export function decryptMfaSecret(value: string) {
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== ENCRYPTION_VERSION) throw new Error('Invalid encrypted MFA secret.');
  const iv = base64UrlDecode(parts[1]);
  const tag = base64UrlDecode(parts[2]);
  const ciphertext = base64UrlDecode(parts[3]);
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('Invalid encrypted MFA secret.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function totpCode(secret: string, counter: number) {
  const key = decodeBase32(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function constantTimeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyTotpCode(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return false;
  try {
    const counter = Math.floor(now / 1000 / 30);
    let valid = false;
    for (const offset of [-1, 0, 1]) {
      valid = constantTimeStringEqual(totpCode(secret, counter + offset), code) || valid;
    }
    return valid;
  } catch {
    return false;
  }
}

export function normalizeRecoveryCode(code: string) {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashRecoveryCode(code: string) {
  const normalized = normalizeRecoveryCode(code);
  return createHash('sha256').update(RECOVERY_DOMAIN).update(normalized, 'utf8').digest('hex');
}

export function generateRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const raw = encodeBase32(randomBytes(10));
    return raw.match(/.{1,4}/g)?.join('-') || raw;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

export function consumeMatchingRecoveryHash(hashes: string[], code: string) {
  const candidate = Buffer.from(hashRecoveryCode(code), 'hex');
  let matchIndex = -1;
  for (let index = 0; index < hashes.length; index += 1) {
    const stored = hashes[index];
    const storedBuffer = /^[0-9a-f]{64}$/i.test(stored) ? Buffer.from(stored, 'hex') : Buffer.alloc(candidate.length);
    const matches = storedBuffer.length === candidate.length && timingSafeEqual(storedBuffer, candidate);
    if (matches && matchIndex === -1) matchIndex = index;
  }
  if (matchIndex < 0) return null;
  return hashes.filter((_, index) => index !== matchIndex);
}

export function hashChallengeToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateChallengeToken() {
  const rawToken = base64UrlEncode(randomBytes(32));
  return { rawToken, tokenHash: hashChallengeToken(rawToken) };
}

export function buildOtpAuthUri(email: string, secret: string) {
  const issuer = 'iPayTech Operations';
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function readMfaChallengeCookie(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/(?:^|;\s*)ipaytech_mfa_challenge=([^;]+)/);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

export function setMfaChallengeCookie(response: NextResponse, rawToken: string) {
  response.cookies.set({
    name: MFA_CHALLENGE_COOKIE,
    value: rawToken,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MFA_CHALLENGE_SECONDS,
  });
}

export function clearMfaChallengeCookie(response: NextResponse) {
  response.cookies.set({
    name: MFA_CHALLENGE_COOKIE,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
