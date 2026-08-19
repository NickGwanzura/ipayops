import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const locationSchema = z.object({ code: z.string().trim().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/), name: z.string().trim().min(2).max(120), address: z.string().trim().max(240).optional().default('') });

export async function POST(request: Request) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const body = locationSchema.parse(await request.json());
    const result = await query('INSERT INTO organization_locations (organization_id, code, name, address, created_by) VALUES ($1, upper($2), $3, $4, $5) RETURNING id, code, name, address, is_active, created_at', [session.user.organizationId, body.code, body.name, body.address, session.user.id]);
    return NextResponse.json({ location: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Location code, name, and valid details are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'A location with that code or name already exists.' }, { status: 409 });
    console.error('Location create failed', error);
    return NextResponse.json({ error: 'Unable to create location.' }, { status: 500 });
  }
}
