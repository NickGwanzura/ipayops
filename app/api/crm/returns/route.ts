import { NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: Request) {
  const auth = await requireRole(request, ACCESS.finance);
  if ('response' in auth) return auth.response;
  const result = await query(`SELECT r.id, r.number, r.status, r.reason, r.refund_amount, r.refund_status, r.refund_method, r.refund_reference, r.credit_note_number, r.refunded_at, r.created_at, s.number AS sale_number, c.name AS client_name FROM returns r JOIN sales s ON s.id = r.sale_id JOIN clients c ON c.id = s.client_id WHERE r.organization_id = $1 ORDER BY r.created_at DESC LIMIT 200`, [auth.session.user.organizationId]);
  return NextResponse.json({ returns: result.rows });
}
