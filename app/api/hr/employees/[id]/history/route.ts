import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.hr);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const employee = await query(
    `SELECT id, full_name, email, role, is_active FROM users WHERE id = $1 AND organization_id = $2`,
    [params.id, session.user.organizationId],
  );
  if (!employee.rows[0]) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
  const events = await query(
    `SELECT e.id, e.event_type, e.status, e.effective_at, e.notes, e.created_at, creator.full_name AS created_by_name
     FROM employee_lifecycle_events e
     LEFT JOIN users creator ON creator.id = e.created_by
     WHERE e.user_id = $1 AND e.organization_id = $2
     ORDER BY e.effective_at DESC, e.created_at DESC`,
    [params.id, session.user.organizationId],
  );
  return NextResponse.json({ employee: employee.rows[0], events: events.rows });
}
