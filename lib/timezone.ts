import { getOrganizationSettings } from '@/lib/server-organization-settings';

export const FALLBACK_TIME_ZONE = 'Africa/Harare';

function validTimeZone(value: string | undefined) {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/** Organization time zone used for "today" / "this month" boundaries, falling back to the platform default. */
export async function organizationTimeZone(organizationId: string) {
  const settings = await getOrganizationSettings(organizationId).catch(() => null);
  return validTimeZone(settings?.timezone) || validTimeZone(process.env.DEFAULT_TIMEZONE) || FALLBACK_TIME_ZONE;
}

/** YYYY-MM-DD for the given instant in the given time zone. */
export function isoDateIn(timeZone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function monthStartIn(timeZone: string, at = new Date()) {
  return `${isoDateIn(timeZone, at).slice(0, 8)}01`;
}
