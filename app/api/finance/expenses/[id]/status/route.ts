import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { sendNotification } from '@/lib/notifications';
import { writeAuditLog } from '@/lib/audit';

const statusSchema = z.object({ status: z.enum(['Approved', 'Rejected', 'Paid']) });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.finance);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = statusSchema.parse(await request.json());
    const owner = await query(`SELECT e.number, e.amount, u.email, u.full_name FROM expense_claims e JOIN users u ON u.id = e.submitter_id WHERE e.id = $1 AND e.organization_id = $2`, [params.id, session.user.organizationId]);
    if (!owner.rows[0]) return NextResponse.json({ error: 'Expense not found.' }, { status: 404 });
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
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: `expense.${body.status.toLowerCase()}`, entityType: 'expense', entityId: result.rows[0].id, metadata: { number: result.rows[0].number, amount: result.rows[0].amount }, request });
    void sendNotification({ organizationId: session.user.organizationId, eventType: 'expense.status_changed', recipientEmail: owner.rows[0].email, recipientName: owner.rows[0].full_name, subject: `Expense ${owner.rows[0].number} ${body.status.toLowerCase()}`, eyebrow: 'Finance activity', title: `Expense ${body.status.toLowerCase()}`, summary: `Your expense claim ${owner.rows[0].number} has been marked ${body.status.toLowerCase()}.`, fields: [{ label: 'Expense', value: owner.rows[0].number }, { label: 'Amount', value: String(owner.rows[0].amount) }, { label: 'Status', value: body.status }] });
    return NextResponse.json({ expense: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A valid expense status is required.' }, { status: 400 });
    console.error('Expense status update failed', error);
    return NextResponse.json({ error: 'Unable to update expense.' }, { status: 500 });
  }
}
