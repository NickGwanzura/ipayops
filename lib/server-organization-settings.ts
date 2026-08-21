import { query } from '@/lib/db';
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@/lib/organization-settings';

export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
  await query('INSERT INTO organization_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING', [organizationId]);
  const result = await query('SELECT o.name AS "organizationName", s.timezone, s.currency, s.date_format, s.address, s.phone FROM organizations o JOIN organization_settings s ON s.organization_id = o.id WHERE o.id = $1', [organizationId]);
  return { ...DEFAULT_ORGANIZATION_SETTINGS, ...(result.rows[0] || {}) };
}
