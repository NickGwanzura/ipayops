const required = ['DATABASE_URL', 'AUTH_SECRET', 'APP_URL', 'HEALTHCHECK_DATABASE', 'RESEND_API_KEY', 'EMAIL_FROM', 'TRUST_PROXY', 'BACKUP_ENCRYPTION_KEY'] as const;

export function getServerEnv(options: { strict?: boolean } = {}) {
  const production = process.env.NODE_ENV === 'production';
  const strict = options.strict ?? true;
  const storageDriver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  const storageRequired = storageDriver === 's3' ? ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] : [];
  const missing = production ? [...required, ...storageRequired].filter(key => !process.env[key]) : [];
  if (production && process.env.HEALTHCHECK_DATABASE !== 'true' && !missing.includes('HEALTHCHECK_DATABASE=true')) missing.push('HEALTHCHECK_DATABASE=true');
  if (production && process.env.TRUST_PROXY !== 'true' && !missing.includes('TRUST_PROXY=true')) missing.push('TRUST_PROXY=true');
  if (production && !/^[0-9a-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || '')) missing.push('BACKUP_ENCRYPTION_KEY (64 hex characters)');
  if (strict && missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  if (production && storageDriver === 'local') console.warn('STORAGE_DRIVER=local is not suitable for production uploads; configure S3-compatible storage.');
  return { storageDriver, timezone: process.env.DEFAULT_TIMEZONE || 'Africa/Harare', currency: process.env.DEFAULT_CURRENCY || 'USD', configured: missing.length === 0 };
}
