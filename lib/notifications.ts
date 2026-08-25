import { query, withTransaction } from '@/lib/db';
import { emailConfigured, sendBrandedEmail, type EmailField } from '@/lib/email';
import { getRequestId } from '@/lib/db-request-context';
import { errorClass, reportError } from '@/lib/observability';

const NOTIFICATION_EVENTS = [
  'notification.test', 'auth.login', 'auth.logout', 'auth.password_reset_requested', 'invoice.issued', 'invoice.payment_received',
  'invoice.overdue', 'quotation.created', 'quotation.converted', 'return.refunded', 'lead.created',
  'opportunity.created', 'inventory.received', 'shipment.status_changed', 'job.assigned', 'job.completed',
  'warranty.claim_opened', 'warranty.claim_resolved', 'expense.submitted', 'expense.status_changed',
  'employee.onboarding', 'employee.invited', 'employee.offboarded', 'purchase_order.submitted',
  'purchase_order.approved', 'goods_receipt.posted', 'commission.created', 'commission.run',
  'repair_requisition.submitted', 'expense.asset_linked',
] as const;

const NOTIFICATION_MAX_ATTEMPTS = 5;
const NOTIFICATION_STALE_MINUTES = 10;

export type NotificationEvent = typeof NOTIFICATION_EVENTS[number];
export type NotificationInput = {
  organizationId: string;
  eventType: NotificationEvent;
  recipientEmail: string;
  recipientName?: string;
  subject: string;
  eyebrow: string;
  title: string;
  summary: string;
  fields?: EmailField[];
  action?: { label: string; url: string };
};

type NotificationStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'not_configured';
type NotificationResult = {
  status: NotificationStatus;
  providerId: string | null;
  errorMessage: string | null;
};
type NotificationPayload = Omit<NotificationInput, 'organizationId' | 'eventType'>;
type NotificationDeliveryRow = {
  id: string;
  payload: unknown;
  attempts: number;
  max_attempts: number;
};

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

function safeError(error: unknown) {
  try {
    const message = error instanceof Error ? error.message : 'Notification delivery failed.';
    return message.replace(/\s+/g, ' ').slice(0, 1000);
  } catch {
    return 'Notification delivery failed.';
  }
}

function failedNotification(error: unknown): NotificationResult {
  return { status: 'failed', providerId: null, errorMessage: safeError(error) };
}

function reportNotificationFailure(source: string, error: unknown) {
  try {
    const requestId = getRequestId();
    console.error(source, { errorClass: errorClass(error), requestId: requestId || 'unavailable' });
    void reportError(error, { requestId, source, runtime: 'nodejs' }).catch(() => undefined);
  } catch {
    // Notification failure reporting is best effort and must not escape the caller.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown, maximum: number) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function validatePayload(value: unknown): NotificationPayload {
  if (!isRecord(value) || !isString(value.recipientEmail, 320) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.recipientEmail as string)) {
    throw new Error('Notification payload has an invalid recipient.');
  }
  if (value.recipientName !== undefined && value.recipientName !== null && !isString(value.recipientName, 240)) throw new Error('Notification payload has an invalid recipient name.');
  for (const field of ['subject', 'eyebrow', 'title', 'summary']) {
    if (!isString(value[field], field === 'summary' ? 10000 : 1000)) throw new Error(`Notification payload has an invalid ${field}.`);
  }
  if (value.fields !== undefined) {
    if (!Array.isArray(value.fields) || value.fields.length > 50 || value.fields.some(field => !isRecord(field) || !isString(field.label, 200) || !isString(field.value, 2000))) throw new Error('Notification payload has invalid fields.');
  }
  if (value.action !== undefined && value.action !== null) {
    if (!isRecord(value.action) || !isString(value.action.label, 200) || !isString(value.action.url, 2048) || !/^https?:\/\//i.test(value.action.url as string)) throw new Error('Notification payload has an invalid action.');
  }
  return {
    recipientEmail: value.recipientEmail as string,
    recipientName: value.recipientName === null ? undefined : value.recipientName as string | undefined,
    subject: value.subject as string,
    eyebrow: value.eyebrow as string,
    title: value.title as string,
    summary: value.summary as string,
    fields: value.fields as EmailField[] | undefined,
    action: value.action === null ? undefined : value.action as { label: string; url: string } | undefined,
  };
}

function isRetryableProviderError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  return !/\b(?:400|401|403|404|422)\b/.test(message);
}

async function claimNotification(id?: string) {
  return withTransaction(async client => {
    const result = await client.query<NotificationDeliveryRow>(
      `SELECT id, payload, attempts, max_attempts
       FROM notification_deliveries
       WHERE status = 'pending' AND available_at <= now()
         AND ($1::uuid IS NULL OR id = $1)
       ORDER BY available_at ASC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`,
      [id || null],
    );
    if (!result.rows[0]) return null;
    const claimed = await client.query<NotificationDeliveryRow>(
      `UPDATE notification_deliveries
       SET status = 'processing', attempts = attempts + 1, locked_at = now(), last_attempt_at = now(), updated_at = now()
       WHERE id = $1
       RETURNING id, payload, attempts, max_attempts`,
      [result.rows[0].id],
    );
    return claimed.rows[0] || null;
  });
}

async function markNotificationSuccess(id: string, providerId: string | null) {
  await query(
    `UPDATE notification_deliveries
     SET status = 'sent', provider_id = $2, error_message = NULL, locked_at = NULL, available_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'processing'`,
    [id, providerId],
  );
}

async function markNotificationNotConfigured(id: string) {
  await query(
    `UPDATE notification_deliveries
     SET status = 'not_configured', provider_id = NULL, error_message = NULL, locked_at = NULL, available_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'processing'`,
    [id],
  );
}

