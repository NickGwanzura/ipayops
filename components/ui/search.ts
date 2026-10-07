/** Case-insensitive "contains" match of a search box value against any of a record's visible fields. */
export function matchesQuery(query: string | undefined, ...fields: Array<string | number | null | undefined>) {
  const needle = (query || '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some((field) => field !== null && field !== undefined && String(field).toLowerCase().includes(needle));
}
