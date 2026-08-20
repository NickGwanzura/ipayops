import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const opportunitySchema = z.object({ name: z.string().trim().min(2).max(160), clientId: z.string().uuid().optional(), leadId: z.string().uuid().optional(), value: z.number().nonnegative().max(100000000).optional().default(0), expectedClose: z.string().date().optional(), notes: z.string().trim().max(500).optional().default('') });

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const ownershipClause = session.user.role === 'sales_consultant' ? ' AND o.owner_id = $2' : '';
  const parameters = session.user.role === 'sales_consultant' ? [session.user.organizationId, session.user.id] : [session.user.organizationId];
  const result = await query(
    `SELECT o.id, o.name, o.stage, o.value, o.expected_close, o.notes, o.created_at, c.id AS client_id, c.name AS client_name, u.full_name AS owner_name
     FROM opportunities o LEFT JOIN clients c ON c.id = o.client_id LEFT JOIN users u ON u.id = o.owner_id
     WHERE o.organization_id = $1${ownershipClause} ORDER BY o.created_at DESC LIMIT 200`,
    parameters,
  );
  return NextResponse.json({ opportunities: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = opportunitySchema.parse(await request.json());
    if (body.clientId) {
      const client = await query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [body.clientId, session.user.organizationId]);
      if (!client.rows[0]) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }
    if (body.leadId) {
      const lead = await query('SELECT id FROM leads WHERE id = $1 AND organization_id = $2', [body.leadId, session.user.organizationId]);
      if (!lead.rows[0]) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }
    const result = await query(
      `INSERT INTO opportunities (organization_id, name, client_id, lead_id, value, expected_close, notes, owner_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, client_id, lead_id, stage, value, expected_close, notes, created_at`,
      [session.user.organizationId, body.name, body.clientId || null, body.leadId || null, body.value, body.expectedClose || null, body.notes, session.user.id],
    );
    return NextResponse.json({ opportunity: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Opportunity name and valid details are required.' }, { status: 400 });
    console.error('Opportunity create failed', error);
    return NextResponse.json({ error: 'Unable to create opportunity.' }, { status: 500 });
  }
}
