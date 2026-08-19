import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const resolveSchema = z.object({ status: z.enum(['Resolved', 'Rejected']), resolution: z.string().trim().min(3).max(500) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.field);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = resolveSchema.parse(await request.json());
    const result = await query(
      `UPDATE warranty_claims SET status = $1, resolution = $2, updated_at = now()
       WHERE id = $3 AND organization_id = $4 RETURNING id, number, status, resolution, updated_at`,
      [body.status, body.resolution, params.id, session.user.organizationId],
    );
    if (!result.rows[0]) return NextResponse.json({ error: 'Warranty claim not found.' }, { status: 404 });
    return NextResponse.json({ claim: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Resolution status and explanation are required.' }, { status: 400 });
    console.error('Warranty claim resolution failed', error);
    return NextResponse.json({ error: 'Unable to resolve warranty claim.' }, { status: 500 });
  }
}
