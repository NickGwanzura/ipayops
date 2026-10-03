import { query, withTransaction } from '@/lib/db';
import { isUuid } from '@/lib/server-env';
import { usesS3 } from '@/lib/storage';
import { reportError } from '@/lib/observability';
import { releaseQuoteReservations } from '@/lib/reservations';
import { writeAuditLog } from '@/lib/audit';
import { notifyOrganizationRoles } from '@/lib/notifications';

const MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000;
let lastRun = 0;

/** Release stock held by reservations whose expiry has passed. */
export async function expireReservations() {
  return withTransaction(async client => {
    const expired = await client.query<{ inventory_item_id: string }>(
      `UPDATE inventory_reservations SET status = 'Expired'
       WHERE status = 'Active' AND expires_at IS NOT NULL AND expires_at <= now()
       RETURNING inventory_item_id`,
    );
    if (expired.rows.length) {
      await client.query(
        `UPDATE inventory_items SET status = 'Available', updated_at = now()
         WHERE id = ANY($1::uuid[]) AND status = 'Reserved'`,
        [expired.rows.map(row => row.inventory_item_id)],
      );
    }
    return expired.rows.length;
  });
}

/** Quotes past their valid-until date can no longer be converted at their old prices. */
export async function expireQuotations() {
  await withTransaction(async client => {
    const expired = await client.query<{ id: string; organization_id: string }>(
      `UPDATE quotations SET status = 'Expired', updated_at = now()
       WHERE status IN ('Draft', 'Sent') AND valid_until IS NOT NULL AND valid_until < current_date
       RETURNING id, organization_id`,
    );
    for (const quote of expired.rows) await releaseQuoteReservations(client, quote.organization_id, quote.id);
  });
}

/**
 * One internal digest per organization per day for invoices past their due date, sent to the CEO and finance.
 * Customers are never emailed automatically; finance decides who to chase.
 */
export async function sendOverdueInvoiceDigests() {
  const organizations = await query<{ organization_id: string; count: number; amount: string; oldest: string; currency: string }>(
    `SELECT i.organization_id, COUNT(*)::int AS count, SUM(i.total - i.paid_amount) AS amount, MIN(i.due_at)::text AS oldest, MIN(i.currency) AS currency
     FROM invoices i
     WHERE i.status = 'Issued' AND i.total > i.paid_amount AND i.due_at < current_date
     GROUP BY i.organization_id`,
  );
  for (const row of organizations.rows) {
    const recent = await query(`SELECT 1 FROM notification_deliveries WHERE organization_id = $1 AND event_type = 'invoice.overdue' AND created_at > now() - interval '20 hours' LIMIT 1`, [row.organization_id]);
    if (recent.rows[0]) continue;
    await notifyOrganizationRoles({
      organizationId: row.organization_id,
      roles: ['ceo', 'finance'],
      eventType: 'invoice.overdue',
      subject: `${row.count} overdue invoice${row.count === 1 ? '' : 's'} need follow-up`,
      eyebrow: 'Debtors',
      title: 'Overdue invoices',
      summary: 'Invoices are past their due date with an outstanding balance. Review them in Finance and follow up with the clients.',
      fields: [{ label: 'Overdue invoices', value: String(row.count) }, { label: 'Outstanding', value: `${row.currency} ${Number(row.amount).toFixed(2)}` }, { label: 'Oldest due date', value: row.oldest }],
      action: { label: 'Open invoices', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Finance%20%26%20HR&view=invoices` },
    });
  }
}

let lastBacklogAlert = 0;
const BACKLOG_ALERT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Raises an alert when email is silently not getting out: deliveries nobody has picked up for 30 minutes, or a
 * burst of permanent failures. Uses the metadata-only monitoring webhook and the platform audit log.
 */
export async function checkNotificationBacklog() {
  const result = await query<{ stuck: number; failed: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending' AND available_at < now() - interval '30 minutes')::int AS stuck,
            COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '1 hour')::int AS failed
     FROM notification_deliveries`,
  );
  const { stuck, failed } = result.rows[0] || { stuck: 0, failed: 0 };
  if (stuck === 0 && failed < 5) return;
  const now = Date.now();
  if (now - lastBacklogAlert < BACKLOG_ALERT_INTERVAL_MS) return;
  lastBacklogAlert = now;
  console.error('Notification delivery backlog', { stuck, failed });
  const error = Object.assign(new Error('Notification delivery backlog'), { name: 'NotificationBacklog' });
  await reportError(error, { source: 'notification-queue', runtime: 'nodejs' });
  const organizationId = process.env.BACKUP_ADMIN_ORGANIZATION_ID?.trim();
  if (organizationId && isUuid(organizationId)) await writeAuditLog({ organizationId, action: 'notification.backlog_detected', entityType: 'system', metadata: { stuck, failedLastHour: failed } });
}

/** Drop rows that can never be used again so authentication tables do not grow without bound. */
export async function purgeExpiredRows() {
  await query(`DELETE FROM sessions WHERE expires_at < now() - interval '1 day'`);
  await query(`DELETE FROM rate_limit_buckets WHERE updated_at < now() - interval '1 day'`);
}

/**
 * Queues an encrypted backup for the platform organization when none has completed within BACKUP_INTERVAL_HOURS
 * (default 24 in production, 0 disables). The existing worker executes it; the unique active-backup index makes
 * concurrent replicas harmless.
 */
export async function scheduleBackup() {
  const configured = process.env.BACKUP_INTERVAL_HOURS;
  const hours = configured === undefined || configured === '' ? (process.env.NODE_ENV === 'production' ? 24 : 0) : Number(configured);
  if (!Number.isFinite(hours) || hours <= 0) return;
  const organizationId = process.env.BACKUP_ADMIN_ORGANIZATION_ID?.trim() || '';
  if (!isUuid(organizationId) || !usesS3() || !/^[0-9a-f]{64}$/i.test(process.env.BACKUP_ENCRYPTION_KEY?.trim() || '')) return;
  try {
    await query(
      `INSERT INTO backup_runs (organization_id, status)
       SELECT $1::uuid, 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM backup_runs
         WHERE organization_id = $1::uuid
           AND (status IN ('pending', 'running')
             OR (status = 'completed' AND completed_at > now() - ($2::numeric * interval '1 hour'))
             OR (status = 'failed' AND created_at > now() - interval '1 hour'))
       )`,
      [organizationId, hours],
    );
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') throw error;
  }
}

export async function runMaintenance(force = false) {
  const now = Date.now();
  if (!force && now - lastRun < MAINTENANCE_INTERVAL_MS) return;
  lastRun = now;
  // Independent jobs: one failing must not starve the others (notably the scheduled backup).
  for (const [name, job] of [['reservations', expireReservations], ['quotations', expireQuotations], ['purge', purgeExpiredRows], ['backup schedule', scheduleBackup], ['notification backlog', checkNotificationBacklog], ['overdue invoice digest', sendOverdueInvoiceDigests]] as const) {
    try {
      await job();
    } catch (error) {
      console.error(`Maintenance job failed: ${name}`, error);
    }
  }
}
