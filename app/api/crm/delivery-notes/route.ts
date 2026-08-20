import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) { const auth = await requireRole(request, ACCESS.financeRead); if ('response' in auth) return auth.response; const { session } = auth; const result = await query(`SELECT d.id, d.number, d.status, d.delivery_address, d.created_at, c.name AS client_name, s.number AS sale_number FROM delivery_notes d JOIN clients c ON c.id = d.client_id JOIN sales s ON s.id = d.sale_id WHERE d.organization_id = $1 ORDER BY d.created_at DESC LIMIT 200`, [session.user.organizationId]); return NextResponse.json({ deliveryNotes: result.rows }); }
