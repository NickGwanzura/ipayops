import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const fullName = process.env.ADMIN_NAME?.trim() || 'System Administrator';
const role = process.env.ADMIN_ROLE?.trim().toLowerCase() || 'admin';
const allowedRoles = new Set(['ceo', 'admin', 'manager', 'operator', 'finance', 'hr', 'installer', 'viewer']);
if (!process.env.DATABASE_URL || !email || !password) throw new Error('DATABASE_URL, ADMIN_EMAIL, and ADMIN_PASSWORD are required.');
if (password.length < 8) throw new Error('ADMIN_PASSWORD must be at least 8 characters.');
if (!allowedRoles.has(role)) throw new Error(`ADMIN_ROLE must be one of: ${[...allowedRoles].join(', ')}.`);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
try {
  const organization = await pool.query(`INSERT INTO organizations (name, slug) VALUES ('iPayTech Ops', 'ipaytech-ops') ON CONFLICT (slug) DO UPDATE SET updated_at = now() RETURNING id`);
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (organization_id, email, full_name, password_hash, role)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ((lower(email))) DO UPDATE SET full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, is_active = true, updated_at = now()`,
    [organization.rows[0].id, email, fullName, hash, role],
  );
  console.log(`Provisioned ${email}`);
} finally {
  await pool.end();
}
