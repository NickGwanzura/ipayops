import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({
  title: z.string().trim().min(2).max(180).optional(),
  installerId: z.string().uuid().nullable().optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  status: z.enum(['Scheduled', 'In progress', 'Completed', 'Cancelled']).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.jobRead);
  if ('response' in auth) return auth.response;
  const ownershipClause = auth.session.user.role === 'sales_consultant' ? ' AND j.installer_id = $3' : '';
  const ownershipParams = auth.session.user.role === 'sales_consultant' ? [params.id, auth.session.user.organizationId, auth.session.user.id] : [params.id, auth.session.user.organizationId];
  const result = await query(`SELECT j.id, j.number, j.title, j.status, j.scheduled_for, j.notes, j.signoff_name, j.signoff_notes, j.signed_at, c.id AS client_id, c.name AS client_name, u.full_name AS installer_name, COALESCE(json_agg(json_build_object('id', jci.inventory_item_id, 'serialNumber', jci.serial_number, 'checklist', jci.checklist) ORDER BY jci.serial_number) FILTER (WHERE jci.id IS NOT NULL), '[]'::json) AS items FROM job_cards j JOIN clients c ON c.id = j.client_id LEFT JOIN users u ON u.id = j.installer_id LEFT JOIN job_card_items jci ON jci.job_card_id = j.id WHERE j.id = $1 AND j.organization_id = $2${ownershipClause} GROUP BY j.id, c.id, u.id`, ownershipParams);
  if (!result.rows[0]) return NextResponse.json({ error: 'Job card not found.' }, { status: 404 });
  return NextResponse.json({ job: result.rows[0] });
}

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.jobWrite);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    if (body.installerId) { const installer = await query(`SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true AND role IN ('sales_consultant', 'manager', 'ceo')`, [body.installerId, auth.session.user.organizationId]); if (!installer.rows[0]) return NextResponse.json({ error: 'Sales consultant is not an active member of this organization.' }, { status: 400 }); }
    const result = await query(`UPDATE job_cards SET title = COALESCE($1, title), installer_id = COALESCE($2, installer_id), scheduled_for = COALESCE($3, scheduled_for), status = COALESCE($4, status), notes = COALESCE($5, notes), updated_at = now() WHERE id = $6 AND organization_id = $7 RETURNING id, number, title, status, installer_id, scheduled_for, notes, updated_at`, [body.title ?? null, body.installerId ?? null, body.scheduledFor ?? null, body.status ?? null, body.notes ?? null, params.id, auth.session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Job card not found.' }, { status: 404 });
    return NextResponse.json({ job: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid job-card update.' }, { status: 400 });
    console.error('Job update failed', error);
    return NextResponse.json({ error: 'Unable to update job card.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.jobWrite);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE job_cards SET status = 'Cancelled', updated_at = now() WHERE id = $1 AND organization_id = $2 AND status <> 'Completed' RETURNING id, status`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Job card not found or already completed.' }, { status: 404 });
  return NextResponse.json({ job: result.rows[0], archived: true });
}
