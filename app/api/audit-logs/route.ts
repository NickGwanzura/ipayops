import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get('limit') || 50), 1), 100);
  const result = await query(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.metadata, al.ip_address, al.created_at,
            u.full_name AS actor_name, u.email AS actor_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE al.organization_id = $1
     ORDER BY al.created_at DESC
     LIMIT $2`,
    [auth.session.user.organizationId, limit],
  );
  return NextResponse.json({ auditLogs: result.rows });
}
