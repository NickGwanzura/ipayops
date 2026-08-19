import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, getSession, hasRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { deleteStorageObject, getStorageObject, usesS3 } from '@/lib/storage';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query('SELECT storage_key, mime_type, file_name FROM attachments WHERE id = $1 AND organization_id = $2', [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  try { const bytes = usesS3() ? await getStorageObject(result.rows[0].storage_key) : await readFile(join(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'), result.rows[0].storage_key)); if (!bytes) return NextResponse.json({ error: 'Attachment file is unavailable.' }, { status: 410 }); return new NextResponse(bytes, { headers: { 'Content-Type': result.rows[0].mime_type, 'Content-Disposition': `inline; filename="${result.rows[0].file_name.replaceAll('"', '')}"`, 'Cache-Control': 'private, max-age=300' } }); } catch { return NextResponse.json({ error: 'Attachment file is unavailable.' }, { status: 410 }); }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query('SELECT storage_key, entity_type FROM attachments WHERE id = $1 AND organization_id = $2', [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  const canDelete = result.rows[0].entity_type === 'expense' ? hasRole(session.user.role, ACCESS.expenseSubmitter) : hasRole(session.user.role, ACCESS.field);
  if (!canDelete) return NextResponse.json({ error: 'You do not have permission to delete this attachment.' }, { status: 403 });
  try {
    if (usesS3()) await deleteStorageObject(result.rows[0].storage_key);
    else await unlink(join(process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'), result.rows[0].storage_key)).catch(error => { if ((error as { code?: string }).code !== 'ENOENT') throw error; });
    await query('DELETE FROM attachments WHERE id = $1 AND organization_id = $2', [params.id, session.user.organizationId]);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Attachment deletion failed', error);
    return NextResponse.json({ error: 'Unable to delete attachment.' }, { status: 500 });
  }
}
