import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { appendFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { query } from '@/lib/db';
import { putStorageFile } from '@/lib/storage';
import { writeAuditLog } from '@/lib/audit';

type BackupInput = { id: string; organizationId: string; requestedBy: string };

function encryptionKey() {
  const value = process.env.BACKUP_ENCRYPTION_KEY?.trim() || '';
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hexadecimal characters.');
  return Buffer.from(value, 'hex');
}

function storageKey(organizationId: string, backupId: string) {
  const configuredPrefix = process.env.BACKUP_STORAGE_PREFIX || 'backups';
  const prefix = configuredPrefix.replace(/^\/+|\/+$/g, '') || 'backups';
  return `${prefix}/${organizationId}/${backupId}.dump.enc`;
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

export async function executeBackup(input: BackupInput) {
  const tempDir = await mkdtemp(join(tmpdir(), 'ipaytech-backup-'));
  const encryptedPath = join(tempDir, `${input.id}.dump.enc`);
  try {
    await query("UPDATE backup_runs SET status = 'running', started_at = now() WHERE id = $1 AND status = 'pending'", [input.id]);
    await encryptedDump(encryptedPath);
    const fileStats = await stat(encryptedPath);
    const checksum = await sha256(encryptedPath);
    const key = storageKey(input.organizationId, input.id);
    await putStorageFile(key, encryptedPath, 'application/octet-stream', {
      encrypted: 'aes-256-gcm',
      'backup-id': input.id,
      'organization-id': input.organizationId,
    });
    await query(
      "UPDATE backup_runs SET status = 'completed', storage_key = $2, size_bytes = $3, checksum_sha256 = $4, completed_at = now(), error_message = NULL WHERE id = $1",
      [input.id, key, fileStats.size, checksum],
    );
    await writeAuditLog({ organizationId: input.organizationId, actorUserId: input.requestedBy, action: 'backup.completed', entityType: 'backup_run', entityId: input.id, metadata: { sizeBytes: fileStats.size, checksumSha256: checksum } });
  } catch (error) {
    const message = safeError(error);
    await query("UPDATE backup_runs SET status = 'failed', error_message = $2, completed_at = now() WHERE id = $1", [input.id, message]).catch(updateError => console.error('Backup failure status update failed', updateError));
    await writeAuditLog({ organizationId: input.organizationId, actorUserId: input.requestedBy, action: 'backup.failed', entityType: 'backup_run', entityId: input.id, metadata: { error: message } });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
