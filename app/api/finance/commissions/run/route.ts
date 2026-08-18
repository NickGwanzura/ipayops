import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const runSchema = z.object({ ruleId: z.string().uuid().optional() });

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = runSchema.parse(await request.json().catch(() => ({})));
    const result = await withTransaction(async client => {
      const rule = await client.query(`SELECT id, name, rate, trigger_status FROM commission_rules WHERE organization_id = $1 AND is_active = true AND ($2::uuid IS NULL OR id = $2) ORDER BY created_at DESC LIMIT 1`, [session.user.organizationId, body.ruleId || null]);
      if (!rule.rows[0]) throw Object.assign(new Error('No active commission rule.'), { code: 'NO_RULE' });
      const sales = await client.query(`SELECT s.id, s.total, s.consultant_id FROM sales s WHERE s.organization_id = $1 AND $2 = 'Confirmed' AND s.status = 'Confirmed' AND s.consultant_id IS NOT NULL`, [session.user.organizationId, rule.rows[0].trigger_status]);
      let created = 0; let amount = 0;
      for (const sale of sales.rows) {
        const entry = await client.query(`INSERT INTO commission_entries (organization_id, sale_id, consultant_id, rate, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (sale_id) DO UPDATE SET consultant_id = EXCLUDED.consultant_id, rate = EXCLUDED.rate, amount = EXCLUDED.amount, status = CASE WHEN commission_entries.status IN ('Paid', 'Voided') THEN commission_entries.status ELSE 'Provisional' END RETURNING amount`, [session.user.organizationId, sale.id, sale.consultant_id, rule.rows[0].rate, Number(sale.total) * Number(rule.rows[0].rate) / 100]);
        if (entry.rows[0]) { created += 1; amount += Number(entry.rows[0].amount); }
      }
      return { rule: rule.rows[0], created, amount };
    });
    return NextResponse.json({ run: result }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NO_RULE') return NextResponse.json({ error: 'Create an active commission rule before running commissions.' }, { status: 409 });
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid commission rule.' }, { status: 400 });
    console.error('Commission run failed', error);
    return NextResponse.json({ error: 'Unable to run commissions.' }, { status: 500 });
  }
}
