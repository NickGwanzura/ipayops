import { mkdtemp, rm } from 'node:fs/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const exec = promisify(execFile);

if (process.env.RESTORE_DRILL !== 'true') throw new Error('Refusing restore drill without RESTORE_DRILL=true.');
if (!process.env.DATABASE_URL || !process.env.RESTORE_DATABASE_URL) throw new Error('DATABASE_URL and RESTORE_DATABASE_URL are required.');
if (!/^[0-9a-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY?.trim() || '')) throw new Error('BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters.');

const backupKey = Buffer.from(process.env.BACKUP_ENCRYPTION_KEY.trim(), 'hex');

function safeUrl(value, label) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  const localHost = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(host) || /(?:^|[-_.])(test|ci|uat|integration|local|dev|restore)(?:[-_.]|$)/.test(host);
  const testDatabase = /(?:test|ci|uat|integration|local|dev|restore)/.test(database);
  if (!localHost || !testDatabase) throw new Error(`Refusing ${label}: restore targets must clearly be local/test (host=${url.hostname}, database=${database}).`);
  return url;
}

const source = safeUrl(process.env.DATABASE_URL, 'DATABASE_URL');
const target = safeUrl(process.env.RESTORE_DATABASE_URL, 'RESTORE_DATABASE_URL');
const sourceKey = `${source.protocol}//${source.hostname}:${source.port || '5432'}${source.pathname}`;
const targetKey = `${target.protocol}//${target.hostname}:${target.port || '5432'}${target.pathname}`;
if (sourceKey === targetKey) throw new Error('Refusing restore drill: source and restore database URLs identify the same database.');

const sourcePool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
const targetPool = new Pool({ connectionString: process.env.RESTORE_DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
const requiredTables = ['schema_migrations', 'organizations', 'users', 'clients', 'inventory_items', 'quotations', 'sales', 'warranty_claims', 'repair_requisitions', 'audit_logs', 'mfa_login_challenges', 'notification_deliveries', 'backup_runs'];
let temporaryDirectory;

async function encryptBackup(dumpPath, encryptedPath) {
  const dump = await readFile(dumpPath);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', backupKey, iv);
  const ciphertext = Buffer.concat([cipher.update(dump), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Unexpected AES-256-GCM envelope dimensions.');
  await writeFile(encryptedPath, Buffer.concat([iv, ciphertext, tag]));
  return { dumpBytes: dump.length, ciphertextBytes: ciphertext.length, ivBytes: iv.length, tagBytes: tag.length };
}

async function decryptBackup(encryptedPath, decryptedPath) {
  const envelope = await readFile(encryptedPath);
  if (envelope.length <= 12 + 16) throw new Error('Encrypted backup envelope is too small.');
  const iv = envelope.subarray(0, 12);
  const tag = envelope.subarray(envelope.length - 16);
  const ciphertext = envelope.subarray(12, envelope.length - 16);
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error('Encrypted backup envelope must be [12-byte IV][ciphertext][16-byte GCM tag].');
  const decipher = createDecipheriv('aes-256-gcm', backupKey, iv);
  decipher.setAuthTag(tag);
  const dump = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  await writeFile(decryptedPath, dump);
  return { envelopeBytes: envelope.length, decryptedBytes: dump.length, ivBytes: iv.length, tagBytes: tag.length };
}

async function sha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

try {
  const existing = await targetPool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  if (existing.rows.length) throw new Error(`Restore target is not empty: ${existing.rows.map(row => row.table_name).join(', ')}`);
  await sourcePool.query('SELECT 1');
  await targetPool.query('SELECT 1');
  temporaryDirectory = await mkdtemp(join(tmpdir(), 'luna-restore-drill-'));
  const dumpPath = join(temporaryDirectory, 'source.dump');
  const encryptedPath = join(temporaryDirectory, 'source.dump.enc');
  const decryptedPath = join(temporaryDirectory, 'decrypted.dump');
  console.log(`RESTORE source=${source.hostname}${source.pathname} target=${target.hostname}${target.pathname}`);
  await exec('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', dumpPath, process.env.DATABASE_URL], { maxBuffer: 1024 * 1024 * 10 });
  const encrypted = await encryptBackup(dumpPath, encryptedPath);
  const decrypted = await decryptBackup(encryptedPath, decryptedPath);
  if (decrypted.decryptedBytes !== encrypted.dumpBytes) throw new Error('Decrypted backup size does not match the source dump.');
  const [sourceChecksum, decryptedChecksum] = await Promise.all([sha256(dumpPath), sha256(decryptedPath)]);
  if (decryptedChecksum !== sourceChecksum) throw new Error('Decrypted backup does not match the source dump.');
  await exec('pg_restore', ['--exit-on-error', '--no-owner', '--no-privileges', '--dbname', process.env.RESTORE_DATABASE_URL, decryptedPath], { maxBuffer: 1024 * 1024 * 10 });
  const migrationCount = await targetPool.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
  const tableRows = await targetPool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[]) ORDER BY table_name`, [requiredTables]);
  const restored = tableRows.rows.map(row => row.table_name);
  const missing = requiredTables.filter(table => !restored.includes(table));
  if (missing.length) throw new Error(`Restore is missing required tables: ${missing.join(', ')}`);
  console.log(`RESTORE EVIDENCE envelope=iv:${encrypted.ivBytes} ciphertext:${encrypted.ciphertextBytes} tag:${encrypted.tagBytes} decrypted_bytes:${decrypted.decryptedBytes} sha256:${decryptedChecksum}`);
  console.log(`RESTORE EVIDENCE schema_migrations_count=${migrationCount.rows[0].count} required_tables=${restored.length}/${requiredTables.length}`);
  console.log(`RESTORE EVIDENCE tables=${restored.join(',')}`);
  console.log('Restore drill passed.');
} catch (error) {
  console.error(`Restore drill failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  await sourcePool.end();
  await targetPool.end();
}
