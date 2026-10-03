import { readFileSync } from 'node:fs';

/** Mirrors scripts/pg-ssl.mjs: certificates are verified unless DATABASE_SSL_REJECT_UNAUTHORIZED=false. */
export function databaseSsl() {
  if (process.env.DATABASE_SSL !== 'true') return undefined;
  const ca = process.env.DATABASE_SSL_CA_FILE ? readFileSync(process.env.DATABASE_SSL_CA_FILE, 'utf8') : process.env.DATABASE_SSL_CA || undefined;
  return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false', ...(ca ? { ca } : {}) };
}
