export type OrganizationSettings = { timezone: string; currency: string; date_format: string };

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  timezone: 'Africa/Harare',
  currency: 'USD',
  date_format: 'DD/MM/YYYY',
};

export function formatCurrency(value: string | number | null | undefined, currency: string, maximumFractionDigits = 2) {
  return Number(value || 0).toLocaleString(undefined, { style: 'currency', currency, maximumFractionDigits });
}

export function formatOrganizationDate(value: string | number | Date, settings: OrganizationSettings) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: settings.timezone, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(part => part.type === type)?.value || '';
  const day = get('day'); const month = get('month'); const year = get('year');
  if (settings.date_format === 'MM/DD/YYYY') return `${month}/${day}/${year}`;
  if (settings.date_format === 'YYYY-MM-DD') return `${year}-${month}-${day}`;
  return `${day}/${month}/${year}`;
}
