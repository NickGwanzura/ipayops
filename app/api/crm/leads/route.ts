import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { notifyOrganizationRoles, sendNotification } from '@/lib/notifications';

const leadSchema = z.object({ name: z.string().trim().min(2).max(160), clientId: z.string().uuid().optional(), source: z.string().trim().max(100).optional().default(''), notes: z.string().trim().max(500).optional().default('') });

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.sales);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const ownershipClause = session.user.role === 'sales_consultant' ? ' AND l.owner_id = $2' : '';
  const parameters = session.user.role === 'sales_consultant' ? [session.user.organizationId, session.user.id] : [session.user.organizationId];
  const result = await query(
    `SELECT l.id, l.name, l.source, l.status, l.notes, l.created_at, c.id AS client_id, c.name AS client_name, u.full_name AS owner_name
     FROM leads l LEFT JOIN clients c ON c.id = l.client_id LEFT JOIN users u ON u.id = l.owner_id
     WHERE l.organization_id = $1${ownershipClause} ORDER BY l.created_at DESC LIMIT 200`,
    parameters,
  );
  return NextResponse.json({ leads: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.sales);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = leadSchema.parse(await request.json());
    if (body.clientId) {
      const client = await query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [body.clientId, session.user.organizationId]);
      if (!client.rows[0]) return NextResponse.json({ error: 'Client not found.' }, { status: 404 });
    }
    const result = await query(
      `INSERT INTO leads (organization_id, name, client_id, source, notes, owner_id) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, client_id, source, status, notes, created_at`,
      [session.user.organizationId, body.name, body.clientId || null, body.source, body.notes, session.user.id],
    );
    const lead = result.rows[0];
    await Promise.all([
      sendNotification({ organizationId: session.user.organizationId, eventType: 'lead.created', recipientEmail: session.user.email, recipientName: session.user.fullName, subject: `New pre-sale lead: ${lead.name}`, eyebrow: 'Sales & CRM', title: 'New pre-sale lead', summary: 'A new lead has been added to the pre-sales workflow.', fields: [{ label: 'Lead', value: lead.name }, { label: 'Source', value: lead.source || 'Not specified' }, { label: 'Owner', value: session.user.fullName }], action: { label: 'Open Sales & CRM', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Sales%20%26%20CRM` } }),
      notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager'], excludeUserId: session.user.id, eventType: 'lead.created', subject: `New pre-sale lead: ${lead.name}`, eyebrow: 'Pre-sales oversight', title: 'New lead requires follow-up', summary: `${session.user.fullName} added a new lead to the pre-sales pipeline.`, fields: [{ label: 'Lead', value: lead.name }, { label: 'Source', value: lead.source || 'Not specified' }], action: { label: 'Open Sales & CRM', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Sales%20%26%20CRM` } }),
    ]);
    return NextResponse.json({ lead: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Lead name and valid details are required.' }, { status: 400 });
    console.error('Lead create failed', error);
    return NextResponse.json({ error: 'Unable to create lead.' }, { status: 500 });
  }
}
