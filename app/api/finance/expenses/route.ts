import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, getSession, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';
import { notifyOrganizationRoles, sendNotification } from '@/lib/notifications';
import { writeAuditLog } from '@/lib/audit';

const expenseSchema = z.object({
  category: z.string().trim().min(2).max(80),
  description: z.string().trim().min(2).max(240),
  amount: z.number().positive().max(100000000),
  inventoryItemId: z.string().uuid().optional(),
  replacementItemId: z.string().uuid().optional(),
  repairRequisitionId: z.string().uuid().optional(),
  serialNumber: z.string().trim().min(2).max(160).optional(),
});

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.finance);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const status = request.nextUrl.searchParams.get('status');
  const result = await query(
    `SELECT e.id, e.number, e.category, e.description, e.amount, e.currency, e.status, e.submitted_at,
            e.approved_at, e.paid_at, e.inventory_item_id, e.replacement_item_id, e.repair_requisition_id, e.serial_number_snapshot,
            ii.serial_number, ii.sku, ii.product_type, u.full_name AS submitter_name, a.full_name AS approver_name,
            COUNT(att.id)::int AS attachment_count
     FROM expense_claims e
     JOIN users u ON u.id = e.submitter_id
     LEFT JOIN inventory_items ii ON ii.id = e.inventory_item_id
     LEFT JOIN users a ON a.id = e.approved_by
     LEFT JOIN attachments att ON att.entity_id = e.id AND att.entity_type = 'expense'
     WHERE e.organization_id = $1 AND ($2::text IS NULL OR e.status = $2)
     GROUP BY e.id, u.full_name, a.full_name, ii.serial_number, ii.sku, ii.product_type
     ORDER BY e.created_at DESC LIMIT 200`,
    [session.user.organizationId, status || null],
  );
  return NextResponse.json({ expenses: result.rows });
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.expenseSubmitter);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = expenseSchema.parse(await request.json());
    const asset = body.serialNumber ? (await query(`SELECT id, serial_number FROM inventory_items WHERE organization_id = $1 AND lower(serial_number) = lower($2)`, [session.user.organizationId, body.serialNumber])).rows[0] : body.inventoryItemId ? (await query(`SELECT id, serial_number FROM inventory_items WHERE organization_id = $1 AND id = $2`, [session.user.organizationId, body.inventoryItemId])).rows[0] : null;
    if ((body.serialNumber || body.inventoryItemId) && !asset) return NextResponse.json({ error: 'The affected serial number or inventory item was not found.' }, { status: 404 });
    if (body.serialNumber && body.inventoryItemId && asset && asset.id !== body.inventoryItemId) return NextResponse.json({ error: 'Serial number does not match the selected inventory item.' }, { status: 400 });
    if (body.replacementItemId) {
      const replacement = await query(`SELECT ri.id, ri.replacement_inventory_item_id, ii.serial_number FROM replacement_items ri JOIN inventory_items ii ON ii.id = ri.replacement_inventory_item_id WHERE ri.id = $1 AND ri.organization_id = $2`, [body.replacementItemId, session.user.organizationId]);
      if (!replacement.rows[0]) return NextResponse.json({ error: 'Replacement record not found.' }, { status: 404 });
      if (asset && asset.id !== replacement.rows[0].replacement_inventory_item_id) return NextResponse.json({ error: 'Expense serial must match the replacement serial.' }, { status: 400 });
    }
    if (body.repairRequisitionId) {
      const requisition = await query(`SELECT id, inventory_item_id FROM repair_requisitions WHERE id = $1 AND organization_id = $2`, [body.repairRequisitionId, session.user.organizationId]);
      if (!requisition.rows[0]) return NextResponse.json({ error: 'Repair requisition not found.' }, { status: 404 });
      if (asset && asset.id !== requisition.rows[0].inventory_item_id) return NextResponse.json({ error: 'Expense serial must match the repair requisition asset.' }, { status: 400 });
    }
    const result = await query(
      `INSERT INTO expense_claims (organization_id, number, submitter_id, category, description, amount, inventory_item_id, replacement_item_id, repair_requisition_id, serial_number_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, number, category, description, amount, currency, status, submitted_at`,
      [session.user.organizationId, `EXP-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`, session.user.id, body.category, body.description, body.amount, asset?.id || null, body.replacementItemId || null, body.repairRequisitionId || null, asset?.serial_number || body.serialNumber || null],
    );
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'expense.submitted', entityType: 'expense', entityId: result.rows[0].id, metadata: { number: result.rows[0].number, serialNumber: asset?.serial_number || body.serialNumber || null }, request });
    void Promise.all([
      sendNotification({ organizationId: session.user.organizationId, eventType: 'expense.submitted', recipientEmail: session.user.email, recipientName: session.user.fullName, subject: `Expense ${result.rows[0].number} submitted`, eyebrow: 'Finance activity', title: 'Expense claim submitted', summary: 'Your expense claim has been recorded and is awaiting finance review.', fields: [{ label: 'Expense', value: result.rows[0].number }, { label: 'Description', value: result.rows[0].description }, { label: 'Amount', value: String(result.rows[0].amount) }] }),
      notifyOrganizationRoles({ organizationId: session.user.organizationId, roles: ['ceo', 'manager', 'finance'], excludeUserId: session.user.id, eventType: 'expense.submitted', subject: `Expense ${result.rows[0].number} requires review`, eyebrow: 'Approval required', title: 'New expense claim', summary: `${session.user.fullName} submitted an expense claim for review.`, fields: [{ label: 'Expense', value: result.rows[0].number }, { label: 'Amount', value: String(result.rows[0].amount) }, { label: 'Serial', value: asset?.serial_number || body.serialNumber || 'Not linked' }] }),
    ]);
    return NextResponse.json({ expense: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Category, description, and a positive amount are required.' }, { status: 400 });
    console.error('Expense create failed', error);
    return NextResponse.json({ error: 'Unable to submit expense.' }, { status: 500 });
  }
}
