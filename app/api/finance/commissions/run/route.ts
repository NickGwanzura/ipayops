import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { notifyOrganizationRoles } from '@/lib/notifications';

const runSchema = z.object({ ruleId: z.string().uuid().optional() });

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.finance);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = runSchema.parse(await request.json().catch(() => ({})));
    const result = await withTransaction(async client => {
      const rule = await client.query(`SELECT id, name, rate, trigger_status FROM commission_rules WHERE organization_id = $1 AND is_active = true AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at DESC LIMIT 1`, [session.user.organizationId, body.ruleId || null]);
      if (!rule.rows[0]) throw Object.assign(new Error('No active commission rule.'), { code: 'NO_RULE' });
      const sales = await client.query(`SELECT s.id, s.consultant_id, SUM(si.amount) AS commission_base
        FROM sales s JOIN sale_items si ON si.sale_id = s.id AND si.returned = false
        WHERE s.organization_id = $1 AND s.status NOT IN ('Cancelled', 'Returned') AND s.consultant_id IS NOT NULL
        AND (($2 = 'Confirmed')
          OR ($2 = 'Delivered' AND EXISTS (SELECT 1 FROM delivery_notes d WHERE d.sale_id = s.id AND d.organization_id = s.organization_id AND d.status = 'Delivered'))
          OR ($2 = 'Paid' AND EXISTS (SELECT 1 FROM invoices i WHERE i.sale_id = s.id AND i.organization_id = s.organization_id AND i.status = 'Paid')))
        GROUP BY s.id, s.consultant_id
        HAVING SUM(si.amount) > 0`, [session.user.organizationId, rule.rows[0].trigger_status]);
      let created = 0; let amount = 0;
      for (const sale of sales.rows) {
        const entry = await client.query(`INSERT INTO commission_entries (organization_id, sale_id, consultant_id, rate, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (sale_id) DO UPDATE SET consultant_id = EXCLUDED.consultant_id, rate = EXCLUDED.rate, amount = EXCLUDED.amount WHERE commission_entries.status = 'Provisional' RETURNING amount`, [session.user.organizationId, sale.id, sale.consultant_id, rule.rows[0].rate, Number(sale.commission_base) * Number(rule.rows[0].rate) / 100]);
        if (entry.rows[0]) { created += 1; amount += Number(entry.rows[0].amount); }
      }
      return { rule: rule.rows[0], created, amount };
    });
    await notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'commission.run', subject: `Commission run completed: ${result.rule.name}`, eyebrow: 'Commission engine', title: 'Commission run completed', summary: 'The commission engine has processed eligible confirmed sales.', fields: [{ label: 'Rule', value: result.rule.name }, { label: 'Entries', value: String(result.created) }, { label: 'Total', value: String(result.amount) }], action: { label: 'Open Finance & HR', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Finance%20%26%20HR` } });
    return NextResponse.json({ run: result }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NO_RULE') return NextResponse.json({ error: 'Create an active commission rule before running commissions.' }, { status: 409 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid commission rule.' }, { status: 400 });
    console.error('Commission run failed', error);
    return NextResponse.json({ error: 'Unable to run commissions.' }, { status: 500 });
  }
}
