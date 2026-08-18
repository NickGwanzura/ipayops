import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const targetSchema = z.object({ consultantId: z.string().uuid(), periodStart: z.string().date(), periodEnd: z.string().date(), targetAmount: z.number().nonnegative().max(100000000) });

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(
    `SELECT t.id, t.consultant_id, u.full_name AS consultant_name, t.period_start, t.period_end, t.target_amount,
            COALESCE((SELECT SUM(s.total) FROM sales s WHERE s.organization_id = t.organization_id AND s.consultant_id = t.consultant_id AND s.confirmed_at::date BETWEEN t.period_start AND t.period_end), 0) AS achieved
     FROM consultant_targets t JOIN users u ON u.id = t.consultant_id
     WHERE t.organization_id = $1 ORDER BY t.period_start DESC, u.full_name`,
    [session.user.organizationId],
  );
  return NextResponse.json({ targets: result.rows });
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = targetSchema.parse(await request.json());
    const consultant = await query('SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true', [body.consultantId, session.user.organizationId]);
    if (!consultant.rows[0]) return NextResponse.json({ error: 'Consultant not found.' }, { status: 404 });
    const result = await query('INSERT INTO consultant_targets (organization_id, consultant_id, period_start, period_end, target_amount, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, consultant_id, period_start, period_end, target_amount', [session.user.organizationId, body.consultantId, body.periodStart, body.periodEnd, body.targetAmount, session.user.id]);
    return NextResponse.json({ target: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Consultant, dates, and target amount are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A target already exists for this consultant and period.' }, { status: 409 });
    console.error('Consultant target create failed', error);
    return NextResponse.json({ error: 'Unable to create consultant target.' }, { status: 500 });
  }
}
