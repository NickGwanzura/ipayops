import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireRole(request, ACCESS.inventoryRead);
  if ('response' in auth) return auth.response;
  const { session } = auth;
  const result = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE status = 'Available')::int AS available,
            COUNT(*) FILTER (WHERE status = 'Reserved')::int AS reserved,
            COUNT(*) FILTER (WHERE status = 'In transit')::int AS in_transit,
            COUNT(*) FILTER (WHERE status = 'Sold')::int AS sold,
            COUNT(*) FILTER (WHERE status = 'Installed')::int AS installed,
            COUNT(*) FILTER (WHERE status = 'Warranty')::int AS warranty
     FROM inventory_items WHERE organization_id = $1`,
    [session.user.organizationId],
  );
  return NextResponse.json({ summary: result.rows[0] });
}
