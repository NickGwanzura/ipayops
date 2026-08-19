import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession, hashPassword, verifyPassword } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { query } from '@/lib/db';

const passwordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
}).refine(value => value.currentPassword !== value.newPassword, {
  message: 'Choose a different new password.',
  path: ['newPassword'],
});

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });

    const body = passwordSchema.parse(await request.json());
    const result = await query<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true', [session.user.id, session.user.organizationId]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(body.currentPassword, user.password_hash))) return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 400 });

    const passwordHash = await hashPassword(body.newPassword);
    await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 AND organization_id = $3', [passwordHash, session.user.id, session.user.organizationId]);
    await query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [session.user.id, session.sessionId]);
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'auth.password_changed', entityType: 'user', entityId: session.user.id, request });

    return NextResponse.json({ ok: true, message: 'Password updated. Other sessions were signed out.' });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message || 'Enter valid password details.' }, { status: 400 });
    console.error('Password update failed', error);
    return NextResponse.json({ error: 'Unable to update password.' }, { status: 500 });
  }
}
