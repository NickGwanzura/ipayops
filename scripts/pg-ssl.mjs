import { readFileSync } from 'node:fs';

// DATABASE_SSL=true verifies the server certificate. Supply the CA with DATABASE_SSL_CA_FILE (or DATABASE_SSL_CA),
// or set DATABASE_SSL_REJECT_UNAUTHORIZED=false to knowingly accept an unverifiable certificate.
export function databaseSsl() {
  if (process.env.DATABASE_SSL !== 'true') return undefined;
  const ca = process.env.DATABASE_SSL_CA_FILE ? readFileSync(process.env.DATABASE_SSL_CA_FILE, 'utf8') : process.env.DATABASE_SSL_CA || undefined;
  return { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false', ...(ca ? { ca } : {}) };
}
