const required = ['DATABASE_URL', 'AUTH_SECRET', 'APP_URL'] as const;

export function getServerEnv(options: { strict?: boolean } = {}) {
  const production = process.env.NODE_ENV === 'production';
  const strict = options.strict ?? true;
  const missing = production ? required.filter(key => !process.env[key]) : [];
  if (strict && missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  const storageDriver = process.env.STORAGE_DRIVER || 'local';
  if (production && storageDriver === 'local') console.warn('STORAGE_DRIVER=local is not suitable for production uploads; configure S3-compatible storage.');
  return { storageDriver, timezone: process.env.DEFAULT_TIMEZONE || 'Africa/Harare', currency: process.env.DEFAULT_CURRENCY || 'USD', configured: missing.length === 0 };
}
