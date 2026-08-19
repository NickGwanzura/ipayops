import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, hashPassword, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const createSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(12).max(128),
  role: z.enum(['ceo', 'admin', 'manager', 'operator', 'finance', 'hr', 'installer', 'viewer']).default('operator'),
});

export async function GET(request: Request) {
  const auth = await requireRole(request, ACCESS.hr);
  if ('response' in auth) return auth.response;
  const { session } = auth;
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

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.hr);
    if ('response' in auth) return auth.response;
    const body = createSchema.parse(await request.json());
    const passwordHash = await hashPassword(body.password);
    const employee = await withTransaction(async client => {
      const result = await client.query(
        `INSERT INTO users (organization_id, email, full_name, password_hash, role)
         VALUES ($1, lower($2), $3, $4, $5)
         RETURNING id, full_name, email, role, is_active, created_at`,
        [auth.session.user.organizationId, body.email, body.fullName, passwordHash, body.role],
      );
      await client.query(
        `INSERT INTO employee_lifecycle_events (organization_id, user_id, event_type, status, notes, created_by)
         VALUES ($1, $2, 'Onboarding', 'Completed', 'Employee account created from HR workspace.', $3)`,
        [auth.session.user.organizationId, result.rows[0].id, auth.session.user.id],
      );
      return result.rows[0];
    });
    return NextResponse.json({ employee }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Name, email, password, and role are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'That email address is already in use.' }, { status: 409 });
    console.error('Employee create failed', error);
    return NextResponse.json({ error: 'Unable to create employee.' }, { status: 500 });
  }
}
