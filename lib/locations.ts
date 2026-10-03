type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

export class UnknownLocationError extends Error {
  code = 'LOCATION_UNKNOWN';
  constructor(public valid: string[]) {
    super('Location is not one of the configured stock locations.');
  }
}

/**
 * Resolves free-text input to a configured stock location (matching name or code, case-insensitively)
 * so typos cannot create phantom locations. Organizations that have not configured any locations yet
 * keep the previous free-text behaviour.
 */
export async function resolveLocation(db: Queryable, organizationId: string, input: string) {
  const value = input.trim();
  const result = await db.query('SELECT code, name FROM organization_locations WHERE organization_id = $1 AND is_active = true ORDER BY name', [organizationId]);
  if (!result.rows.length) return value;
  const needle = value.toLowerCase();
  const match = result.rows.find(row => String(row.name).toLowerCase() === needle || String(row.code).toLowerCase() === needle);
  if (!match) throw new UnknownLocationError(result.rows.map(row => String(row.name)));
  return String(match.name);
}

export function unknownLocationMessage(error: UnknownLocationError) {
  return `Choose a configured location: ${error.valid.join(', ')}.`;
}
