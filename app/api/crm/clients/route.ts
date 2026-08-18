import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

const clientSchema = z.object({
  code: z.string().trim().min(2).max(40).optional(),
  name: z.string().trim().min(2).max(160),
  clientType: z.enum(['Person', 'Organisation']).optional().default('Organisation'),
  contactName: z.string().trim().max(160).optional().default(''),
  email: z.string().trim().email().max(200).optional().or(z.literal('')).default(''),
  phone: z.string().trim().max(60).optional().default(''),
  address: z.string().trim().max(300).optional().default(''),
});

export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const search = request.nextUrl.searchParams.get('q')?.trim().toLowerCase() || '';
  const result = await query(
    `SELECT id, code, name, client_type, contact_name, email, phone, address, status, created_at, updated_at
     FROM clients WHERE organization_id = $1 AND ($2 = '' OR lower(name) LIKE '%' || $2 || '%' OR lower(code) LIKE '%' || $2 || '%')
     ORDER BY name`,
    [session.user.organizationId, search],
  );
  return NextResponse.json({ clients: result.rows });
}

export async function POST(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
    const body = clientSchema.parse(await request.json());
    const code = body.code || `CLI-${Date.now().toString().slice(-6)}`;
    const result = await query(
      `INSERT INTO clients (organization_id, code, name, client_type, contact_name, email, phone, address)
       VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), $7, $8)
       RETURNING id, code, name, client_type, contact_name, email, phone, address, status, created_at`,
      [session.user.organizationId, code, body.name, body.clientType, body.contactName, body.email, body.phone, body.address],
    );
    return NextResponse.json({ client: result.rows[0] }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Client name and valid contact details are required.' }, { status: 400 });
    if ((error as { code?: string }).code === '23505') return NextResponse.json({ error: 'Client code already exists.' }, { status: 409 });
    console.error('Client create failed', error);
    return NextResponse.json({ error: 'Unable to create client.' }, { status: 500 });
  }
}
