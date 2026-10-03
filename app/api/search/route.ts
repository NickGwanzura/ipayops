import { NextRequest, NextResponse } from 'next/server';
import { ACCESS, getSession, hasRole } from '@/lib/auth';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

type Hit = { id: string; type: string; title: string; detail: string; href: string };
const PER_GROUP = 5;

/** Escapes LIKE wildcards so user input is matched literally. */
function likePattern(term: string) {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function href(module: string, view: string | null, term: string) {
  const params = new URLSearchParams({ module });
  if (view) params.set('view', view);
  params.set('q', term);
  return `/operations?${params.toString()}`;
}

/**
 * Cross-module search for the command palette. Every group applies the same role and ownership rules as the
 * module's own list endpoint, so a result is never shown to someone who could not open it.
 */
export async function GET(request: NextRequest) {
  const session = await getSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthenticated.' }, { status: 401 });
  const term = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 80);
  if (term.length < 2) return NextResponse.json({ results: [] });
  const { role, organizationId, id: userId } = session.user;
  const pattern = likePattern(term);
  const consultantId = role === 'sales_consultant' ? userId : null;
  const hits: Hit[] = [];

  try {
    const jobs: Array<Promise<void>> = [];
    if (hasRole(role, ACCESS.sales)) {
      jobs.push(
        query(
          `SELECT id, name, code, email, phone FROM clients
           WHERE organization_id = $1 AND (name ILIKE $2 OR code ILIKE $2 OR email ILIKE $2 OR phone ILIKE $2)
           ORDER BY name LIMIT ${PER_GROUP}`,
          [organizationId, pattern],
        ).then((result) => {
          for (const row of result.rows)
            hits.push({
              id: row.id,
              type: 'Client',
              title: row.name,
              detail: [row.code, row.email || row.phone].filter(Boolean).join(' · '),
              href: href('Sales & CRM', 'clients', term),
            });
        }),
        query(
          `SELECT q.id, q.number, q.status, c.name AS client_name FROM quotations q JOIN clients c ON c.id = q.client_id
           WHERE q.organization_id = $1 AND ($3::uuid IS NULL OR q.created_by = $3) AND (q.number ILIKE $2 OR c.name ILIKE $2)
           ORDER BY q.created_at DESC LIMIT ${PER_GROUP}`,
          [organizationId, pattern, consultantId],
        ).then((result) => {
          for (const row of result.rows)
            hits.push({
              id: row.id,
              type: 'Quotation',
              title: row.number,
              detail: `${row.client_name} · ${row.status}`,
              href: href('Sales & CRM', 'sales', term),
            });
        }),
        query(
          `SELECT s.id, s.number, s.status, c.name AS client_name FROM sales s JOIN clients c ON c.id = s.client_id
           WHERE s.organization_id = $1 AND ($3::uuid IS NULL OR s.consultant_id = $3 OR s.created_by = $3)
             AND (s.number ILIKE $2 OR c.name ILIKE $2 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.serial_number ILIKE $2))
           ORDER BY s.created_at DESC LIMIT ${PER_GROUP}`,
          [organizationId, pattern, consultantId],
        ).then((result) => {
          for (const row of result.rows)
            hits.push({
              id: row.id,
              type: 'Sale',
              title: row.number,
              detail: `${row.client_name} · ${row.status}`,
              href: href('Sales & CRM', 'sales', term),
            });
        }),
      );
    }
    if (hasRole(role, ACCESS.inventoryRead)) {
      jobs.push(
        query(
          `SELECT id, serial_number, sku, description, status, location FROM inventory_items
           WHERE organization_id = $1 AND (serial_number ILIKE $2 OR sku ILIKE $2 OR description ILIKE $2)
           ORDER BY received_at DESC LIMIT ${PER_GROUP}`,
          [organizationId, pattern],
        ).then((result) => {
          for (const row of result.rows)
            hits.push({
              id: row.id,
              type: 'Serial',
              title: row.serial_number,
              detail: `${row.description} · ${row.status}${row.location ? ` · ${row.location}` : ''}`,
              href: href('Inventory', null, term),
            });
        }),
      );
    }
    if (hasRole(role, ACCESS.financeRead)) {
      jobs.push(
        query(
          `SELECT i.id, i.number, i.status, c.name AS client_name FROM invoices i JOIN clients c ON c.id = i.client_id
           WHERE i.organization_id = $1 AND (i.number ILIKE $2 OR c.name ILIKE $2)
           ORDER BY i.created_at DESC LIMIT ${PER_GROUP}`,
          [organizationId, pattern],
        ).then((result) => {
          for (const row of result.rows)
            hits.push({
              id: row.id,
              type: 'Invoice',
              title: row.number,
              detail: `${row.client_name} · ${row.status}`,
              href: href('Finance & HR', 'invoices', term),
            });
        }),
      );
    }
    if (hasRole(role, ACCESS.operations)) {
      jobs.push(
        query(
          `SELECT po.id, po.number, po.status, s.name AS supplier_name FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
           WHERE po.organization_id = $1 AND (po.number ILIKE $2 OR s.name ILIKE $2)
           ORDER BY po.created_at DESC LIMIT ${PER_GROUP}`,
          [organizationId, pattern],
        ).then((result) => {
          for (const row of result.rows)
            hits.push({
              id: row.id,
              type: 'Purchase order',
              title: row.number,
              detail: `${row.supplier_name} · ${row.status}`,
              href: href('Procurement', 'purchase-orders', term),
            });
        }),
      );
    }
    await Promise.all(jobs);
    const order = ['Client', 'Quotation', 'Sale', 'Invoice', 'Serial', 'Purchase order'];
    hits.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    return NextResponse.json({ results: hits });
  } catch (error) {
    console.error('Search failed', error);
    return NextResponse.json({ error: 'Search is unavailable.' }, { status: 500 });
  }
}
