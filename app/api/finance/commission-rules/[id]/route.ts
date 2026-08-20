import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({ name: z.string().trim().min(2).max(120).optional(), rate: z.number().min(0).max(100).optional(), triggerStatus: z.enum(['Confirmed', 'Delivered', 'Paid']).optional(), isActive: z.boolean().optional() });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.financeSettings);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const result = await query(`UPDATE commission_rules SET name = COALESCE($1, name), rate = COALESCE($2, rate), trigger_status = COALESCE($3, trigger_status), is_active = COALESCE($4, is_active) WHERE id = $5 AND organization_id = $6 RETURNING id, name, rate, trigger_status, is_active`, [body.name ?? null, body.rate ?? null, body.triggerStatus ?? null, body.isActive ?? null, params.id, auth.session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Commission rule not found.' }, { status: 404 });
    return NextResponse.json({ rule: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid commission rule update.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A rule with that name already exists.' }, { status: 409 });
    console.error('Commission rule update failed', error);
    return NextResponse.json({ error: 'Unable to update commission rule.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.financeSettings);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE commission_rules SET is_active = false WHERE id = $1 AND organization_id = $2 RETURNING id, is_active`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Commission rule not found.' }, { status: 404 });
  return NextResponse.json({ rule: result.rows[0], archived: true });
}
