import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const MAX_BYTES = 10 * 1024 * 1024;
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const entityType = request.nextUrl.searchParams.get('entityType') || ''; const entityId = request.nextUrl.searchParams.get('entityId') || '';
  const result = await query('SELECT id, entity_type, entity_id, file_name, mime_type, size_bytes, created_at FROM attachments WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 ORDER BY created_at DESC', [session.user.organizationId, entityType, entityId]);
  return NextResponse.json({ attachments: result.rows });
}

export async function POST(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  try {
    const form = await request.formData(); const entityType = String(form.get('entityType') || ''); const entityId = String(form.get('entityId') || ''); const file = form.get('file');
    if (!['job', 'claim'].includes(entityType) || !entityId || !(file instanceof File)) return NextResponse.json({ error: 'Entity and file are required.' }, { status: 400 });
    if (!allowedTypes.has(file.type)) return NextResponse.json({ error: 'Only JPG, PNG, WEBP, and PDF files are supported.' }, { status: 415 });
    if (file.size <= 0 || file.size > MAX_BYTES) return NextResponse.json({ error: 'Attachment must be smaller than 10 MB.' }, { status: 413 });
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '';
    const storageKey = `${session.user.organizationId}/${entityType}/${entityId}/${randomUUID()}${ext}`; const root = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'); const fullPath = join(root, storageKey);
    await mkdir(join(root, session.user.organizationId, entityType, entityId), { recursive: true }); await writeFile(fullPath, Buffer.from(await file.arrayBuffer()));
    const result = await query('INSERT INTO attachments (organization_id, entity_type, entity_id, file_name, storage_key, mime_type, size_bytes, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, entity_type, entity_id, file_name, mime_type, size_bytes, created_at', [session.user.organizationId, entityType, entityId, file.name, storageKey, file.type, file.size, session.user.id]);
    return NextResponse.json({ attachment: result.rows[0] }, { status: 201 });
  } catch (error) { console.error('Attachment upload failed', error); return NextResponse.json({ error: 'Unable to upload attachment.' }, { status: 500 }); }
}
