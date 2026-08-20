import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
const client = await pool.connect();
let migrationLockAcquired = false;
try {
  await client.query("SELECT pg_advisory_lock(hashtext('ipaytech_ops_schema_migrations'))");
  migrationLockAcquired = true;
  await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const files = (await readdir(join(process.cwd(), 'db/migrations'))).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    const exists = await client.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
    if (exists.rowCount) continue;
    await client.query('BEGIN');
    try {
      await client.query(await readFile(join(process.cwd(), 'db/migrations', file), 'utf8'));
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Applied ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
} finally {
  if (migrationLockAcquired) await client.query("SELECT pg_advisory_unlock(hashtext('ipaytech_ops_schema_migrations'))");
  client.release();
  await pool.end();
}
