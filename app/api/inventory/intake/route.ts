import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';
import { writeAuditLog } from '@/lib/audit';

const intakeSchema = z.object({ category: z.enum(['Laptop', 'POS']), productName: z.string().trim().min(2).max(160), sku: z.string().trim().min(2).max(80), location: z.string().trim().min(2).max(120), serialNumbers: z.array(z.string().trim().min(2).max(120)).min(1).max(500), notes: z.string().trim().max(500).optional().default('') });

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = intakeSchema.parse(await request.json());
    const normalizedSerials = body.serialNumbers.map(serial => serial.trim()).filter(Boolean);
    if (new Set(normalizedSerials.map(serial => serial.toLowerCase())).size !== normalizedSerials.length) return NextResponse.json({ error: 'Serial numbers must be unique.' }, { status: 400 });
    const result = await withTransaction(async client => {
      const duplicate = await client.query('SELECT serial_number FROM inventory_items WHERE organization_id = $1 AND lower(serial_number) = ANY($2::text[]) LIMIT 1', [session.user.organizationId, normalizedSerials.map(serial => serial.toLowerCase())]);
      if (duplicate.rows[0]) throw Object.assign(new Error(`Serial ${duplicate.rows[0].serial_number} already exists.`), { code: 'DUPLICATE_SERIAL' });
      const items = [];
      for (const serial of normalizedSerials) {
        const inserted = await client.query(`INSERT INTO inventory_items (organization_id, serial_number, sku, description, location, status) VALUES ($1, $2, $3, $4, $5, 'Available') RETURNING id, serial_number, sku, description, location, status`, [session.user.organizationId, serial, body.sku, `${body.category} · ${body.productName}`, body.location]);
        items.push(inserted.rows[0]);
      }
      return items;
    });
    await writeAuditLog({ organizationId: session.user.organizationId, actorUserId: session.user.id, action: 'inventory.received', entityType: 'inventory_items', metadata: { category: body.category, sku: body.sku, location: body.location, count: result.length, notes: body.notes } });
    return NextResponse.json({ received: result.length, items: result }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Choose Laptop or POS and provide product, location, and serial numbers.' }, { status: 400 });
    if ((error as { code?: string }).code === 'DUPLICATE_SERIAL') return NextResponse.json({ error: (error as Error).message }, { status: 409 });
    console.error('Inventory intake failed', error); return NextResponse.json({ error: 'Unable to receive serialized stock.' }, { status: 500 });
  }
}
