import pg from 'pg';

const { Pool } = pg;

const confirmation = process.env.WIPE_DEMO_BUSINESS_DATA;
if (confirmation !== 'WIPE_BUSINESS_DATA_CONFIRM') {
  throw new Error('Refusing to wipe data. Set WIPE_DEMO_BUSINESS_DATA=WIPE_BUSINESS_DATA_CONFIRM.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

// Deliberately excludes organizations, users, sessions, settings, locations,
// audit logs, backups, migrations, and all authentication tables.
const businessTables = [
  'invoice_payments', 'invoice_items', 'delivery_note_items', 'commission_entries',
  'expense_claims', 'return_items', 'returns', 'sale_items', 'sales',
  'delivery_notes', 'invoices', 'quotation_items', 'quotations', 'opportunities',
  'leads', 'clients', 'job_card_items', 'job_cards', 'warranty_claims',
  'warranty_contracts', 'repair_requisitions', 'replacement_items',
  'inventory_reservations', 'stock_transfer_items', 'stock_transfers', 'shipments',
  'goods_receipt_items', 'goods_receipts', 'purchase_order_items', 'purchase_orders',
  'inventory_items', 'supplier_products', 'suppliers', 'commission_rules',
  'consultant_targets', 'attachments', 'onboarding_tasks', 'employee_lifecycle_events',
  'user_invitations', 'notification_deliveries',
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const client = await pool.connect();
try {
  const existing = await client.query(
    `SELECT relname
       FROM pg_class
      WHERE relkind = 'r' AND relname = ANY($1::text[])
      ORDER BY relname`,
    [businessTables],
  );
  const tables = existing.rows.map(row => row.relname);
  if (!tables.length) throw new Error('No business tables found; refusing to continue.');

  await client.query('BEGIN');
  await client.query(`TRUNCATE TABLE ${tables.map(table => `public.${table}`).join(', ')} RESTART IDENTITY CASCADE`);
  await client.query('COMMIT');
  console.log(`Wiped ${tables.length} business tables. Users, organizations, settings, audit logs, and backups were preserved.`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
