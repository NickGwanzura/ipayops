import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const statusSchema = z.object({ status: z.enum(['Approved', 'Rejected', 'Paid']) });

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = statusSchema.parse(await request.json());
    const result = await query(
      `UPDATE expense_claims
       SET status = $1,
           approved_by = CASE WHEN $1 IN ('Approved', 'Rejected') THEN $2 ELSE approved_by END,
           approved_at = CASE WHEN $1 IN ('Approved', 'Rejected') THEN now() ELSE approved_at END,
           paid_at = CASE WHEN $1 = 'Paid' THEN now() ELSE paid_at END,
           updated_at = now()
       WHERE id = $3 AND organization_id = $4
         AND (($1 = 'Approved' AND status = 'Pending') OR ($1 = 'Rejected' AND status = 'Pending') OR ($1 = 'Paid' AND status = 'Approved'))
       RETURNING id, number, status, amount, approved_at, paid_at`,
      [body.status, session.user.id, params.id, session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Expense not found or transition is not allowed.' }, { status: 409 });
    return NextResponse.json({ expense: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A valid expense status is required.' }, { status: 400 });
    console.error('Expense status update failed', error);
    return NextResponse.json({ error: 'Unable to update expense.' }, { status: 500 });
  }
}
