import { query } from '@/lib/db';
import { emailConfigured, sendBrandedEmail, type EmailField } from '@/lib/email';

export type NotificationEvent =
  | 'notification.test'
  | 'auth.login'
  | 'auth.logout'
  | 'invoice.issued'
  | 'invoice.payment_received'
  | 'invoice.overdue'
  | 'quotation.created'
  | 'quotation.converted'
  | 'shipment.status_changed'
  | 'job.assigned'
  | 'job.completed'
  | 'warranty.claim_opened'
  | 'warranty.claim_resolved'
  | 'expense.submitted'
  | 'expense.status_changed'
  | 'employee.onboarding'
  | 'employee.offboarded';

export async function sendNotification(input: { organizationId: string; eventType: NotificationEvent; recipientEmail: string; recipientName?: string; subject: string; eyebrow: string; title: string; summary: string; fields?: EmailField[]; action?: { label: string; url: string } }) {
  if (!emailConfigured()) return { status: 'not_configured' as const, providerId: null, errorMessage: null };
  let status: 'sent' | 'failed' | 'not_configured' = 'not_configured';
  let providerId: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await sendBrandedEmail({ ...input, to: input.recipientEmail });
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
