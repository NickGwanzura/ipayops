import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { query, withTransaction } from '@/lib/db';
import { deleteStorageObject, putStorageFile, usesS3 } from '@/lib/storage';
import { writeAuditLog } from '@/lib/audit';

type BackupInput = { id: string; organizationId: string; requestedBy: string | null; lockedAt: string };
type ClaimedBackupRow = { id: string; organization_id: string; requested_by: string | null; attempts: number; max_attempts: number; locked_at: string };

const BACKUP_MAX_ATTEMPTS = 3;

function encryptionKey() {
  const value = process.env.BACKUP_ENCRYPTION_KEY?.trim() || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  return Buffer.from(value, 'hex');
}

function storageKey(organizationId: string, backupId: string, lockedAt: string, leaseId: string) {
  const configuredPrefix = process.env.BACKUP_STORAGE_PREFIX || 'backups';
  const prefix = configuredPrefix.replace(/^\/+|\/+$/g, '') || 'backups';
  return `${prefix}/${organizationId}/${backupId}/${encodeURIComponent(lockedAt)}-${leaseId}.dump.enc`;
}

function databaseDumpArguments() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL is not configured.');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL must use a PostgreSQL connection URL.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new Error('DATABASE_URL is missing a database name.');
  const args = [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    '--host', url.hostname,
    '--port', url.port || '5432',
    '--username', decodeURIComponent(url.username),
    '--dbname', database,
  ];
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  const sslMode = process.env.DATABASE_SSL === 'true' || url.searchParams.get('sslmode') === 'require' ? 'require' : (process.env.PGSSLMODE || 'prefer');
  return { args, password, sslMode };
}

async function encryptedDump(filePath: string) {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const { args, password, sslMode } = databaseDumpArguments();
  const child = spawn('pg_dump', args, {
    env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}), PGSSLMODE: sslMode },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exit = new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? -1));
  });
  try {
    if (!child.stdout) throw new Error('pg_dump did not provide an output stream.');
    const output = createWriteStream(filePath);
    output.write(iv);
    await pipeline(child.stdout, cipher, output);
    const exitCode = await exit;
    if (exitCode !== 0) throw new Error(stderr.trim() || `pg_dump exited with code ${exitCode}.`);
  } catch (error) {
    if (!child.killed) child.kill('SIGTERM');
    await exit.catch(() => undefined);
    throw error;
  }
  await appendFile(filePath, cipher.getAuthTag());
}

async function sha256(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Backup failed.';
  return message.replace(/\s+/g, ' ').slice(0, 1000);
}

async function hasBackupLease(id: string, organizationId: string, lockedAt: string) {
  const result = await query<{ id: string }>(
    `SELECT id
     FROM backup_runs
     WHERE id = $1 AND organization_id = $2 AND status = 'running' AND locked_at = $3::timestamptz`,
    [id, organizationId, lockedAt],
  );
  return Boolean(result.rows[0]);
}

async function deleteUploadedOrphan(key: string) {
  await deleteStorageObject(key).catch(error => {
    console.error('Backup orphan cleanup failed', { key, error: safeError(error) });
  });
}

