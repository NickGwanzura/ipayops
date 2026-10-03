type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> };

/** Open pipeline owned by a person: the work that stalls when they leave. */
export async function openWorkFor(db: Queryable, organizationId: string, userId: string) {
  const result = await db.query(
    `SELECT (SELECT COUNT(*) FROM opportunities WHERE organization_id = $1 AND owner_id = $2 AND stage NOT IN ('Won', 'Lost'))::int AS opportunities,
            (SELECT COUNT(*) FROM leads WHERE organization_id = $1 AND owner_id = $2 AND status IN ('New', 'Qualified'))::int AS leads,
            (SELECT COUNT(*) FROM quotations WHERE organization_id = $1 AND created_by = $2 AND status IN ('Draft', 'Sent', 'Accepted'))::int AS quotations`,
    [organizationId, userId],
  );
  return { opportunities: Number(result.rows[0]?.opportunities || 0), leads: Number(result.rows[0]?.leads || 0), quotations: Number(result.rows[0]?.quotations || 0) };
}

export async function reassignOpenWork(db: Queryable, organizationId: string, fromUserId: string, toUserId: string) {
  const opportunities = await db.query(`UPDATE opportunities SET owner_id = $3, updated_at = now() WHERE organization_id = $1 AND owner_id = $2 AND stage NOT IN ('Won', 'Lost')`, [organizationId, fromUserId, toUserId]);
  const leads = await db.query(`UPDATE leads SET owner_id = $3, updated_at = now() WHERE organization_id = $1 AND owner_id = $2 AND status IN ('New', 'Qualified')`, [organizationId, fromUserId, toUserId]);
  // Open quotes move too: consultants only see and convert quotes they created, so the successor would otherwise be locked out.
  const quotations = await db.query(`UPDATE quotations SET created_by = $3, updated_at = now() WHERE organization_id = $1 AND created_by = $2 AND status IN ('Draft', 'Sent', 'Accepted')`, [organizationId, fromUserId, toUserId]);
  return { opportunities: opportunities.rowCount || 0, leads: leads.rowCount || 0, quotations: quotations.rowCount || 0 };
}

/** Default checklist created when a sales consultant activates their account. */
export const SALES_ONBOARDING_TASKS: Array<{ title: string; category: string; dueInDays: number }> = [
  { title: 'Sign employment and confidentiality documents', category: 'Compliance', dueInDays: 3 },
  { title: 'Review product catalogue, pricing and discount rules', category: 'Sales', dueInDays: 7 },
  { title: 'Complete CRM, quotation and sales walkthrough', category: 'Training', dueInDays: 7 },
  { title: 'Agree sales target and commission rule', category: 'Compensation', dueInDays: 14 },
];
