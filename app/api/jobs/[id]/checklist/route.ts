import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ACCESS, requireRole } from '@/lib/auth';
import { query } from '@/lib/db';

const checklistSchema = z.object({ items: z.array(z.object({ inventoryItemId: z.string().uuid(), checklist: z.array(z.object({ label: z.string().trim().min(1).max(200), done: z.boolean() })).max(50) })).min(1) });

export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const auth = await requireRole(request, ACCESS.jobWrite);
    if ('response' in auth) return auth.response;
    const { session } = auth;
    const body = checklistSchema.parse(await request.json());
    const result = await query('SELECT id FROM job_cards WHERE id = $1 AND organization_id = $2', [params.id, session.user.organizationId]);
    if (!result.rows[0]) return NextResponse.json({ error: 'Job card not found.' }, { status: 404 });
    for (const item of body.items) await query('UPDATE job_card_items SET checklist = $1 WHERE job_card_id = $2 AND inventory_item_id = $3', [JSON.stringify(item.checklist), params.id, item.inventoryItemId]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Checklist items are required.' }, { status: 400 });
    console.error('Job checklist update failed', error);
    return NextResponse.json({ error: 'Unable to update configuration checklist.' }, { status: 500 });
  }
}
