import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { withTransaction } from '@/lib/db';

const requisitionSchema = z.object({ description: z.string().trim().min(3).max(300), estimatedCost: z.number().nonnegative().max(100000000) });

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.serviceRead);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = requisitionSchema.parse(await request.json());
    const requisition = await withTransaction(async client => {
      const claim = await client.query(
        `SELECT id, inventory_item_id, status
         FROM warranty_claims
         WHERE id = $1 AND organization_id = $2
         FOR UPDATE`,
        [params.id, session.user.organizationId],
      );
      if (!claim.rows[0]) throw Object.assign(new Error('Warranty claim not found.'), { code: 'CLAIM_NOT_FOUND' });
      if (['Rejected', 'Replacement', 'Resolved'].includes(claim.rows[0].status)) {
        throw Object.assign(new Error('Warranty claim is not eligible for a repair requisition.'), { code: 'CLAIM_NOT_ACTIONABLE' });
      }
      const number = `REQ-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
      const result = await client.query(
        `INSERT INTO repair_requisitions (organization_id, number, claim_id, inventory_item_id, description, estimated_cost, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, number, status, description, estimated_cost, inventory_item_id, created_at`,
        [session.user.organizationId, number, params.id, claim.rows[0].inventory_item_id, body.description, body.estimatedCost, session.user.id],
      );
      await client.query(
        `UPDATE warranty_claims SET status = 'Repair', updated_at = now() WHERE id = $1 AND organization_id = $2`,
        [params.id, session.user.organizationId],
      );
      return result.rows[0];
    });
    return NextResponse.json({ requisition }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Repair description and estimated cost are required.' }, { status: 400 });
    const code = (error as { code?: string }).code;
    if (code === 'CLAIM_NOT_FOUND') return NextResponse.json({ error: 'Warranty claim not found.' }, { status: 404 });
    if (code === 'CLAIM_NOT_ACTIONABLE') return NextResponse.json({ error: 'Warranty claim is not eligible for a repair requisition.' }, { status: 409 });
    console.error('Repair requisition failed', error);
    return NextResponse.json({ error: 'Unable to create repair requisition.' }, { status: 500 });
  }
}
