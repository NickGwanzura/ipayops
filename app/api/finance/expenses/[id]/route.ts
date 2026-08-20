import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({ category: z.string().trim().min(2).max(80).optional(), description: z.string().trim().min(2).max(240).optional() });

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.finance);
  if ('response' in auth) return auth.response;
  const result = await query(`SELECT e.id, e.number, e.category, e.description, e.amount, e.currency, e.status, e.submitted_at, e.approved_at, e.paid_at, e.inventory_item_id, e.replacement_item_id, e.repair_requisition_id, e.serial_number_snapshot, ii.serial_number, ii.sku, ii.product_type, u.full_name AS submitter_name, a.full_name AS approver_name, COALESCE((SELECT json_agg(json_build_object('id', att.id, 'fileName', att.file_name, 'mimeType', att.mime_type, 'sizeBytes', att.size_bytes, 'createdAt', att.created_at) ORDER BY att.created_at DESC) FROM attachments att WHERE att.entity_id = e.id AND att.entity_type = 'expense'), '[]'::json) AS attachments FROM expense_claims e JOIN users u ON u.id = e.submitter_id LEFT JOIN users a ON a.id = e.approved_by LEFT JOIN inventory_items ii ON ii.id = e.inventory_item_id WHERE e.id = $1 AND e.organization_id = $2 GROUP BY e.id, u.full_name, a.full_name, ii.serial_number, ii.sku, ii.product_type`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Expense not found.' }, { status: 404 });
  return NextResponse.json({ expense: result.rows[0] });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.finance);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const result = await query(`UPDATE expense_claims SET category = COALESCE($1, category), description = COALESCE($2, description), updated_at = now() WHERE id = $3 AND organization_id = $4 AND status = 'Pending' RETURNING id, number, category, description, status, updated_at`, [body.category ?? null, body.description ?? null, params.id, auth.session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Expense not found or no longer editable.' }, { status: 409 });
    return NextResponse.json({ expense: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid expense update.' }, { status: 400 });
    console.error('Expense update failed', error);
    return NextResponse.json({ error: 'Unable to update expense.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.finance);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE expense_claims SET status = 'Rejected', updated_at = now() WHERE id = $1 AND organization_id = $2 AND status = 'Pending' RETURNING id, number, status`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Expense not found or no longer pending.' }, { status: 409 });
  return NextResponse.json({ expense: result.rows[0], archived: true });
}
