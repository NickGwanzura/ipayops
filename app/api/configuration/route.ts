import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';
import { query, withTransaction } from '@/lib/db';

const settingsSchema = z.object({
  organizationName: z.string().trim().min(2).max(160),
  address: z.string().trim().max(240),
  phone: z.string().trim().max(40),
  timezone: z.string().trim().min(3).max(80),
  currency: z.enum(['USD', 'ZAR', 'GBP', 'EUR', 'BWP', 'ZWL']),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
});

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    await query('INSERT INTO organization_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING', [session.user.organizationId]);
    const [organization, settings, locations, roles] = await Promise.all([
      query('SELECT id, name, slug FROM organizations WHERE id = $1', [session.user.organizationId]),
      query('SELECT timezone, currency, date_format, address, phone, updated_at FROM organization_settings WHERE organization_id = $1', [session.user.organizationId]),
      query('SELECT id, code, name, address, is_active, created_at FROM organization_locations WHERE organization_id = $1 ORDER BY is_active DESC, name', [session.user.organizationId]),
      query('SELECT role, COUNT(*)::int AS count FROM users WHERE organization_id = $1 GROUP BY role ORDER BY role', [session.user.organizationId]),
    ]);
    return NextResponse.json({ organization: organization.rows[0], settings: settings.rows[0], locations: locations.rows, roles: roles.rows });
  } catch (error) {
    console.error('Configuration lookup failed', error);
    return NextResponse.json({ error: 'Unable to load configuration.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireRole(request, ACCESS.leadership);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  try {
    const body = settingsSchema.parse(await request.json());
    const updated = await withTransaction(async client => {
      await client.query('UPDATE organizations SET name = $1, updated_at = now() WHERE id = $2', [body.organizationName, session.user.organizationId]);
      await client.query(`INSERT INTO organization_settings (organization_id, address, phone, timezone, currency, date_format, updated_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (organization_id) DO UPDATE SET address = EXCLUDED.address, phone = EXCLUDED.phone, timezone = EXCLUDED.timezone, currency = EXCLUDED.currency, date_format = EXCLUDED.date_format, updated_by = EXCLUDED.updated_by, updated_at = now()`, [session.user.organizationId, body.address, body.phone, body.timezone, body.currency, body.dateFormat, session.user.id]);
      const result = await client.query('SELECT o.id, o.name, o.slug, s.address, s.phone, s.timezone, s.currency, s.date_format, s.updated_at FROM organizations o JOIN organization_settings s ON s.organization_id = o.id WHERE o.id = $1', [session.user.organizationId]);
      return result.rows[0];
    });
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'configuration.updated', entityType: 'organization', entityId: session.user.organizationId, metadata: { currency: body.currency, timezone: body.timezone, dateFormat: body.dateFormat }, request });
    return NextResponse.json({ configuration: updated });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Enter a valid organization name, address, phone, timezone, currency, and date format.' }, { status: 400 });
    console.error('Configuration update failed', error);
    return NextResponse.json({ error: 'Unable to save configuration.' }, { status: 500 });
  }
}
