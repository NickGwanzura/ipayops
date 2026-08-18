const production = process.env.NODE_ENV === 'production';
const required = ['DATABASE_URL', 'AUTH_SECRET', 'APP_URL'];
const missing = production ? required.filter(key => !process.env[key]) : [];
if (missing.length) {
  console.error(`Missing required production variables: ${missing.join(', ')}`);
  process.exit(1);
}
if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length < 32) {
  console.error('AUTH_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (production && process.env.STORAGE_DRIVER === 'local') console.warn('Warning: local storage is ephemeral in production; use STORAGE_DRIVER=s3.');
console.log(`Environment contract OK (${production ? 'production' : 'development'}).`);