async function markNotificationFailure(row: NotificationDeliveryRow, error: unknown, retryable: boolean) {
  const message = safeError(error);
  const maxAttempts = Math.max(1, row.max_attempts || NOTIFICATION_MAX_ATTEMPTS);
  const shouldRetry = retryable && row.attempts < maxAttempts;
  const delaySeconds = Math.min(15 * 60, 15 * Math.pow(2, Math.max(0, row.attempts - 1)));
  await query(
    `UPDATE notification_deliveries
     SET status = $2,
         error_message = $3,
         provider_id = NULL,
         available_at = CASE WHEN $2 = 'pending' THEN now() + ($4::integer * interval '1 second') ELSE now() END,
         locked_at = NULL,
         updated_at = now()
     WHERE id = $1 AND status = 'processing'`,
    [row.id, shouldRetry ? 'pending' : 'failed', message, delaySeconds],
  );
  return { status: shouldRetry ? 'pending' as const : 'failed' as const, providerId: null, errorMessage: message };
}

async function processClaimedNotification(row: NotificationDeliveryRow): Promise<NotificationResult> {
  let payload: NotificationPayload;
  try {
    payload = validatePayload(row.payload);
  } catch (error) {
    return markNotificationFailure(row, error, false);
  }
  if (!emailConfigured()) {
    await markNotificationNotConfigured(row.id);
    return { status: 'not_configured', providerId: null, errorMessage: null };
  }
  try {
    const result = await sendBrandedEmailWithRetry({ ...payload, to: payload.recipientEmail });
    if (!result.sent) {
      await markNotificationNotConfigured(row.id);
      return { status: 'not_configured', providerId: null, errorMessage: null };
    }
    await markNotificationSuccess(row.id, result.providerId);
    return { status: 'sent', providerId: result.providerId, errorMessage: null };
  } catch (error) {
    return markNotificationFailure(row, error, isRetryableProviderError(error));
  }
}

async function processNotificationDelivery(id: string): Promise<NotificationResult> {
  const row = await claimNotification(id);
  if (!row) return { status: 'pending', providerId: null, errorMessage: null };
  return processClaimedNotification(row);
}

export async function processNotificationQueue(limit = 20) {
  const numericLimit = typeof limit === 'number' && Number.isFinite(limit) ? Math.trunc(limit) : 1;
  const boundedLimit = Math.min(Math.max(numericLimit || 1, 1), 100);
  try {
    await query(
      `UPDATE notification_deliveries
       SET status = 'pending', locked_at = NULL, available_at = LEAST(available_at, now()), updated_at = now()
       WHERE status = 'processing' AND locked_at < now() - ($1::integer * interval '1 minute')`,
      [NOTIFICATION_STALE_MINUTES],
    );
  } catch (error) {
    reportNotificationFailure('notifications.stale_claim_recovery', error);
    return 0;
  }
  let processed = 0;
  for (let index = 0; index < boundedLimit; index += 1) {
    let row: NotificationDeliveryRow | null;
    try {
      row = await claimNotification();
    } catch (error) {
      reportNotificationFailure('notifications.claim', error);
      break;
    }
    if (!row) break;
    try {
      await processClaimedNotification(row);
    } catch (error) {
      reportNotificationFailure('notifications.delivery_processing', error);
    }
    processed += 1;
  }
  return processed;
}

export async function sendNotification(input: NotificationInput): Promise<NotificationResult> {
  let id: string;
  try {
    const payload: NotificationPayload = {
      recipientEmail: input.recipientEmail,
      recipientName: input.recipientName,
      subject: input.subject,
      eyebrow: input.eyebrow,
      title: input.title,
      summary: input.summary,
      fields: input.fields,
      action: input.action,
    };
    const inserted = await query<{ id: string }>(
      `INSERT INTO notification_deliveries
         (organization_id, event_type, recipient_email, subject, status, payload, attempts, max_attempts, available_at)
       VALUES ($1, $2, $3, $4, 'pending', $5::jsonb, 0, $6, now())
       RETURNING id`,
      [input.organizationId, input.eventType, input.recipientEmail, input.subject, JSON.stringify(payload), NOTIFICATION_MAX_ATTEMPTS],
    );
    id = inserted.rows[0].id;
  } catch (error) {
    reportNotificationFailure('notifications.enqueue', error);
    return failedNotification(error);
  }
  try {
    return await processNotificationDelivery(id);
  } catch (error) {
    reportNotificationFailure('notifications.immediate_processing', error);
    return { status: 'pending', providerId: null, errorMessage: null };
  }
}

export async function notifyOrganizationRoles(input: Omit<NotificationInput, 'recipientEmail' | 'recipientName'> & { roles: string[]; excludeUserId?: string }): Promise<NotificationResult[]> {
  try {
    const recipients = await query<{ email: string; full_name: string }>(
      `SELECT email, full_name FROM users
       WHERE organization_id = $1 AND is_active = true AND role = ANY($2::text[])
         AND ($3::uuid IS NULL OR id <> $3)`,
      [input.organizationId, input.roles, input.excludeUserId || null],
    );
    const deliveries = await Promise.allSettled(recipients.rows.map(recipient => sendNotification({ ...input, recipientEmail: recipient.email, recipientName: recipient.full_name })));
    return deliveries.map(delivery => {
      if (delivery.status === 'fulfilled') return delivery.value;
      reportNotificationFailure('notifications.delivery_rejected', delivery.reason);
      return failedNotification(delivery.reason);
    });
  } catch (error) {
    reportNotificationFailure('notifications.recipient_lookup', error);
    return [];
  }
}
