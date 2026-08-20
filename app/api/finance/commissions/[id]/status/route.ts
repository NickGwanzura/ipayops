import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const statusSchema = z.object({ status: z.enum(['Approved', 'Paid', 'Voided']) });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.finance);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = statusSchema.parse(await request.json());
    const result = await query(`UPDATE commission_entries SET status = $1 WHERE id = $2 AND organization_id = $3 AND (($1 IN ('Approved', 'Voided') AND status = 'Provisional') OR ($1 = 'Paid' AND status = 'Approved')) RETURNING id, sale_id, amount, status`, [body.status, params.id, session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Commission not found or transition is not allowed.' }, { status: 409 });
    return NextResponse.json({ commission: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Valid commission status is required.' }, { status: 400 });
    console.error('Commission status update failed', error);
    return NextResponse.json({ error: 'Unable to update commission.' }, { status: 500 });
  }
}
