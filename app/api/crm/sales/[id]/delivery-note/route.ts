import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { getSession } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  try {
    const note = await withTransaction(async client => {
      const saleResult = await client.query('SELECT id, client_id FROM sales WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params.id, session.user.organizationId]);
      if (!saleResult.rows[0]) throw Object.assign(new Error('Sale not found.'), { code: 'SALE_NOT_FOUND' });
      const existing = await client.query('SELECT id FROM delivery_notes WHERE sale_id = $1', [params.id]); if (existing.rows[0]) throw Object.assign(new Error('Delivery note already exists.'), { code: 'EXISTS' });
      const number = `DN-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const result = await client.query('INSERT INTO delivery_notes (organization_id, number, sale_id, client_id, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, number, status, created_at', [session.user.organizationId, number, params.id, saleResult.rows[0].client_id, session.user.id]);
      const items = await client.query('SELECT id, serial_number, description FROM sale_items WHERE sale_id = $1 AND returned = false', [params.id]); for (const item of items.rows) await client.query('INSERT INTO delivery_note_items (delivery_note_id, sale_item_id, serial_number, description) VALUES ($1, $2, $3, $4)', [result.rows[0].id, item.id, item.serial_number, item.description]);
      return result.rows[0];
    });
    return NextResponse.json({ deliveryNote: note }, { status: 201 });
  } catch (error) { const code = (error as { code?: string }).code; if (code === 'SALE_NOT_FOUND') return NextResponse.json({ error: 'Sale not found.' }, { status: 404 }); if (code === 'EXISTS' || code === '23505') return NextResponse.json({ error: 'Delivery note already exists for this sale.' }, { status: 409 }); console.error('Delivery note generation failed', error); return NextResponse.json({ error: 'Unable to generate delivery note.' }, { status: 500 }); }
}
