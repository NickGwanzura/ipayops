import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

const itemSchema = z.object({ sku: z.string().trim().min(1).max(80), description: z.string().trim().min(1).max(200), quantity: z.number().int().positive().max(100000), unitPrice: z.number().nonnegative().max(100000000) });
const updateSchema = z.object({ clientId: z.string().uuid().optional(), validUntil: z.string().date().nullable().optional(), status: z.enum(['Draft', 'Sent', 'Accepted', 'Expired', 'Cancelled']).optional(), items: z.array(itemSchema).min(1).max(200).optional() });

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const result = await query(
    `SELECT q.id, q.number, q.status, q.currency, q.total, q.valid_until, q.created_at, q.updated_at, c.id AS client_id, c.name AS client_name,
            COALESCE(json_agg(json_build_object('id', qi.id, 'sku', qi.sku, 'description', qi.description, 'quantity', qi.quantity, 'unitPrice', qi.unit_price) ORDER BY qi.created_at) FILTER (WHERE qi.id IS NOT NULL), '[]'::json) AS items
     FROM quotations q JOIN clients c ON c.id = q.client_id LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
     WHERE q.id = $1 AND q.organization_id = $2 GROUP BY q.id, c.id`,
    [params.id, auth.session.user.organizationId],
  );
  if (!result.rows[0]) return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
  return NextResponse.json({ quotation: result.rows[0] });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const body = updateSchema.parse(await request.json());
    const quotation = await withTransaction(async client => {
      const existing = await client.query('SELECT id, status FROM quotations WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params.id, auth.session.user.organizationId]);
      if (!existing.rows[0]) throw Object.assign(new Error('Quotation not found.'), { code: 'NOT_FOUND' });
      if (existing.rows[0].status === 'Converted') throw Object.assign(new Error('Converted quotations cannot be edited.'), { code: 'LOCKED' });
      let total: number | null = null;
      if (body.items) { total = body.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0); await client.query('DELETE FROM quotation_items WHERE quotation_id = $1', [params.id]); for (const item of body.items) await client.query('INSERT INTO quotation_items (quotation_id, sku, description, quantity, unit_price) VALUES ($1, $2, $3, $4, $5)', [params.id, item.sku, item.description, item.quantity, item.unitPrice]); }
      const result = await client.query(`UPDATE quotations SET client_id = COALESCE($1, client_id), valid_until = COALESCE($2, valid_until), status = COALESCE($3, status), total = COALESCE($4, total), updated_at = now() WHERE id = $5 RETURNING id, number, status, total, valid_until, updated_at`, [body.clientId ?? null, body.validUntil ?? null, body.status ?? null, total, params.id]);
      return result.rows[0];
    });
    return NextResponse.json({ quotation });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid quotation update.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Quotation not found.' }, { status: 404 });
    if (code === 'LOCKED') return NextResponse.json({ error: 'Converted quotations cannot be edited.' }, { status: 409 });
    console.error('Quotation update failed', error);
    return NextResponse.json({ error: 'Unable to update quotation.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const auth = await requireRole(request, ACCESS.operations);
  if ('response' in auth) return auth.response;
  const result = await query(`UPDATE quotations SET status = 'Cancelled', updated_at = now() WHERE id = $1 AND organization_id = $2 AND status <> 'Converted' RETURNING id, status`, [params.id, auth.session.user.organizationId]);
  if (!result.rows[0]) return NextResponse.json({ error: 'Quotation not found or already converted.' }, { status: 404 });
  return NextResponse.json({ quotation: result.rows[0], archived: true });
}
