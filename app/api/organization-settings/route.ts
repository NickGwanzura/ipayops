import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  try {
    await query('INSERT INTO organization_settings (organization_id) VALUES ($1) ON CONFLICT (organization_id) DO NOTHING', [session.user.organizationId]);
    const result = await query(
      `SELECT timezone, currency, date_format, address, phone FROM organization_settings WHERE organization_id = $1`,
      [session.user.organizationId],
    );
    return NextResponse.json({ settings: result.rows[0] });
  } catch (error) {
    console.error('Organization settings lookup failed', error);
    return NextResponse.json({ error: 'Unable to load organization settings.' }, { status: 500 });
  }
}
