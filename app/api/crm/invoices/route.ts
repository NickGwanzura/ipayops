import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) { const session = await getSession(request); if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 }); const result = await query(`SELECT i.id, i.number, i.status, i.total, i.issued_at, c.name AS client_name, s.number AS sale_number FROM invoices i JOIN clients c ON c.id = i.client_id JOIN sales s ON s.id = i.sale_id WHERE i.organization_id = $1 ORDER BY i.created_at DESC LIMIT 200`, [session.user.organizationId]); return NextResponse.json({ invoices: result.rows }); }
