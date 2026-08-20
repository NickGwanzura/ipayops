import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const statusSchema = z.object({ status: z.enum(['Completed', 'Skipped', 'Pending']) });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.hr);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = statusSchema.parse(await request.json());
    const result = await query(`UPDATE onboarding_tasks SET status = $1, completed_by = CASE WHEN $1 = 'Completed' THEN $2 ELSE completed_by END, completed_at = CASE WHEN $1 = 'Completed' THEN now() ELSE NULL END WHERE id = $3 AND organization_id = $4 RETURNING id, user_id, title, status, completed_at`, [body.status, session.user.id, params.id, session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Onboarding task not found.' }, { status: 404 });
    return NextResponse.json({ task: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Valid task status is required.' }, { status: 400 });
    console.error('Onboarding task update failed', error);
    return NextResponse.json({ error: 'Unable to update onboarding task.' }, { status: 500 });
  }
}
