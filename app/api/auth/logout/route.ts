import { NextResponse } from 'next/server';
import { clearSessionCookie, deleteSession, getSession } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { sendNotification } from '@/lib/notifications';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    await deleteSession(request);
    if (session) await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'auth.logout', entityType: 'session', entityId: session.sessionId, request });
    if (session) await sendNotification({ organizationId: session.user.organizationId, eventType: 'auth.logout', recipientEmail: session.user.email, recipientName: session.user.fullName, subject: 'iPayTech sign-out recorded', eyebrow: 'Security activity', title: 'Your account was signed out', summary: 'A sign-out event was recorded for your iPayTech Operations account.', fields: [{ label: 'Account', value: session.user.email }, { label: 'Time', value: new Date().toLocaleString('en-GB') }] });
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    console.error('Logout failed', error);
    return NextResponse.json({ error: 'Authentication service is unavailable.' }, { status: 503 });
  }
}
