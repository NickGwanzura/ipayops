import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const locationSchema = z.object({ name: z.string().trim().min(2).max(120), address: z.string().trim().max(240).optional().default(''), isActive: z.boolean() });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const body = locationSchema.parse(await request.json());
    const result = await query('UPDATE organization_locations SET name = $1, address = $2, is_active = $3, updated_at = now() WHERE id = $4 AND organization_id = $5 RETURNING id, code, name, address, is_active, created_at', [body.name, body.address, body.isActive, params.id, session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Location not found.' }, { status: 404 });
    return NextResponse.json({ location: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Location name, address, and active status are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A location with that name already exists.' }, { status: 409 });
    console.error('Location update failed', error);
    return NextResponse.json({ error: 'Unable to update location.' }, { status: 500 });
  }
}
