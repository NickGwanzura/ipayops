import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const limit = Math.min(Math.max(Number(params.get('limit') || 50), 1), 200);
  const values: Array<string | number> = [auth.session.user.organizationId];
  const filters = ['al.organization_id = $1'];
  const addFilter = (sql: string, value: string | number) => { values.push(value); filters.push(sql.replaceAll('$VALUE', `$${values.length}`)); };
  if (params.get('action')) addFilter('al.action = $VALUE', params.get('action') as string);
  if (params.get('entityType')) addFilter('al.entity_type = $VALUE', params.get('entityType') as string);
  if (params.get('actor')) addFilter('al.actor_user_id = $VALUE', params.get('actor') as string);
  if (params.get('from')) addFilter('al.created_at >= $VALUE::timestamptz', params.get('from') as string);
  if (params.get('to')) addFilter('al.created_at < ($VALUE::date + interval \'1 day\')', params.get('to') as string);
  if (params.get('search')) addFilter(`(al.action ILIKE '%' || $VALUE || '%' OR al.entity_type ILIKE '%' || $VALUE || '%' OR al.metadata::text ILIKE '%' || $VALUE || '%' OR u.full_name ILIKE '%' || $VALUE || '%' OR u.email ILIKE '%' || $VALUE || '%')`, params.get('search') as string);
  values.push(limit);
  const result = await query(
    `SELECT al.id, al.action, al.entity_type, al.entity_id, al.metadata, al.ip_address, al.created_at,
            al.user_agent, u.id AS actor_id, u.full_name AS actor_name, u.email AS actor_email
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.actor_user_id
     WHERE ${filters.join(' AND ')}
     ORDER BY al.created_at DESC
     LIMIT $${values.length}`,
    values,
  );
  return NextResponse.json({ auditLogs: result.rows, filters: { action: params.get('action') || '', entityType: params.get('entityType') || '', actor: params.get('actor') || '', from: params.get('from') || '', to: params.get('to') || '', search: params.get('search') || '' } });
}