async function claimBackup() {
  return withTransaction(async client => {
    const result = await client.query<ClaimedBackupRow>(
      `SELECT id, organization_id, requested_by, attempts, max_attempts
       FROM backup_runs
       WHERE status = 'pending' AND available_at <= now()
       ORDER BY available_at ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
    );
    if (!result.rows[0]) return null;
    const claimed = await client.query<ClaimedBackupRow>(
      `UPDATE backup_runs
       SET status = 'running', attempts = attempts + 1, locked_at = now(), started_at = now(), completed_at = NULL, updated_at = now()
       WHERE id = $1
       RETURNING id, organization_id, requested_by, attempts, max_attempts, locked_at::text AS locked_at`,
      [result.rows[0].id],
    );
    return claimed.rows[0] || null;
  });
}

export async function processBackupQueue(limit = 1) {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 10);
  await query(
    `UPDATE backup_runs
     SET status = 'pending', locked_at = NULL, available_at = now(), updated_at = now()
     WHERE status = 'running' AND locked_at < now() - interval '15 minutes'`,
  );
  let processed = 0;
  for (let index = 0; index < boundedLimit; index += 1) {
    const row = await claimBackup();
    if (!row) break;
    await executeBackup({ id: row.id, organizationId: row.organization_id, requestedBy: row.requested_by, lockedAt: row.locked_at });
    processed += 1;
  }
  return processed;
}

export async function executeBackup(input: BackupInput) {
  const claimed = await query<ClaimedBackupRow>(
    `SELECT id, organization_id, requested_by, attempts, max_attempts, locked_at::text AS locked_at
     FROM backup_runs
     WHERE id = $1 AND organization_id = $2 AND status = 'running' AND locked_at = $3::timestamptz`,
    [input.id, input.organizationId, input.lockedAt],
  );
  if (!claimed.rows[0]) return;
  const run = claimed.rows[0];
  // This suffix makes every worker execution's object immutable, even if lease timestamps collide.
  const leaseId = randomUUID();
  const tempDir = await mkdtemp(join(tmpdir(), 'ipaytech-backup-'));
  const encryptedPath = join(tempDir, `${run.id}.dump.enc`);
  let uploadedKey: string | null = null;
  try {
    if (!usesS3()) throw new Error('R2 backup storage is not enabled.');
    await encryptedDump(encryptedPath);
    const fileStats = await stat(encryptedPath);
    const checksum = await sha256(encryptedPath);
    const key = storageKey(run.organization_id, run.id, input.lockedAt, leaseId);
    // The dump can outlive the lease. Avoid uploading when the worker already lost ownership.
    if (!await hasBackupLease(run.id, run.organization_id, input.lockedAt)) return;
    uploadedKey = key;
    await putStorageFile(key, encryptedPath, 'application/octet-stream', {
      encrypted: 'aes-256-gcm',
      'backup-id': run.id,
      'organization-id': run.organization_id,
      'lease-id': leaseId,
    });
    if (!await hasBackupLease(run.id, run.organization_id, input.lockedAt)) {
      await deleteUploadedOrphan(key);
      uploadedKey = null;
      return;
    }
    const completed = await query(
      "UPDATE backup_runs SET status = 'completed', storage_key = $2, size_bytes = $3, checksum_sha256 = $4, completed_at = now(), error_message = NULL, locked_at = NULL, updated_at = now() WHERE id = $1 AND status = 'running' AND locked_at = $5::timestamptz",
      [run.id, key, fileStats.size, checksum, input.lockedAt],
    );
    if (!completed.rowCount) {
      // A stale lease may have uploaded successfully, but its bytes are no longer authoritative.
      await deleteUploadedOrphan(key);
      uploadedKey = null;
      return;
    }
    uploadedKey = null;
    if (completed.rowCount) await writeAuditLog({ organizationId: run.organization_id, actorUserId: run.requested_by || undefined, action: 'backup.completed', entityType: 'backup_run', entityId: run.id, metadata: { sizeBytes: fileStats.size, checksumSha256: checksum } });
  } catch (error) {
    if (uploadedKey) {
      await deleteUploadedOrphan(uploadedKey);
      uploadedKey = null;
    }
    const message = safeError(error);
    const maxAttempts = Math.max(1, run.max_attempts || BACKUP_MAX_ATTEMPTS);
    const exhausted = run.attempts >= maxAttempts;
    const delaySeconds = Math.min(30 * 60, 30 * Math.pow(2, Math.max(0, run.attempts - 1)));
    const failed = await query(
      `UPDATE backup_runs
       SET status = $2,
           error_message = $3,
           available_at = CASE WHEN $2 = 'pending' THEN now() + ($4::integer * interval '1 second') ELSE now() END,
           locked_at = NULL,
           completed_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $1 AND status = 'running' AND locked_at = $5::timestamptz`,
      [run.id, exhausted ? 'failed' : 'pending', message, delaySeconds, input.lockedAt],
    ).catch(updateError => {
      console.error('Backup failure status update failed', updateError);
      return { rowCount: 0 };
    });
    if (failed.rowCount) await writeAuditLog({ organizationId: run.organization_id, actorUserId: run.requested_by || undefined, action: exhausted ? 'backup.failed' : 'backup.retry_scheduled', entityType: 'backup_run', entityId: run.id, metadata: { error: message, attempts: run.attempts, maxAttempts } });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
