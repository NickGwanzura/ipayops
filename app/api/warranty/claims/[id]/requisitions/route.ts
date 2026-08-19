import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const requisitionSchema = z.object({ description: z.string().trim().min(3).max(300), estimatedCost: z.number().nonnegative().max(100000000) });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireRole(request, ACCESS.field);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = requisitionSchema.parse(await request.json());
    const claim = await query('SELECT id FROM warranty_claims WHERE id = $1 AND organization_id = $2', [params.id, session.user.organizationId]);
    if (!claim.rows[0]) return NextResponse.json({ error: 'Warranty claim not found.' }, { status: 404 });
    const number = `REQ-${new Date().getFullYear()}-${randomUUID().slice(0, 6).toUpperCase()}`;
    const result = await query(
      `INSERT INTO repair_requisitions (organization_id, number, claim_id, description, estimated_cost, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, number, status, description, estimated_cost, created_at`,
      [session.user.organizationId, number, params.id, body.description, body.estimatedCost, session.user.id],
    );
    await query(`UPDATE warranty_claims SET status = 'Repair', updated_at = now() WHERE id = $1`, [params.id]);
    return NextResponse.json({ requisition: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Repair description and estimated cost are required.' }, { status: 400 });
    console.error('Repair requisition failed', error);
    return NextResponse.json({ error: 'Unable to create repair requisition.' }, { status: 500 });
  }
}
