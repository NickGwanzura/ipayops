import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const values: Array<string | number> = [auth.session.user.organizationId];
  const filters = ['organization_id = $1'];
  const addFilter = (sql: string, value: string | number) => { values.push(value); filters.push(sql.replaceAll('$VALUE', `$${values.length}`)); };
  if (params.get('status')) addFilter('status = $VALUE', params.get('status') as string);
  if (params.get('eventType')) addFilter('event_type = $VALUE', params.get('eventType') as string);
  if (params.get('search')) addFilter("(recipient_email ILIKE '%' || $VALUE || '%' OR subject ILIKE '%' || $VALUE || '%' OR event_type ILIKE '%' || $VALUE || '%' OR provider_id ILIKE '%' || $VALUE || '%' OR error_message ILIKE '%' || $VALUE || '%')", params.get('search') as string);
  const limit = Math.min(Math.max(Number(params.get('limit') || 100), 1), 250);
  values.push(limit);
  const result = await query(
    `SELECT id, event_type, recipient_email, subject, status, provider_id, error_message, created_at
     FROM notification_deliveries
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${values.length}`,
    values,
  );
  const filtersResult = await query(
    `SELECT DISTINCT event_type FROM notification_deliveries WHERE organization_id = $1 ORDER BY event_type`,
    [auth.session.user.organizationId],
  );
  return NextResponse.json({ deliveries: result.rows, eventTypes: filtersResult.rows.map(row => row.event_type), filters: { status: params.get('status') || '', eventType: params.get('eventType') || '', search: params.get('search') || '' } });
}
