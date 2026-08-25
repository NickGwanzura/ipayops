import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { notifyOrganizationRoles, sendNotification } from '@/lib/notifications';

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
    const commission = result.rows[0];
    const consultant = consultantId ? await query<{ email: string; full_name: string }>('SELECT email, full_name FROM users WHERE id = $1 AND organization_id = $2', [consultantId, session.user.organizationId]) : { rows: [] as Array<{ email: string; full_name: string }> };
    await Promise.all([
      consultant.rows[0] ? sendNotification({ organizationId: session.user.organizationId, eventType: 'commission.created', recipientEmail: consultant.rows[0].email, recipientName: consultant.rows[0].full_name, subject: 'Sales commission recorded', eyebrow: 'Commission activity', title: 'Commission recorded', summary: 'A commission entry has been recorded against a confirmed sale.', fields: [{ label: 'Rate', value: `${commission.rate}%` }, { label: 'Amount', value: String(commission.amount) }, { label: 'Status', value: commission.status }], action: { label: 'Open Finance & HR', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Finance%20%26%20HR` } }) : Promise.resolve(),
      notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'commission.created', subject: 'Sales commission recorded', eyebrow: 'Commission oversight', title: 'Commission entry recorded', summary: `${session.user.fullName} recorded a commission against a sale.`, fields: [{ label: 'Rate', value: `${commission.rate}%` }, { label: 'Amount', value: String(commission.amount) }, { label: 'Status', value: commission.status }], action: { label: 'Open Finance & HR', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Finance%20%26%20HR` } }),
    ]);
    return NextResponse.json({ commission: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Commission rate is required.' }, { status: 400 });
    console.error('Commission create failed', error);
    return NextResponse.json({ error: 'Unable to calculate commission.' }, { status: 500 });
  }
}
