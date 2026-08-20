import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { executeBackup } from '@/lib/backup';
import { usesS3 } from '@/lib/storage';
import { writeAuditLog } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type BackupRow = {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  size_bytes: string | number | null;
  checksum_sha256: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

function serialize(row: BackupRow) {
  return {
    id: row.id,
    status: row.status,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  try {
    const result = await query<BackupRow>(
      `SELECT id, status, size_bytes, checksum_sha256, error_message, started_at, completed_at, created_at
       FROM backup_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [auth.session.user.organizationId],
    );
    return NextResponse.json({ backups: result.rows.map(serialize) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Backup history load failed', error);
    return NextResponse.json({ error: 'Backup history is unavailable. Apply the latest database migrations.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  if (!usesS3()) return NextResponse.json({ error: 'R2 backup storage is not enabled. Set STORAGE_DRIVER=s3 and configure the S3 variables.' }, { status: 503 });
  if (!/^[0-9a-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY?.trim() || '')) return NextResponse.json({ error: 'Backup encryption is not configured. Set BACKUP_ENCRYPTION_KEY to 64 hexadecimal characters.' }, { status: 503 });
  try {
    const result = await query<{ id: string }>(
      `INSERT INTO backup_runs (organization_id, requested_by, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [auth.session.user.organizationId, auth.session.user.id],
    );
    const id = result.rows[0].id;
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'backup.requested', entityType: 'backup_run', entityId: id, request });
    void executeBackup({ id, organizationId: auth.session.user.organizationId, requestedBy: auth.session.user.id });
    return NextResponse.json({ backup: { id, status: 'pending' } }, { status: 202 });
  } catch (error) {
    const databaseError = error as { constraint?: string; message?: string };
    if (databaseError.constraint === 'backup_runs_active_organization_idx' || databaseError.message?.includes('backup_runs_active_organization_idx')) return NextResponse.json({ error: 'A backup is already running for this organization.' }, { status: 409 });
    console.error('Backup request failed', error);
    return NextResponse.json({ error: 'Unable to start the backup. Apply the latest database migrations.' }, { status: 503 });
  }
}
