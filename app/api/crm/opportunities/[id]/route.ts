import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  clientId: z.string().uuid().nullable().optional(),
  stage: z.enum(['Discovery', 'Qualified', 'Quotation', 'Negotiation', 'Won', 'Lost']).optional(),
  value: z.number().nonnegative().max(100000000).optional(),
  expectedClose: z.string().date().nullable().optional(),
  notes: z.string().trim().max(500).optional(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = updateSchema.parse(await request.json());
    const result = await query(
      `UPDATE opportunities SET
        name = COALESCE($1, name), client_id = COALESCE($2, client_id), stage = COALESCE($3, stage),
        value = COALESCE($4, value), expected_close = COALESCE($5, expected_close), notes = COALESCE($6, notes), updated_at = now()
       WHERE id = $7 AND organization_id = $8
       RETURNING id, name, client_id, lead_id, stage, value, expected_close, notes, updated_at`,
      [body.name ?? null, body.clientId ?? null, body.stage ?? null, body.value ?? null, body.expectedClose ?? null, body.notes ?? null, params.id, session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Opportunity not found.' }, { status: 404 });
    return NextResponse.json({ opportunity: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid opportunity update.' }, { status: 400 });
    console.error('Opportunity update failed', error);
    return NextResponse.json({ error: 'Unable to update opportunity.' }, { status: 500 });
  }
}
