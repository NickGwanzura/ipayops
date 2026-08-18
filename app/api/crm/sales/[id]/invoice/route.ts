import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSession } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  try {
    const invoice = await withTransaction(async client => {
      const saleResult = await client.query(`SELECT s.id, s.client_id, s.total FROM sales s WHERE s.id = $1 AND s.organization_id = $2 FOR UPDATE`, [params.id, session.user.organizationId]);
      if (!saleResult.rows[0]) throw Object.assign(new Error('Sale not found.'), { code: 'SALE_NOT_FOUND' });
      const existing = await client.query('SELECT id FROM invoices WHERE sale_id = $1', [params.id]); if (existing.rows[0]) throw Object.assign(new Error('Invoice already exists.'), { code: 'EXISTS' });
      const number = `INV-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const result = await client.query(`INSERT INTO invoices (organization_id, number, sale_id, client_id, total, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, number, status, total, paid_amount, issued_at, due_at`, [session.user.organizationId, number, params.id, saleResult.rows[0].client_id, saleResult.rows[0].total, session.user.id]);
      const items = await client.query('SELECT id, description, amount FROM sale_items WHERE sale_id = $1 AND returned = false', [params.id]); for (const item of items.rows) await client.query('INSERT INTO invoice_items (invoice_id, sale_item_id, description, amount) VALUES ($1, $2, $3, $4)', [result.rows[0].id, item.id, item.description, item.amount]);
      return result.rows[0];
    });
    return NextResponse.json({ invoice }, { status: 201 });
  } catch (error) { const code = (error as { code?: string }).code; if (code === 'SALE_NOT_FOUND') return NextResponse.json({ error: 'Sale not found.' }, { status: 404 }); if (code === 'EXISTS' || code === '23505') return NextResponse.json({ error: 'Invoice already exists for this sale.' }, { status: 409 }); console.error('Invoice generation failed', error); return NextResponse.json({ error: 'Unable to generate invoice.' }, { status: 500 }); }
}
