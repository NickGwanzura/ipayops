import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  clientType: z.enum(['Person', 'Organisation']).optional(),
  contactName: z.string().trim().max(160).optional(),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  phone: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300).optional(),
  status: z.enum(['Active', 'Inactive']).optional(),
});

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const result = await query(
      `UPDATE clients SET name = COALESCE($1, name), client_type = COALESCE($2, client_type), contact_name = COALESCE($3, contact_name),
        email = COALESCE(NULLIF($4, ''), email), phone = COALESCE($5, phone), address = COALESCE($6, address), status = COALESCE($7, status), updated_at = now()
       WHERE id = $8 AND organization_id = $9
       RETURNING id, code, name, client_type, contact_name, email, phone, address, status, updated_at`,
      [body.name ?? null, body.clientType ?? null, body.contactName ?? null, body.email ?? null, body.phone ?? null, body.address ?? null, body.status ?? null, params.id, auth.session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    return NextResponse.json({ client: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid client update.' }, { status: 400 });
    console.error('Client update failed', error);
    return NextResponse.json({ error: 'Unable to update client.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE clients SET status = 'Inactive', updated_at = now() WHERE id = $1 AND organization_id = $2 RETURNING id, status`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
  return NextResponse.json({ client: result.rows[0], archived: true });
}
