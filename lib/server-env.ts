const required = ['DATABASE_URL', 'AUTH_SECRET', 'APP_URL', 'HEALTHCHECK_DATABASE', 'HEALTHCHECK_STORAGE', 'ERROR_MONITORING_WEBHOOK_URL', 'RESEND_API_KEY', 'EMAIL_FROM', 'TRUST_PROXY', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_ADMIN_ORGANIZATION_ID'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hasValue(key: string) {
  return Boolean(process.env[key]?.trim());
}

export function isUuid(value: string) {
  return UUID_PATTERN.test(value.trim());
}

export function isPrivilegedMfaRequired() {
  return process.env.REQUIRE_PRIVILEGED_MFA !== 'false';
}

export function getServerEnv(options: { strict?: boolean } = {}) {
  const production = process.env.NODE_ENV === 'production';
  const strict = options.strict ?? true;
  const storageDriver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  const storageRequired = storageDriver === 's3' ? ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] : [];
  const missing = production ? [...required, ...storageRequired].filter(key => !hasValue(key)) : [];
  if (production && hasValue('AUTH_SECRET') && (process.env.AUTH_SECRET || '').length < 32) missing.push('AUTH_SECRET (at least 32 characters)');
  if (production && hasValue('APP_URL')) {
    try {
      const appUrl = new URL(process.env.APP_URL || '');
      if (appUrl.protocol !== 'https:') missing.push('APP_URL (HTTPS URL)');
    } catch {
      missing.push('APP_URL (valid URL)');
    }
  }
  if (production && process.env.HEALTHCHECK_DATABASE !== 'true' && !missing.includes('HEALTHCHECK_DATABASE=true')) missing.push('HEALTHCHECK_DATABASE=true');
  if (production && process.env.HEALTHCHECK_STORAGE !== 'true' && !missing.includes('HEALTHCHECK_STORAGE=true')) missing.push('HEALTHCHECK_STORAGE=true');
  if (production && process.env.TRUST_PROXY !== 'true' && !missing.includes('TRUST_PROXY=true')) missing.push('TRUST_PROXY=true');
  if (production && !process.env.ERROR_MONITORING_WEBHOOK_URL?.trim()) {
    if (!missing.includes('ERROR_MONITORING_WEBHOOK_URL')) missing.push('ERROR_MONITORING_WEBHOOK_URL');
  } else if (production) {
    try {
      if (new URL(process.env.ERROR_MONITORING_WEBHOOK_URL as string).protocol !== 'https:') missing.push('ERROR_MONITORING_WEBHOOK_URL (HTTPS URL)');
    } catch {
      missing.push('ERROR_MONITORING_WEBHOOK_URL (HTTPS URL)');
    }
  }
  if (production && !/^[0-9a-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || '')) missing.push('BACKUP_ENCRYPTION_KEY (64 hex characters)');
  if (production && !isUuid(process.env.BACKUP_ADMIN_ORGANIZATION_ID || '')) missing.push('BACKUP_ADMIN_ORGANIZATION_ID (valid UUID)');
  if (production && !['true', 'false'].includes(process.env.REQUIRE_PRIVILEGED_MFA || '') && !missing.includes('REQUIRE_PRIVILEGED_MFA=true|false')) missing.push('REQUIRE_PRIVILEGED_MFA=true|false');
  if (production && storageDriver !== 's3' && !missing.includes('STORAGE_DRIVER=s3')) missing.push('STORAGE_DRIVER=s3');
  if (production && storageDriver === 's3' && hasValue('S3_ENDPOINT')) {
    try {
      const endpoint = new URL(process.env.S3_ENDPOINT || '');
      if (endpoint.protocol !== 'https:') missing.push('S3_ENDPOINT (HTTPS URL)');
    } catch {
      missing.push('S3_ENDPOINT (valid URL)');
    }
  }
  if (strict && missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  if (production && storageDriver !== 's3') console.warn('Production storage must use STORAGE_DRIVER=s3 with an S3-compatible bucket.');
  return { storageDriver, timezone: process.env.DEFAULT_TIMEZONE || 'Africa/Harare', currency: process.env.DEFAULT_CURRENCY || 'USD', privilegedMfaRequired: isPrivilegedMfaRequired(), configured: missing.length === 0 };
}
