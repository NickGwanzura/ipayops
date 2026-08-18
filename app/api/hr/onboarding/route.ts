import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const taskSchema = z.object({ userId: z.string().uuid(), title: z.string().trim().min(2).max(160), category: z.string().trim().min(2).max(80).default('General'), dueAt: z.string().date().optional() });

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(`SELECT t.id, t.user_id, u.full_name AS user_name, t.title, t.category, t.due_at, t.status, t.completed_at FROM onboarding_tasks t JOIN users u ON u.id = t.user_id WHERE t.organization_id = $1 ORDER BY t.status, t.due_at NULLS LAST, t.created_at DESC`, [session.user.organizationId]);
  return NextResponse.json({ tasks: result.rows });
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = taskSchema.parse(await request.json());
    const user = await query('SELECT id FROM users WHERE id = $1 AND organization_id = $2', [body.userId, session.user.organizationId]);
    if (!user.rows[0]) return NextResponse.json({ error: 'Employee not found.' }, { status: 404 });
    const result = await query(`INSERT INTO onboarding_tasks (organization_id, user_id, title, category, due_at, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, user_id, title, category, due_at, status`, [session.user.organizationId, body.userId, body.title, body.category, body.dueAt || null, session.user.id]);
    return NextResponse.json({ task: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Employee, task title, and valid details are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'That onboarding task already exists for this employee.' }, { status: 409 });
    console.error('Onboarding task create failed', error);
    return NextResponse.json({ error: 'Unable to create onboarding task.' }, { status: 500 });
  }
}
