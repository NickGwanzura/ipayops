import { NextResponse } from 'next/server';
import { clearSessionCookie, deleteSession, getSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    await deleteSession(request);
    if (session) await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'auth.logout', entityType: 'session', entityId: session.sessionId, request });
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error('Logout failed', error);
    return NextResponse.json({ error: 'Authentication service is unavailable.' }, { status: 503 });
  }
}
