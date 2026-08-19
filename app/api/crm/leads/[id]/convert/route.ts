import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { ACCESS, requireRole } from '@/lib/auth';
import { query, withTransaction } from '@/lib/db';

export async function POST(request: Request, { params }: { params: { id: string } }) {
    const auth = await requireRole(request, ACCESS.operations);
    if ('response' in auth) return auth.response;
    const { session } = auth;
  try {
    const result = await withTransaction(async client => {
      const lead = await client.query('SELECT id, name, client_id, owner_id, status FROM leads WHERE id = $1 AND organization_id = $2 FOR UPDATE', [params.id, session.user.organizationId]);
      if (!lead.rows[0]) throw Object.assign(new Error('Lead not found.'), { code: 'NOT_FOUND' });
      if (lead.rows[0].status === 'Converted') throw Object.assign(new Error('Lead already converted.'), { code: 'CONVERTED' });
      const opportunity = await client.query(
        `INSERT INTO opportunities (organization_id, name, client_id, lead_id, owner_id, notes)
         VALUES ($1, $2, $3, $4, COALESCE($5, $6), $7)
         RETURNING id, name, stage, value, client_id, lead_id`,
        [session.user.organizationId, lead.rows[0].name, lead.rows[0].client_id, params.id, lead.rows[0].owner_id, session.user.id, `Converted from lead ${lead.rows[0].name}`],
      );
      await client.query(`UPDATE leads SET status = 'Converted', updated_at = now() WHERE id = $1`, [params.id]);
      return opportunity.rows[0];
    });
    return NextResponse.json({ opportunity: result }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    if (code === 'CONVERTED') return NextResponse.json({ error: 'Lead is already converted.' }, { status: 409 });
    console.error('Lead conversion failed', error);
    return NextResponse.json({ error: 'Unable to convert lead.' }, { status: 500 });
  }
}
