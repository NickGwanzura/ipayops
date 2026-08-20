import { timingSafeEqual, createHmac } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const validTypes = new Set(['invoice', 'delivery-note']);

function isValidSignature(type: string, id: string, documentTimestamp: string, generatedAt: string, signature: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) return false;
  const expected = createHmac('sha256', secret).update(`${type}|${id}|${documentTimestamp}|${generatedAt}`).digest('hex');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const type = params.get('type') || '';
  const id = params.get('id') || '';
  const documentTimestamp = params.get('documentTimestamp') || '';
  const generatedAt = params.get('generatedAt') || '';
  const signature = params.get('signature') || '';
  if (!validTypes.has(type) || !id || !documentTimestamp || !generatedAt || !signature || !isValidSignature(type, id, documentTimestamp, generatedAt, signature)) {
    return NextResponse.json({ valid: false, error: 'Invalid verification code.' }, { status: 400 });
  }
  const result = type === 'invoice'
    ? await query(`SELECT i.number, i.status, i.issued_at, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.id = $1`, [id])
    : await query(`SELECT d.number, d.status, d.created_at AS issued_at, c.name AS client_name FROM delivery_notes d JOIN clients c ON c.id = d.client_id WHERE d.id = $1`, [id]);
  const document = result.rows[0];
  if (!document || new Date(document.issued_at).toISOString() !== documentTimestamp) return NextResponse.json({ valid: false, error: 'Document not found or timestamp mismatch.' }, { status: 404 });
  return NextResponse.json({ valid: true, type, document, generatedAt });
}
