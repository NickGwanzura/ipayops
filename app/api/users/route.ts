import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const auth = await requireRole(request, [...ACCESS.finance, ...ACCESS.hr]);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query('SELECT id, full_name, email, role FROM users WHERE organization_id = $1 AND is_active = true ORDER BY full_name', [session.user.organizationId]);
  return NextResponse.json({ users: result.rows });
}
