import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';

const refundSchema = z.object({ method: z.enum(['Bank transfer', 'Cash', 'Card', 'Mobile money', 'Credit note']), reference: z.string().trim().max(120).optional().default('') });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.finance);
    if ('response' in auth) return auth.response;
    const body = refundSchema.parse(await request.json());
    const result = await withTransaction(async client => {
      const current = await client.query(`SELECT id, number, refund_amount, refund_status FROM returns WHERE id = $1 AND organization_id = $2 FOR UPDATE`, [params.id, auth.session.user.organizationId]);
      if (!current.rows[0]) throw Object.assign(new Error('Return not found.'), { code: 'NOT_FOUND' });
      if (Number(current.rows[0].refund_amount) <= 0) throw Object.assign(new Error('No refund is recorded for this return.'), { code: 'NO_REFUND' });
      if (current.rows[0].refund_status === 'Processed') throw Object.assign(new Error('Refund already processed.'), { code: 'PROCESSED' });
      const creditNote = body.method === 'Credit note' ? `CN-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}` : null;
      const updated = await client.query(`UPDATE returns SET refund_status = 'Processed', refund_method = $1, refund_reference = NULLIF($2, ''), credit_note_number = COALESCE($3, credit_note_number), refunded_at = now() WHERE id = $4 RETURNING id, number, refund_amount, refund_status, refund_method, refund_reference, credit_note_number, refunded_at`, [body.method, body.reference, creditNote, params.id]);
      return updated.rows[0];
    });
    return NextResponse.json({ refund: result });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'A valid refund method is required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Return not found.' }, { status: 404 });
    if (code === 'NO_REFUND' || code === 'PROCESSED') return NextResponse.json({ error: 'This return has no pending refundable amount.' }, { status: 409 });
    console.error('Return refund failed', error);
    return NextResponse.json({ error: 'Unable to process refund.' }, { status: 500 });
  }
}
