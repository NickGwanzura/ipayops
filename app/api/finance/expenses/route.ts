import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const expenseSchema = z.object({
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(240),
  amount: z.number().positive().max(100000000),
});

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const status = request.nextUrl.searchParams.get('status');
  const result = await query(
    `SELECT e.id, e.number, e.category, e.description, e.amount, e.currency, e.status, e.submitted_at,
            e.approved_at, e.paid_at, u.full_name AS submitter_name, a.full_name AS approver_name,
            COUNT(att.id)::int AS attachment_count
     FROM expense_claims e
     JOIN users u ON u.id = e.submitter_id
     LEFT JOIN users a ON a.id = e.approved_by
     LEFT JOIN attachments att ON att.entity_id = e.id AND att.entity_type = 'expense'
     WHERE e.organization_id = $1 AND ($2::text IS NULL OR e.status = $2)
     GROUP BY e.id, u.full_name, a.full_name
     ORDER BY e.created_at DESC LIMIT 200`,
    [session.user.organizationId, status || null],
  );
  return NextResponse.json({ expenses: result.rows });
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = expenseSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO expense_claims (organization_id, number, submitter_id, category, description, amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, number, category, description, amount, currency, status, submitted_at`,
      [session.user.organizationId, `EXP-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`, session.user.id, body.category, body.description, body.amount],
    );
    return NextResponse.json({ expense: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Category, description, and a positive amount are required.' }, { status: 400 });
    console.error('Expense create failed', error);
    return NextResponse.json({ error: 'Unable to submit expense.' }, { status: 500 });
  }
}
