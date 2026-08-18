import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query('SELECT id, full_name, email, role FROM users WHERE organization_id = $1 AND is_active = true ORDER BY full_name', [session.user.organizationId]);
  return NextResponse.json({ users: result.rows });
}
