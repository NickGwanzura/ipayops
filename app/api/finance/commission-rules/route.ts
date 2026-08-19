import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const ruleSchema = z.object({ name: z.string().trim().min(2).max(120), rate: z.number().min(0).max(100), triggerStatus: z.enum(['Confirmed', 'Delivered', 'Paid']).default('Confirmed') });

export async function GET(request: Request) {
  const auth = await requireRole(request, ACCESS.finance);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query('SELECT id, name, rate, trigger_status, is_active, created_at FROM commission_rules WHERE organization_id = $1 ORDER BY is_active DESC, created_at DESC', [session.user.organizationId]);
  return NextResponse.json({ rules: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.finance);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = ruleSchema.parse(await request.json());
    const result = await query('INSERT INTO commission_rules (organization_id, name, rate, trigger_status, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, rate, trigger_status, is_active', [session.user.organizationId, body.name, body.rate, body.triggerStatus, session.user.id]);
    return NextResponse.json({ rule: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Rule name, rate, and trigger are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A rule with that name already exists.' }, { status: 409 });
    console.error('Commission rule create failed', error);
    return NextResponse.json({ error: 'Unable to create commission rule.' }, { status: 500 });
  }
}
