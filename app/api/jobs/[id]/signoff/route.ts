import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const signoffSchema = z.object({ name: z.string().trim().min(2).max(160), notes: z.string().trim().max(500).optional().default('') });

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.jobWrite);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = signoffSchema.parse(await request.json());
    const result = await query(
      `UPDATE job_cards SET status = 'Completed', signoff_name = $1, signoff_notes = $2, signed_at = now(), updated_at = now()
       WHERE id = $3 AND organization_id = $4 RETURNING id, number, status, signoff_name, signoff_notes, signed_at`,
      [body.name, body.notes, params.id, session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Job card not found.' }, { status: 404 });
    return NextResponse.json({ job: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Client sign-off name is required.' }, { status: 400 });
    console.error('Job signoff failed', error);
    return NextResponse.json({ error: 'Unable to complete job sign-off.' }, { status: 500 });
  }
}
