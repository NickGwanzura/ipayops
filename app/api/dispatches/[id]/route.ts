import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const updateSchema = z.object({
  status: z.enum(['Prepared', 'In transit', 'Delivered', 'Cancelled']).optional(),
  paymentStatus: z.enum(['Pending', 'Paid']).optional(),
  paymentReference: z.string().trim().max(120).optional(),
  driverFee: z.coerce.number().min(0).max(100000000).optional(),
}).refine(value => Object.keys(value).length > 0, 'At least one field is required.');

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRole(request, ACCESS.dispatchWrite);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const { id } = await params;
    const body = updateSchema.parse(await request.json());
    const values: Array<string | number | null> = [];
    const updates: string[] = [];
    if (body.status) { values.push(body.status); updates.push(`status = $${values.length}`); }
    if (body.paymentStatus) { values.push(body.paymentStatus); updates.push(`payment_status = $${values.length}`); values.push(body.paymentStatus === 'Paid' ? new Date().toISOString() : null); updates.push(`paid_at = $${values.length}`); }
    if (body.paymentReference !== undefined) { values.push(body.paymentReference || null); updates.push(`payment_reference = $${values.length}`); }
    if (body.driverFee !== undefined) { values.push(body.driverFee); updates.push(`driver_fee = $${values.length}`); }
    values.push(new Date().toISOString()); updates.push(`updated_at = $${values.length}`);
    values.push(id, session.user.organizationId);
    const ownership = session.user.role === 'sales_consultant' ? ` AND d.created_by = $${values.length + 1}` : '';
    if (session.user.role === 'sales_consultant') values.push(session.user.id);
    const result = await query(`UPDATE intertown_dispatches d SET ${updates.join(', ')} WHERE d.id = $${values.length - (session.user.role === 'sales_consultant' ? 2 : 1)} AND d.organization_id = $${values.length - (session.user.role === 'sales_consultant' ? 1 : 0)}${ownership} RETURNING d.id, d.number, d.status, d.payment_status, d.payment_reference, d.driver_fee, d.paid_at, d.updated_at`, values);
    if (!result.rows[0]) return NextResponse.json({ error: 'Dispatch record not found.' }, { status: 404 });
    return NextResponse.json({ dispatch: result.rows[0] });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Choose a valid dispatch status or payment update.' }, { status: 400 });
    console.error('Dispatch update failed', error);
    return NextResponse.json({ error: 'Unable to update dispatch record.' }, { status: 500 });
  }
}
