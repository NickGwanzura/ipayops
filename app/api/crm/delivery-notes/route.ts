import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) { const session = await getSession(request); if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 }); const result = await query(`SELECT d.id, d.number, d.status, d.delivery_address, d.created_at, c.name AS client_name, s.number AS sale_number FROM delivery_notes d JOIN clients c ON c.id = d.client_id JOIN sales s ON s.id = d.sale_id WHERE d.organization_id = $1 ORDER BY d.created_at DESC LIMIT 200`, [session.user.organizationId]); return NextResponse.json({ deliveryNotes: result.rows }); }
