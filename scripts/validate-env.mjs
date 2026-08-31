const production = process.env.NODE_ENV === 'production';
const required = ['DATABASE_URL', 'AUTH_SECRET', 'APP_URL', 'HEALTHCHECK_DATABASE', 'HEALTHCHECK_STORAGE', 'ERROR_MONITORING_WEBHOOK_URL', 'RESEND_API_KEY', 'EMAIL_FROM', 'TRUST_PROXY', 'BACKUP_ENCRYPTION_KEY', 'BACKUP_ADMIN_ORGANIZATION_ID'];
const hasValue = key => Boolean(process.env[key]?.trim());
const missing = production ? required.filter(key => !hasValue(key)) : [];
if (missing.length) {
  console.error(`Missing required production variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) {
  console.error('AUTH_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (production && process.env.HEALTHCHECK_DATABASE !== 'true') {
  console.error('HEALTHCHECK_DATABASE=true is required in production.');
  process.exit(1);
}
if (production && process.env.HEALTHCHECK_STORAGE !== 'true') {
  console.error('HEALTHCHECK_STORAGE=true is required in production.');
  process.exit(1);
}
if (production) {
  try {
    if (new URL(process.env.ERROR_MONITORING_WEBHOOK_URL || '').protocol !== 'https:') throw new Error('not HTTPS');
  } catch {
    console.error('ERROR_MONITORING_WEBHOOK_URL must be a valid HTTPS URL in production.');
    process.exit(1);
  }
}
if (production && process.env.TRUST_PROXY !== 'true') {
  console.error('TRUST_PROXY=true is required when running behind the production reverse proxy.');
  process.exit(1);
}
if (production && !['true', 'false'].includes(process.env.REQUIRE_PRIVILEGED_MFA || '')) {
  console.error('REQUIRE_PRIVILEGED_MFA must be explicitly set to true or false in production.');
  process.exit(1);
}
if (production && !/^[0-9a-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY || '')) {
  console.error('BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters in production.');
  process.exit(1);
}
if (production && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test((process.env.BACKUP_ADMIN_ORGANIZATION_ID || '').trim())) {
  console.error('BACKUP_ADMIN_ORGANIZATION_ID must be a valid UUID in production.');
  process.exit(1);
}
const storageDriver = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
if (production && storageDriver !== 's3') {
  console.error('STORAGE_DRIVER=s3 is required in production; local or unknown storage drivers are not permitted.');
  process.exit(1);
}
if (production && storageDriver === 's3') {
  const storageMissing = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter(key => !hasValue(key));
  if (storageMissing.length) {
    console.error(`Missing required production storage variables: ${storageMissing.join(', ')}`);
    process.exit(1);
  }
  try {
    if (new URL(process.env.S3_ENDPOINT || '').protocol !== 'https:') throw new Error('not HTTPS');
  } catch {
    console.error('S3_ENDPOINT must be a valid HTTPS URL in production.');
    process.exit(1);
  }
}
if (production && process.env.APP_URL) {
  try {
    const appUrl = new URL(process.env.APP_URL);
    if (appUrl.protocol !== 'https:') {
      console.error('APP_URL must use HTTPS in production.');
      process.exit(1);
    }
  } catch {
    console.error('APP_URL must be a valid URL.');
    process.exit(1);
  }
}
console.log(`Environment contract OK (${production ? 'production' : 'development'}).`);
