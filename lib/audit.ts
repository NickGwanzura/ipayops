import { query } from '@/lib/db';

type AuditEvent = {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  request?: Request;
};

export async function writeAuditLog(event: AuditEvent) {
  try {
    await query(
      `INSERT INTO audit_logs (organization_id, actor_user_id, action, entity_type, entity_id, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
      [
        event.organizationId || null,
        event.actorUserId || null,
        event.action,
        event.entityType || null,
        event.entityId || null,
        JSON.stringify(event.metadata || {}),
        event.request?.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || event.request?.headers.get('x-real-ip') || null,
        event.request?.headers.get('user-agent') || null,
      ],
    );
  } catch (error) {
    console.error('Audit log write failed', error);
  }
}
