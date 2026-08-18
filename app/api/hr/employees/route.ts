import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(
    `SELECT u.id, u.full_name, u.email, u.role, u.is_active, u.created_at,
            COUNT(t.id) FILTER (WHERE t.status = 'Pending')::int AS pending_tasks,
            COUNT(t.id) FILTER (WHERE t.status = 'Completed')::int AS completed_tasks,
            (SELECT e.event_type FROM employee_lifecycle_events e WHERE e.user_id = u.id ORDER BY e.created_at DESC LIMIT 1) AS last_event
     FROM users u LEFT JOIN onboarding_tasks t ON t.user_id = u.id AND t.organization_id = u.organization_id
     WHERE u.organization_id = $1 GROUP BY u.id ORDER BY u.is_active DESC, u.full_name`,
    [session.user.organizationId],
  );
  return NextResponse.json({ employees: result.rows });
}
