import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  clientId: z.string().uuid().nullable().optional(),
  source: z.string().trim().max(100).optional(),
  status: z.enum(['New', 'Qualified', 'Converted', 'Lost']).optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = updateSchema.parse(await request.json());
    const result = await query(
      `UPDATE leads SET
        name = COALESCE($1, name), client_id = COALESCE($2, client_id), source = COALESCE($3, source),
        status = COALESCE($4, status), notes = COALESCE($5, notes), updated_at = now()
       WHERE id = $6 AND organization_id = $7
       RETURNING id, name, client_id, source, status, notes, updated_at`,
      [body.name ?? null, body.clientId ?? null, body.source ?? null, body.status ?? null, body.notes ?? null, params.id, session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    return NextResponse.json({ lead: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid lead update.' }, { status: 400 });
    console.error('Lead update failed', error);
    return NextResponse.json({ error: 'Unable to update lead.' }, { status: 500 });
  }
}
