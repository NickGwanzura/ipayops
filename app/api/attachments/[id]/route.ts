import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query('SELECT storage_key, mime_type, file_name FROM attachments WHERE id = $1 AND organization_id = $2', [params.id, session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Attachment not found.' }, { status: 404 });
  try { const root = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads'); const bytes = await readFile(join(root, result.rows[0].storage_key)); return new NextResponse(bytes, { headers: { 'Content-Type': result.rows[0].mime_type, 'Content-Disposition': `inline; filename="${result.rows[0].file_name.replaceAll('"', '')}"`, 'Cache-Control': 'private, max-age=300' } }); } catch { return NextResponse.json({ error: 'Attachment file is unavailable.' }, { status: 410 }); }
}
