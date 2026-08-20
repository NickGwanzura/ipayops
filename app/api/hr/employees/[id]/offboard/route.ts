import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, canManageEmployee, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const offboardSchema = z.object({ effectiveAt: z.string().datetime().optional(), notes: z.string().trim().max(500).optional().default('') });

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.hr);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = offboardSchema.parse(await request.json().catch(() => ({})));
    const employee = await withTransaction(async client => {
      const result = await client.query('SELECT id, full_name, is_active FROM users WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params.id, session.user.organizationId]);
      if (!result.rows[0]) throw Object.assign(new Error('Employee not found.'), { code: 'NOT_FOUND' });
      if (!result.rows[0].is_active) throw Object.assign(new Error('Employee already inactive.'), { code: 'INACTIVE' });
      if (!canManageEmployee(session, undefined, undefined, params.id)) throw Object.assign(new Error('Account cannot be offboarded.'), { code: 'FORBIDDEN' });
      await client.query(`UPDATE users SET is_active = false, updated_at = now() WHERE id = $1`, [params.id]);
      await client.query(`INSERT INTO employee_lifecycle_events (organization_id, user_id, event_type, status, effective_at, notes, created_by) VALUES ($1, $2, 'Offboarding', 'Completed', COALESCE($3::timestamptz, now()), $4, $5)`, [session.user.organizationId, params.id, body.effectiveAt || null, body.notes, session.user.id]);
      return result.rows[0];
    });
    return NextResponse.json({ employee: { id: employee.id, full_name: employee.full_name, is_active: false } });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    if (code === 'INACTIVE') return NextResponse.json({ error: 'Employee is already inactive.' }, { status: 409 });
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'You cannot offboard this account.' }, { status: 403 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid offboarding details.' }, { status: 400 });
    console.error('Employee offboarding failed', error);
    return NextResponse.json({ error: 'Unable to complete offboarding.' }, { status: 500 });
  }
}
