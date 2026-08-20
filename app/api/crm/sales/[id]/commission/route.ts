import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const commissionSchema = z.object({ rate: z.number().min(0).max(100), consultantId: z.string().uuid().optional() });

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.financeSettings);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = commissionSchema.parse(await request.json());
    const sale = await query('SELECT id, total, consultant_id FROM sales WHERE id = $1 AND organization_id = $2', [params.id, session.user.organizationId]);
    if (!sale.rows[0]) return NextResponse.json({ error: 'Sale not found.' }, { status: 404 });
    const consultantId = body.consultantId || sale.rows[0].consultant_id || null;
    if (consultantId) {
      const consultant = await query(`SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true AND role = 'sales_consultant'`, [consultantId, session.user.organizationId]);
      if (!consultant.rows[0]) return NextResponse.json({ error: 'Sales consultant not found.' }, { status: 404 });
    }
    const result = await query(`INSERT INTO commission_entries (organization_id, sale_id, consultant_id, rate, amount) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (sale_id) DO UPDATE SET consultant_id = EXCLUDED.consultant_id, rate = EXCLUDED.rate, amount = EXCLUDED.amount, status = 'Provisional' RETURNING id, sale_id, consultant_id, rate, amount, status`, [session.user.organizationId, params.id, consultantId, body.rate, Number(sale.rows[0].total) * body.rate / 100]);
    return NextResponse.json({ commission: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Commission rate is required.' }, { status: 400 });
    console.error('Commission create failed', error);
    return NextResponse.json({ error: 'Unable to calculate commission.' }, { status: 500 });
  }
}
