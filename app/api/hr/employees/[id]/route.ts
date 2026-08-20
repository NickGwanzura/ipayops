import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, canManageEmployee, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const updateSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  role: z.enum(['ceo', 'manager', 'finance', 'sales_consultant']).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.hr);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const existing = await query<{ role: string }>('SELECT role FROM users WHERE id = $1 AND organization_id = $2', [params.id, auth.session.user.organizationId]);
    if (!existing.rows[0]) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    if (body.isActive === false && !canManageEmployee(auth.session, existing.rows[0].role, undefined, params.id)) return NextResponse.json({ error: 'You cannot deactivate this account.' }, { status: 403 });
    if (body.role && !canManageEmployee(auth.session, existing.rows[0].role, body.role, params.id)) return NextResponse.json({ error: 'Managers cannot create or assign CEO accounts.' }, { status: 403 });
    const result = await query(
      `UPDATE users SET full_name = COALESCE($1, full_name), email = COALESCE($2, email), role = COALESCE($3, role), is_active = COALESCE($4, is_active), updated_at = now()
       WHERE id = $5 AND organization_id = $6
       RETURNING id, full_name, email, role, is_active, updated_at`,
      [body.fullName ?? null, body.email ?? null, body.role ?? null, body.isActive ?? null, params.id, auth.session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    if (body.isActive === false) await query(`INSERT INTO employee_lifecycle_events (organization_id, user_id, event_type, status, notes, created_by) VALUES ($1, $2, 'Offboarding', 'Completed', 'Employee archived from HR workspace.', $3)`, [auth.session.user.organizationId, params.id, auth.session.user.id]);
    if (body.isActive === true) await query(`INSERT INTO employee_lifecycle_events (organization_id, user_id, event_type, status, notes, created_by) VALUES ($1, $2, 'Reactivated', 'Completed', 'Employee reactivated from HR workspace.', $3)`, [auth.session.user.organizationId, params.id, auth.session.user.id]);
    return NextResponse.json({ employee: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid employee update.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'That email address is already in use.' }, { status: 409 });
    console.error('Employee update failed', error);
    return NextResponse.json({ error: 'Unable to update employee.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.hr);
  if ('response' in auth) return auth.response;
  try {
    const existing = await query<{ role: string }>('SELECT role FROM users WHERE id = $1 AND organization_id = $2', [params.id, auth.session.user.organizationId]);
    if (!existing.rows[0]) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    if (!canManageEmployee(auth.session, existing.rows[0].role, undefined, params.id)) return NextResponse.json({ error: 'You cannot archive this account.' }, { status: 403 });
    const employee = await withTransaction(async client => {
      const result = await client.query(`UPDATE users SET is_active = false, updated_at = now() WHERE id = $1 AND organization_id = $2 RETURNING id, full_name, email, role, is_active`, [params.id, auth.session.user.organizationId]);
      if (!result.rows[0]) throw Object.assign(new Error('Employee not found.'), { code: 'NOT_FOUND' });
      await client.query(`INSERT INTO employee_lifecycle_events (organization_id, user_id, event_type, status, notes, created_by) VALUES ($1, $2, 'Offboarding', 'Completed', 'Employee archived from HR workspace.', $3)`, [auth.session.user.organizationId, params.id, auth.session.user.id]);
      return result.rows[0];
    });
    return NextResponse.json({ employee, archived: true });
  } catch (error) {
    if ((error as { code?: string }).code === 'NOT_FOUND') return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    console.error('Employee archive failed', error);
    return NextResponse.json({ error: 'Unable to archive employee.' }, { status: 500 });
  }
}
