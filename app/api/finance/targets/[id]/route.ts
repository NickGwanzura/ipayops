import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({ consultantId: z.string().uuid().optional(), periodStart: z.string().date().optional(), periodEnd: z.string().date().optional(), targetAmount: z.number().nonnegative().max(100000000).optional() });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.financeSettings);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    if (body.consultantId) { const consultant = await query(`SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true`, [body.consultantId, auth.session.user.organizationId]); if (!consultant.rows[0]) return NextResponse.json({ error: 'Consultant not found.' }, { status: 404 }); }
    const result = await query(`UPDATE consultant_targets SET consultant_id = COALESCE($1, consultant_id), period_start = COALESCE($2, period_start), period_end = COALESCE($3, period_end), target_amount = COALESCE($4, target_amount) WHERE id = $5 AND organization_id = $6 RETURNING id, consultant_id, period_start, period_end, target_amount`, [body.consultantId ?? null, body.periodStart ?? null, body.periodEnd ?? null, body.targetAmount ?? null, params.id, auth.session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Consultant target not found.' }, { status: 404 });
    return NextResponse.json({ target: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid consultant target update.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A target already exists for this consultant and period.' }, { status: 409 });
    console.error('Consultant target update failed', error);
    return NextResponse.json({ error: 'Unable to update consultant target.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.financeSettings);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE consultant_targets SET is_active = false WHERE id = $1 AND organization_id = $2 RETURNING id, is_active`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Consultant target not found.' }, { status: 404 });
  return NextResponse.json({ target: result.rows[0], archived: true });
}
