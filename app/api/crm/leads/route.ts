import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const leadSchema = z.object({ name: z.string().trim().min(2).max(160), clientId: z.string().uuid().optional(), source: z.string().trim().max(100).optional().default(''), notes: z.string().trim().max(500).optional().default('') });

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const result = await query(
    `SELECT l.id, l.name, l.source, l.status, l.notes, l.created_at, c.id AS client_id, c.name AS client_name, u.full_name AS owner_name
     FROM leads l LEFT JOIN clients c ON c.id = l.client_id LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.organization_id = $1 ORDER BY l.created_at DESC LIMIT 200`,
    [session.user.organizationId],
  );
  return NextResponse.json({ leads: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = leadSchema.parse(await request.json());
    const result = await query(
      `INSERT INTO leads (organization_id, name, client_id, source, notes, owner_id) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, client_id, source, status, notes, created_at`,
      [session.user.organizationId, body.name, body.clientId || null, body.source, body.notes, session.user.id],
    );
    return NextResponse.json({ lead: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Lead name and valid details are required.' }, { status: 400 });
    console.error('Lead create failed', error);
    return NextResponse.json({ error: 'Unable to create lead.' }, { status: 500 });
  }
}
