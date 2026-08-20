import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { notifyOrganizationRoles, sendNotification } from '@/lib/notifications';

const jobSchema = z.object({
  clientId: z.string().uuid(), saleId: z.string().uuid().optional(), title: z.string().trim().min(2).max(180),
  installerId: z.string().uuid().optional(), scheduledFor: z.string().datetime().optional(), notes: z.string().trim().max(500).optional().default(''),
  inventoryItemIds: z.array(z.string().uuid()).max(200).optional().default([]),
});

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.jobRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const assignmentClause = session.user.role === 'sales_consultant' ? ' AND j.installer_id = $2' : '';
  const parameters = session.user.role === 'sales_consultant' ? [session.user.organizationId, session.user.id] : [session.user.organizationId];
  const result = await query(
    `SELECT j.id, j.number, j.title, j.status, j.scheduled_for, j.notes, j.signoff_name, j.signed_at,
            c.id AS client_id, c.name AS client_name, u.full_name AS installer_name,
            COALESCE(json_agg(json_build_object('id', jci.inventory_item_id, 'serialNumber', jci.serial_number, 'checklist', jci.checklist)
              ORDER BY jci.serial_number) FILTER (WHERE jci.id IS NOT NULL), '[]'::json) AS items
     FROM job_cards j JOIN clients c ON c.id = j.client_id LEFT JOIN users u ON u.id = j.installer_id
     LEFT JOIN job_card_items jci ON jci.job_card_id = j.id
     WHERE j.organization_id = $1${assignmentClause} GROUP BY j.id, c.id, u.id ORDER BY j.scheduled_for NULLS LAST, j.created_at DESC LIMIT 200`,
    parameters,
  );
  return NextResponse.json({ jobs: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.jobWrite);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = jobSchema.parse(await request.json());
    const job = await withTransaction(async client => {
      const clientResult = await client.query('SELECT id FROM clients WHERE id = $1 AND organization_id = $2', [body.clientId, session.user.organizationId]);
      if (!clientResult.rows[0]) throw Object.assign(new Error('Client not found.'), { code: 'CLIENT_NOT_FOUND' });
      if (body.saleId) {
        const saleResult = await client.query('SELECT id, client_id FROM sales WHERE id = $1 AND organization_id = $2', [body.saleId, session.user.organizationId]);
        if (!saleResult.rows[0]) throw Object.assign(new Error('Sale not found.'), { code: 'SALE_NOT_FOUND' });
        if (saleResult.rows[0].client_id !== body.clientId) throw Object.assign(new Error('Sale client mismatch.'), { code: 'SALE_CLIENT_MISMATCH' });
      }
      if (body.installerId) {
        const installerResult = await client.query(`SELECT id FROM users WHERE id = $1 AND organization_id = $2 AND is_active = true AND role IN ('sales_consultant', 'manager', 'ceo')`, [body.installerId, session.user.organizationId]);
        if (!installerResult.rows[0]) throw Object.assign(new Error('Installer not found.'), { code: 'INSTALLER_NOT_FOUND' });
      }
      const inventory = body.inventoryItemIds.length ? await client.query(
        `SELECT id, serial_number, status FROM inventory_items WHERE organization_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [session.user.organizationId, body.inventoryItemIds],
      ) : { rows: [] };
      if (inventory.rows.length !== new Set(body.inventoryItemIds).size) throw Object.assign(new Error('Inventory item not found.'), { code: 'ITEM_NOT_FOUND' });
      if (inventory.rows.some(item => !['Sold', 'Reserved', 'Available'].includes(item.status))) throw Object.assign(new Error('Inventory item cannot be installed.'), { code: 'ITEM_UNAVAILABLE' });
      const number = `JOB-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO job_cards (organization_id, number, client_id, sale_id, title, installer_id, scheduled_for, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, number, title, status, scheduled_for, created_at`,
        [session.user.organizationId, number, body.clientId, body.saleId || null, body.title, body.installerId || null, body.scheduledFor || null, body.notes, session.user.id],
      );
      for (const item of inventory.rows) {
        await client.query(`INSERT INTO job_card_items (job_card_id, inventory_item_id, serial_number) VALUES ($1, $2, $3)`, [result.rows[0].id, item.id, item.serial_number]);
        await client.query(`UPDATE inventory_items SET status = 'Installed', client_name = (SELECT name FROM clients WHERE id = $1), updated_at = now() WHERE id = $2`, [body.clientId, item.id]);
      }
      return result.rows[0];
    });
    const installer = body.installerId ? await query<{ email: string; full_name: string }>('SELECT email, full_name FROM users WHERE id = $1 AND organization_id = $2', [body.installerId, session.user.organizationId]) : { rows: [] as Array<{ email: string; full_name: string }> };
    void Promise.all([
      installer.rows[0] ? sendNotification({ organizationId: session.user.organizationId, eventType: 'job.assigned', recipientEmail: installer.rows[0].email, recipientName: installer.rows[0].full_name, subject: `Job ${job.number} assigned`, eyebrow: 'Job cards', title: 'New job card assigned', summary: 'A new installation job card has been assigned to you.', fields: [{ label: 'Job', value: job.number }, { label: 'Title', value: job.title }, { label: 'Scheduled', value: job.scheduled_for ? new Date(job.scheduled_for).toLocaleString('en-GB') : 'Not scheduled' }], action: { label: 'Open job cards', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Job%20cards` } }) : Promise.resolve(),
      notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager'], excludeUserId: session.user.id, eventType: 'job.assigned', subject: `New job card ${job.number}`, eyebrow: 'Job-card oversight', title: 'New job card created', summary: `${session.user.fullName} created a new job card for installation tracking.`, fields: [{ label: 'Job', value: job.number }, { label: 'Title', value: job.title }, { label: 'Scheduled', value: job.scheduled_for ? new Date(job.scheduled_for).toLocaleString('en-GB') : 'Not scheduled' }], action: { label: 'Open job cards', url: `${process.env.APP_URL || 'https://ipaytechops.com'}/operations?module=Job%20cards` } }),
    ]);
    return NextResponse.json({ job }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Client, title, and valid job details are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'CLIENT_NOT_FOUND' || code === 'ITEM_NOT_FOUND' || code === 'SALE_NOT_FOUND' || code === 'INSTALLER_NOT_FOUND') return NextResponse.json({ error: 'Client, sale, installer, or inventory item not found.' }, { status: 404 });
    if (code === 'SALE_CLIENT_MISMATCH') return NextResponse.json({ error: 'The selected sale belongs to a different client.' }, { status: 409 });
    if (code === 'ITEM_UNAVAILABLE') return NextResponse.json({ error: 'One or more inventory items cannot be installed.' }, { status: 409 });
    console.error('Job create failed', error);
    return NextResponse.json({ error: 'Unable to create job card.' }, { status: 500 });
  }
}
