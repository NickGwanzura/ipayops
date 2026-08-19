import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  contactName: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(60).optional(),
  paymentTerms: z.string().trim().max(80).optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  status: z.enum(['Active', 'Inactive', 'Blocked']).optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const result = await query(
      `UPDATE suppliers SET name = COALESCE($1, name), contact_name = COALESCE($2, contact_name), phone = COALESCE($3, phone),
        payment_terms = COALESCE($4, payment_terms), lead_time_days = COALESCE($5, lead_time_days), status = COALESCE($6, status), updated_at = now()
       WHERE id = $7 AND organization_id = $8
       RETURNING id, code, name, contact_name, phone, payment_terms, lead_time_days, status, updated_at`,
      [body.name ?? null, body.contactName ?? null, body.phone ?? null, body.paymentTerms ?? null, body.leadTimeDays ?? null, body.status ?? null, params.id, auth.session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 });
    return NextResponse.json({ supplier: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid supplier update.' }, { status: 400 });
    console.error('Supplier update failed', error);
    return NextResponse.json({ error: 'Unable to update supplier.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE suppliers SET status = 'Inactive', updated_at = now() WHERE id = $1 AND organization_id = $2 RETURNING id, status`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Supplier not found.' }, { status: 404 });
  return NextResponse.json({ supplier: result.rows[0], archived: true });
}
