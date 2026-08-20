import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { emailConfigured } from '@/lib/email';
import { sendNotification } from '@/lib/notifications';
import { writeAuditLog } from '@/lib/audit';

const schema = z.object({ email: z.string().trim().email().optional() });

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  if (!emailConfigured()) return NextResponse.json({ error: 'Email is not configured. Set RESEND_API_KEY, EMAIL_FROM, and APP_URL first.' }, { status: 503 });
  try {
    const body = schema.parse(await request.json().catch(() => ({})));
    const recipientEmail = body.email || auth.session.user.email;
    const result = await sendNotification({
      organizationId: auth.session.user.organizationId,
      eventType: 'notification.test',
      recipientEmail,
      recipientName: auth.session.user.fullName,
      subject: 'iPayTech notification test',
      eyebrow: 'Notification test',
      title: 'Your branded notifications are connected',
      summary: 'This test confirms that iPayTech can deliver branded operational email notifications for actions and events.',
      fields: [{ label: 'Recipient', value: recipientEmail }, { label: 'Triggered by', value: auth.session.user.fullName }, { label: 'Event', value: 'notification.test' }],
      action: { label: 'Open iPayTech Operations', url: process.env.APP_URL || 'https://ipaytechops.com' },
    });
    if (result.status !== 'sent') return NextResponse.json({ error: result.errorMessage || 'Email delivery failed.', status: result.status }, { status: 502 });
    await writeAuditLog({ organizationId: auth.session.user.organizationId, actorUserId: auth.session.user.id, action: 'notification.test_sent', entityType: 'notification', entityId: recipientEmail, metadata: { eventType: 'notification.test' }, request });
    return NextResponse.json({ ok: true, recipientEmail, providerId: result.providerId });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid recipient email address.' }, { status: 400 });
    console.error('Notification test failed', error);
    return NextResponse.json({ error: 'Unable to send notification test.' }, { status: 500 });
  }
}
