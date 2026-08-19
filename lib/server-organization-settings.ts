import { query } from '@/lib/db';
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@/lib/organization-settings';

export async function getOrganizationSettings(organizationId: string): Promise<OrganizationSettings> {
  await query('INSERT INTO organization_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING', [organizationId]);
  const result = await query('SELECT timezone, currency, date_format FROM organization_settings WHERE organization_id = $1', [organizationId]);
  return { ...DEFAULT_ORGANIZATION_SETTINGS, ...(result.rows[0] || {}) };
}
