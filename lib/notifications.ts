import { query } from '@/lib/db';
import { emailConfigured, sendBrandedEmail, type EmailField } from '@/lib/email';

const EMAIL_MIN_INTERVAL_MS = 150;
let emailQueue: Promise<void> = Promise.resolve();

function wait(milliseconds: number) {
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

async function sendBrandedEmailWithRetry(input: Parameters<typeof sendBrandedEmail>[0]) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await sendBrandedEmail(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (attempt === 0 && /429|too many requests|rate limit/i.test(message)) {
        await wait(1200);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Email delivery retry failed.');
}

function enqueueEmail<T>(task: () => Promise<T>) {
  const next = emailQueue.then(async () => {
    await wait(EMAIL_MIN_INTERVAL_MS);
    return task();
  });
  emailQueue = next.then(() => undefined, () => undefined);
  return next;
}

export type NotificationEvent =
  | 'notification.test'
  | 'auth.login'
  | 'auth.logout'
  | 'invoice.issued'
  | 'invoice.payment_received'
  | 'invoice.overdue'
  | 'quotation.created'
  | 'quotation.converted'
  | 'return.refunded'
  | 'lead.created'
  | 'opportunity.created'
  | 'inventory.received'
  | 'shipment.status_changed'
  | 'job.assigned'
  | 'job.completed'
  | 'warranty.claim_opened'
  | 'warranty.claim_resolved'
  | 'expense.submitted'
  | 'expense.status_changed'
  | 'employee.onboarding'
  | 'employee.invited'
  | 'employee.offboarded'
  | 'purchase_order.submitted'
  | 'purchase_order.approved'
  | 'goods_receipt.posted'
  | 'commission.created'
  | 'commission.run'
  | 'repair_requisition.submitted'
  | 'expense.asset_linked';

export async function sendNotification(input: { organizationId: string; eventType: NotificationEvent; recipientEmail: string; recipientName?: string; subject: string; eyebrow: string; title: string; summary: string; fields?: EmailField[]; action?: { label: string; url: string } }) {
  if (!emailConfigured()) return { status: 'not_configured' as const, providerId: null, errorMessage: null };
  let status: 'sent' | 'failed' | 'not_configured' = 'not_configured';
  let providerId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await enqueueEmail(() => sendBrandedEmailWithRetry({ ...input, to: input.recipientEmail }));
    if (result.sent) { status = 'sent'; providerId = result.providerId; }
  } catch (error) {
    status = 'failed';
    errorMessage = error instanceof Error ? error.message : 'Unknown email delivery error.';
  }
  try {
    await query(`INSERT INTO notification_deliveries (organization_id, event_type, recipient_email, subject, status, provider_id, error_message) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [input.organizationId, input.eventType, input.recipientEmail, input.subject, status, providerId, errorMessage]);
  } catch (error) {
    console.error('Notification delivery log failed', error);
  }
  return { status, providerId, errorMessage };
}

export async function notifyOrganizationRoles(input: Omit<Parameters<typeof sendNotification>[0], 'recipientEmail' | 'recipientName'> & { roles: string[]; excludeUserId?: string }) {
  const recipients = await query<{ email: string; full_name: string }>(
    `SELECT email, full_name FROM users
     WHERE organization_id = $1 AND is_active = true AND role = ANY($2::text[])
       AND ($3::uuid IS NULL OR id <> $3)`,
    [input.organizationId, input.roles, input.excludeUserId || null],
  );
  return Promise.all(recipients.rows.map(recipient => sendNotification({ ...input, recipientEmail: recipient.email, recipientName: recipient.full_name })));
}
