import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, publicUser } from '@/lib/auth';
import { query } from '@/lib/db';

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
});

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });

    const result = await query<{
      id: string;
      organization_id: string;
      email: string;
      full_name: string;
      role: string;
    }>('SELECT id, organization_id, email, full_name, role FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true', [session.user.id, session.user.organizationId]);

    if (!result.rows[0]) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    return NextResponse.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    console.error('Profile lookup failed', error);
    return NextResponse.json({ error: 'Unable to load profile.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });

    const body = profileSchema.parse(await request.json());
    const duplicate = await query('SELECT id FROM users WHERE lower(email) = lower($1) AND id <> $2', [body.email, session.user.id]);
    if (duplicate.rows[0]) return NextResponse.json({ error: 'That email address is already in use.' }, { status: 409 });

    const result = await query<{
      id: string;
      organization_id: string;
      email: string;
      full_name: string;
      role: string;
    }>('UPDATE users SET full_name = $1, email = lower($2), updated_at = now() WHERE id = $3 AND organization_id = $4 AND is_active = true RETURNING id, organization_id, email, full_name, role', [body.fullName, body.email, session.user.id, session.user.organizationId]);

    if (!result.rows[0]) return NextResponse.json({ error: 'Profile not found.' }, { status: 404 });
    return NextResponse.json({ user: publicUser(result.rows[0]) });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid name and email address.' }, { status: 400 });
    console.error('Profile update failed', error);
    return NextResponse.json({ error: 'Unable to update profile.' }, { status: 500 });
  }
}
