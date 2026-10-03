import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import pg from 'pg';

const { Pool } = pg;

if (Number(process.versions.node.split(".")[0]) < 20) throw new Error(`Integration harness requires Node 20 or newer; found ${process.versions.node}.`);
if (process.env.INTEGRATION_TEST_DATABASE !== 'true') throw new Error('Refusing to run integration tests without INTEGRATION_TEST_DATABASE=true.');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

function databaseIsSafe(value, label) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  const localHost = ['localhost', '127.0.0.1', '::1', 'postgres', 'db'].includes(host) || /(?:^|[-_.])(test|ci|uat|integration|local|dev)(?:[-_.]|$)/.test(host);
  const testDatabase = /(?:test|ci|uat|integration|local|dev)/.test(database);
  if (!localHost || !testDatabase) throw new Error(`Refusing ${label}: database target must clearly be local/test (host=${url.hostname}, database=${database}).`);
  return url;
}

const databaseUrl = databaseIsSafe(process.env.DATABASE_URL, 'DATABASE_URL');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
});

const orgAId = '11111111-1111-4111-8111-111111111111';
const orgBId = '22222222-2222-4222-8222-222222222222';
const runToken = (process.env.GITHUB_RUN_ID || process.env.INTEGRATION_RUN_ID || 'local').replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 24);
// Generate credentials only for this isolated test run. Never commit reusable
// UAT/demo passwords that could be mistaken for production credentials.
const password = `UAT-${randomBytes(24).toString('base64url')}`;
const invitationPassword = `UAT-${randomBytes(24).toString('base64url')}`;
const emails = {
  ceo: `luna.uat.ceo.${runToken}@example.test`,
  manager: `luna.uat.manager.${runToken}@example.test`,
  finance: `luna.uat.finance.${runToken}@example.test`,
  sales: `luna.uat.sales.${runToken}@example.test`,
  promotee: `luna.uat.promotee.${runToken}@example.test`,
  orgB: `luna.uat.orgb.${runToken}@example.test`,
};

let failures = 0;
let server;
let baseUrl;
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function pass(name) {
  console.log(`PASS ${name}`);
}

function fail(name, detail) {
  failures += 1;
  console.error(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
}

function expect(name, condition, detail = '') {
  if (condition) pass(name);
  else fail(name, detail || 'assertion failed');
  return Boolean(condition);
}

function must(name, condition, detail = '') {
  if (!expect(name, condition, detail)) throw new Error(`${name} failed${detail ? `: ${detail}` : ''}`);
}

function parseJson(text) {
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text }; }
}

class CookieJar {
  constructor() { this.values = new Map(); }

  absorb(response) {
    const headers = typeof response.headers.getSetCookie === 'function' && response.headers.getSetCookie().length
      ? response.headers.getSetCookie()
      : (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    for (const header of headers) {
      const first = header.split(';', 1)[0];
      const separator = first.indexOf('=');
      if (separator < 1) continue;
      const name = first.slice(0, separator);
      const value = first.slice(separator + 1);
      if (/max-age=0/i.test(header) || value === '') this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  has(name) { return this.values.has(name); }

  header() { return [...this.values].map(([name, value]) => `${name}=${value}`).join('; '); }
}

async function request(jar, method, path, body) {
  const headers = { 'user-agent': 'luna-high-integration-uat' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const cookie = jar?.header();
  if (cookie) headers.cookie = cookie;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  jar?.absorb(response);
  const text = await response.text();
  return { status: response.status, body: parseJson(text), headers: response.headers };
}

async function getUnusedPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

async function startServer() {
  const serverPath = fileURLToPath(new URL('../.next/standalone/server.js', import.meta.url));
  if (!existsSync(serverPath)) throw new Error('Missing .next/standalone/server.js; run npm run build first.');
  const port = Number(process.env.INTEGRATION_PORT || await getUnusedPort());
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [serverPath], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: String(port), NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on('data', chunk => process.stderr.write(`[server] ${chunk}`));
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Standalone server exited with code ${server.exitCode}.`);
    try {
      const response = await fetch(`${baseUrl}/api/health?probe=live`);
      if (response.status === 200) {
        pass('standalone server health');
        must('API health propagates a request correlation ID', requestIdPattern.test(response.headers.get('x-request-id') || ''));
        return;
      }
    } catch { /* server is still starting */ }
    await delay(500);
  }
  throw new Error('Timed out waiting for standalone server health.');
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  server.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    delay(5000),
  ]);
  if (server.exitCode === null) server.kill('SIGKILL');
}

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let buffer = 0;
  let bits = 0;
  const output = [];
  for (const character of value.replace(/[-=\s]/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid MFA manual key.');
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return Buffer.from(output);
}

function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

async function login(user, mfa = false) {
  const jar = new CookieJar();
  const loginResponse = await request(jar, 'POST', '/api/auth/login', { email: user.email, password });
  if (!mfa) {
    must(`${user.role} normal login`, loginResponse.status === 200 && !loginResponse.body.mfaRequired && !jar.has('ipaytech_mfa_challenge'), `status ${loginResponse.status}`);
    const session = await pool.query('SELECT mfa_assured FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [user.id]);
    must(`${user.role} normal session is not MFA assured`, session.rows[0]?.mfa_assured === false);
    return { jar, response: loginResponse };
  }
  must(`${user.role} first login requires MFA`, loginResponse.status === 202 && loginResponse.body.mfaRequired === true, `status ${loginResponse.status}`);
  must(`${user.role} HttpOnly MFA challenge cookie captured`, jar.has('ipaytech_mfa_challenge'));
  const challenge = await request(jar, 'GET', '/api/auth/mfa/challenge');
  must(`${user.role} MFA enrollment challenge exposes manual key`, challenge.status === 200 && challenge.body.kind === 'enroll' && typeof challenge.body.manualKey === 'string');
  const verified = await request(jar, 'POST', '/api/auth/mfa/challenge', { code: totp(challenge.body.manualKey) });
  must(`${user.role} MFA enrollment completes`, verified.status === 200 && Array.isArray(verified.body.recoveryCodes));
  must(`${user.role} enrollment returns 8 one-time recovery codes`, verified.body.recoveryCodes.length === 8);
  must(`${user.role} MFA enrollment captures session`, jar.has('ipaytech_session'));
  const session = await pool.query('SELECT mfa_assured FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [user.id]);
  must(`${user.role} MFA completion creates an assured session`, session.rows[0]?.mfa_assured === true);
  return { jar, response: verified, recoveryCodes: verified.body.recoveryCodes };
}

async function privilegedRecoveryLogin(user, recoveryCode, label) {
  const jar = new CookieJar();
  const loginResponse = await request(jar, 'POST', '/api/auth/login', { email: user.email, password });
  must(`${label} login requires a fresh MFA challenge`, loginResponse.status === 202 && loginResponse.body.mfaRequired === true);
  const challenge = await request(jar, 'GET', '/api/auth/mfa/challenge');
  must(`${label} challenge is verification`, challenge.status === 200 && challenge.body.kind === 'verify');
  const verified = await request(jar, 'POST', '/api/auth/mfa/challenge', { code: recoveryCode });
  return { jar, response: verified };
}

async function seed() {
  const hash = await bcrypt.hash(password, 12);
  const users = {
    ceo: { id: randomUUID(), organizationId: orgAId, email: emails.ceo, fullName: 'Luna UAT CEO', role: 'ceo' },
    manager: { id: randomUUID(), organizationId: orgAId, email: emails.manager, fullName: 'Luna UAT Manager', role: 'manager' },
    finance: { id: randomUUID(), organizationId: orgAId, email: emails.finance, fullName: 'Luna UAT Finance', role: 'finance' },
    sales: { id: randomUUID(), organizationId: orgAId, email: emails.sales, fullName: 'Luna UAT Sales', role: 'sales_consultant' },
    promotee: { id: randomUUID(), organizationId: orgAId, email: emails.promotee, fullName: 'Luna UAT Promotee', role: 'manager' },
    orgB: { id: randomUUID(), organizationId: orgBId, email: emails.orgB, fullName: 'Luna UAT Org B', role: 'manager' },
  };
  const clientASeedId = randomUUID();
  const clientBId = randomUUID();
  const foreignItemId = randomUUID();
  const warrantyItemId = randomUUID();
  const quoteItems = [randomUUID(), randomUUID()];
  const values = [
    [orgAId, 'Luna UAT Org A', `luna-uat-org-a-${runToken}`],
    [orgBId, 'Luna UAT Org B', `luna-uat-org-b-${runToken}`],
  ];
  await deleteIntegrationOrganizations([orgAId, orgBId]);
  for (const [id, name, slug] of values) await pool.query('INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)', [id, name, slug]);
  for (const user of Object.values(users)) {
    await pool.query('INSERT INTO users (id, organization_id, email, full_name, password_hash, role) VALUES ($1, $2, $3, $4, $5, $6)', [user.id, user.organizationId, user.email, user.fullName, hash, user.role]);
  }
  await pool.query('INSERT INTO clients (id, organization_id, code, name, email) VALUES ($1, $2, $3, $4, $5)', [clientASeedId, orgAId, `UAT-SEED-${runToken}`, 'Luna UAT Seed Client A', `seed-a.${runToken}@example.test`]);
  await pool.query('INSERT INTO clients (id, organization_id, code, name, email) VALUES ($1, $2, $3, $4, $5)', [clientBId, orgBId, `UAT-ORG-B-${runToken}`, 'Luna UAT Client B', `client-b.${runToken}@example.test`]);
  await pool.query(
    `INSERT INTO inventory_items (id, organization_id, serial_number, sku, description, location, status, client_name, cost_price, selling_price)
     VALUES
       ($1, $2, 'LUNA-UAT-FOREIGN-001', 'UAT-FOREIGN', 'Foreign serialized unit', 'UAT', 'Sold', 'Luna UAT Client B', 30, 90),
       ($3, $2, 'LUNA-UAT-WARRANTY-001', 'UAT-WARRANTY', 'Warranty serialized unit', 'UAT', 'Available', NULL, 25, 75)`,
    [foreignItemId, orgAId, warrantyItemId],
  );
  await pool.query('INSERT INTO inventory_items (organization_id, serial_number, sku, description, location, status, cost_price, selling_price) VALUES ($1, $2, $3, $4, $5, \'Available\', $6, $7), ($1, $8, $9, $10, $5, \'Available\', $11, $12)', [orgAId, 'LUNA-UAT-QUOTE-001', 'UAT-LINE-1', 'UAT serialized line one', 'UAT', 40, 100, 'LUNA-UAT-QUOTE-002', 'UAT-LINE-2', 'UAT serialized line two', 60, 100]);
  // Quotation lines must use catalogue SKUs, so seed the catalogue entries behind the quote units above.
  const seedSupplier = await pool.query('INSERT INTO suppliers (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id', [orgAId, `UAT-SEEDSUP-${runToken}`, 'Luna UAT Seed Supplier']);
  await pool.query("INSERT INTO supplier_products (organization_id, supplier_id, product_type, product_name, sku, warranty_months, unit_cost, cost_price, selling_price) VALUES ($1, $2, 'Laptop', 'UAT serialized line one', 'UAT-LINE-1', 12, 40, 40, 100), ($1, $2, 'Laptop', 'UAT serialized line two', 'UAT-LINE-2', 12, 40, 40, 100)", [orgAId, seedSupplier.rows[0].id]);
  const quoteInventory = await pool.query('SELECT id, serial_number, sku FROM inventory_items WHERE organization_id = $1 AND serial_number LIKE \'LUNA-UAT-QUOTE-%\' ORDER BY serial_number', [orgAId]);
  must('integration seed creates two serialized quotation units', quoteInventory.rows.length === 2);
  return { users, clientASeedId, clientBId, foreignItemId, warrantyItemId, quoteItems, quoteInventory: quoteInventory.rows };
}

async function runAssertions(data) {
  const ceo = await login(data.users.ceo, true);
  const manager = await login(data.users.manager);
  const finance = await login(data.users.finance, true);
  const sales = await login(data.users.sales);
  const promotee = await login(data.users.promotee);

  const legacySessionId = randomUUID();
  await pool.query('INSERT INTO sessions (id, user_id, mfa_assured, expires_at) VALUES ($1, $2, false, now() + interval \'1 hour\')', [legacySessionId, data.users.ceo.id]);
  const legacyToken = await new SignJWT({ sid: legacySessionId, org: data.users.ceo.organizationId, role: data.users.ceo.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(data.users.ceo.id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.AUTH_SECRET || ''));
  const legacyJar = new CookieJar();
  legacyJar.values.set('ipaytech_session', legacyToken);
  const legacyResponse = await request(legacyJar, 'GET', '/api/audit-logs');
  const removedLegacySession = await pool.query('SELECT id FROM sessions WHERE id = $1', [legacySessionId]);
  must('Pre-MFA privileged sessions are rejected and invalidated', legacyResponse.status === 401 && removedLegacySession.rows.length === 0);

  await pool.query("UPDATE users SET role = 'finance', updated_at = now() WHERE id = $1 AND organization_id = $2", [data.users.promotee.id, orgAId]);
  const promotedSession = await request(promotee.jar, 'GET', '/api/audit-logs');
  const invalidatedSessions = await pool.query('SELECT id FROM sessions WHERE user_id = $1', [data.users.promotee.id]);
  must('Role promotion invalidates a pre-MFA session before privileged access', promotedSession.status === 401 && invalidatedSessions.rows.length === 0);
  const promoted = await login({ ...data.users.promotee, role: 'finance' }, true);
  must('Promoted finance user must complete MFA before access', promoted.response.status === 200);
  await pool.query("UPDATE users SET role = 'manager', updated_at = now() WHERE id = $1 AND organization_id = $2", [data.users.promotee.id, orgAId]);

  const invitationToken = `luna-invite-${runToken}-${randomUUID()}`;
  await pool.query(
    `INSERT INTO user_invitations (organization_id, email, full_name, role, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, 'finance', $4, now() + interval '1 hour', $5)`,
    [orgAId, `luna.uat.invited.${runToken}@example.test`, 'Luna UAT Invited Finance', createHash('sha256').update(invitationToken).digest('hex'), data.users.ceo.id],
  );
  const invitationJar = new CookieJar();
  const invitationAccepted = await request(invitationJar, 'POST', `/api/auth/invitations/${encodeURIComponent(invitationToken)}`, { password: invitationPassword });
  must('Privileged invitation activation requires MFA and does not create a session', invitationAccepted.status === 202 && invitationAccepted.body.mfaRequired === true && !invitationJar.has('ipaytech_session'));
  must('Privileged invitation activation creates an MFA challenge', invitationJar.has('ipaytech_mfa_challenge'));
  const invitationChallenge = await request(invitationJar, 'GET', '/api/auth/mfa/challenge');
  must('Privileged invitation challenge is enrollment', invitationChallenge.status === 200 && invitationChallenge.body.kind === 'enroll' && typeof invitationChallenge.body.manualKey === 'string');
  const invitationVerified = await request(invitationJar, 'POST', '/api/auth/mfa/challenge', { code: totp(invitationChallenge.body.manualKey) });
  const invitationSession = await pool.query('SELECT mfa_assured FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1', [invitationAccepted.body.user.id]);
  must('Privileged invitation MFA completion creates the assured session', invitationVerified.status === 200 && invitationJar.has('ipaytech_session') && invitationSession.rows[0]?.mfa_assured === true);

  const ceoInvitationToken = `luna-ceo-invite-${runToken}-${randomUUID()}`;
  const ceoInvitation = await pool.query(
    `INSERT INTO user_invitations (organization_id, email, full_name, role, token_hash, expires_at, created_by)
     VALUES ($1, $2, $3, 'ceo', $4, now() + interval '1 hour', $5)
     RETURNING id`,
    [orgAId, `luna.uat.ceo.invited.${runToken}@example.test`, 'Luna UAT Invited CEO', createHash('sha256').update(ceoInvitationToken).digest('hex'), data.users.ceo.id],
  );
  const ceoInvitationId = ceoInvitation.rows[0].id;
  const managerResendCeoInvitation = await request(manager.jar, 'POST', `/api/hr/invitations/${ceoInvitationId}`);
  must('Manager cannot resend a CEO invitation', managerResendCeoInvitation.status === 403);
  const managerRevokeCeoInvitation = await request(manager.jar, 'DELETE', `/api/hr/invitations/${ceoInvitationId}`);
  must('Manager cannot revoke a CEO invitation', managerRevokeCeoInvitation.status === 403);

  const financeSecond = await privilegedRecoveryLogin(data.users.finance, finance.recoveryCodes[0], 'Finance later login');
  must('Finance recovery-code login succeeds once', financeSecond.response.status === 200);
  const ceoSecond = await privilegedRecoveryLogin(data.users.ceo, ceo.recoveryCodes[0], 'CEO later login');
  must('CEO recovery-code login succeeds once', ceoSecond.response.status === 200);
  const ceoReuse = await privilegedRecoveryLogin(data.users.ceo, ceo.recoveryCodes[0], 'CEO recovery-code reuse');
  must('reused CEO recovery code fails on a fresh challenge', ceoReuse.response.status === 401);

  const audit = await request(ceoSecond.jar, 'GET', '/api/audit-logs');
  must('CEO audit logs 200', audit.status === 200);
  const ceoBackups = await request(ceoSecond.jar, 'GET', '/api/backups');
  must('CEO backup history 200 for configured platform organization', ceoBackups.status === 200);
  const managerAudit = await request(manager.jar, 'GET', '/api/audit-logs');
  must('Manager audit logs 403', managerAudit.status === 403);
  const financeClient = await request(financeSecond.jar, 'POST', '/api/crm/clients', { code: `UAT-FIN-${runToken}`, name: 'Finance forbidden client' });
  must('Finance cannot create clients 403', financeClient.status === 403);
  const salesBackup = await request(sales.jar, 'GET', '/api/backups');
  must('Sales cannot access CEO backup 403', salesBackup.status === 403);
  const salesAudit = await request(sales.jar, 'GET', '/api/audit-logs');
  must('Sales cannot access CEO audit 403', salesAudit.status === 403);
  const supplier = await request(manager.jar, 'POST', '/api/suppliers', { code: `UAT-SUP-${runToken}`, name: 'Luna UAT Supplier' });
  must('Manager can use operational write endpoint', supplier.status === 201);

  const createdClient = await request(sales.jar, 'POST', '/api/crm/clients', { code: `UAT-CRM-${runToken}`, name: 'Luna UAT API Client', email: `crm.${runToken}@example.test` });
  must('Sales can create CRM client', createdClient.status === 201 && typeof createdClient.body.client?.id === 'string');
  const createdClientId = createdClient.body.client.id;
  const listedClients = await request(sales.jar, 'GET', '/api/crm/clients');
  must('Sales can list own CRM client', listedClients.status === 200 && listedClients.body.clients.some(item => item.id === createdClientId));
  must('Org A CRM listing excludes Org B client', listedClients.status === 200 && !listedClients.body.clients.some(item => item.id === data.clientBId));
  const foreignRead = await request(sales.jar, 'GET', `/api/crm/clients/${data.clientBId}/history`);
  must('Org A cannot read Org B client', foreignRead.status === 404);
  const foreignUpdate = await request(sales.jar, 'PATCH', `/api/crm/clients/${data.clientBId}`, { name: 'Tenant breach attempt' });
  must('Org A cannot update Org B client', foreignUpdate.status === 404);

  const auditRow = await pool.query(`SELECT action, entity_type, entity_id, organization_id FROM audit_logs WHERE action = 'db.insert' AND entity_type = 'clients' AND entity_id = $1 AND organization_id = $2`, [createdClientId, orgAId]);
  must('API-created client has atomic db.insert audit row', auditRow.rows.length === 1 && auditRow.rows[0].entity_id === createdClientId && auditRow.rows[0].organization_id === orgAId);

  const deleteProbe = await pool.query('INSERT INTO clients (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id', [orgAId, `UAT-DELETE-${runToken}`, 'UAT delete audit probe']);
  await pool.query('DELETE FROM clients WHERE id = $1 AND organization_id = $2', [deleteProbe.rows[0].id, orgAId]);
  const deleteAudit = await pool.query(`SELECT action, entity_type, entity_id, organization_id FROM audit_logs WHERE action = 'db.delete' AND entity_type = 'clients' AND entity_id = $1 AND organization_id = $2`, [deleteProbe.rows[0].id, orgAId]);
  must('Ordinary business delete has an atomic db.delete audit row', deleteAudit.rows.length === 1);

  const direct = await pool.connect();
  try {
    await direct.query('BEGIN');
    await direct.query(`SELECT set_config('app.organization_id', $1, true), set_config('app.actor_user_id', $2, true)`, [orgAId, data.users.ceo.id]);
    let sqlState = '';
    try { await direct.query('UPDATE clients SET name = $1 WHERE id = $2', ['blocked tenant mutation', data.clientBId]); }
    catch (error) { sqlState = error.code; }
    must('Direct DB tenant guard rejects cross-tenant mutation with SQLSTATE 42501', sqlState === '42501', `received ${sqlState || 'no error'}`);
    await direct.query('ROLLBACK');
  } finally { direct.release(); }

  const quote = await request(sales.jar, 'POST', '/api/crm/quotations', { clientId: createdClientId, items: [
    { sku: 'UAT-LINE-1', description: 'UAT serialized line one', quantity: 1, unitPrice: 100 },
    { sku: 'UAT-LINE-2', description: 'UAT serialized line two', quantity: 1, unitPrice: 100 },
  ] });
  must('Seeded two-line quotation can be created through API', quote.status === 201 && Number(quote.body.quotation?.total) === 200);
  const quoteId = quote.body.quotation.id;
  const lineRows = await pool.query('SELECT id, sku FROM quotation_items WHERE quotation_id = $1 ORDER BY created_at', [quoteId]);
  const inventoryBySku = new Map(data.quoteInventory.map(item => [item.sku, item]));
  const skuAssignments = lineRows.rows.map(line => ({ quotationItemId: line.id, inventoryItem: inventoryBySku.get(line.sku) }));
  must('Quotation inventory assignments resolve both lines by SKU', lineRows.rows.length === 2 && skuAssignments.every(item => item.inventoryItem?.id));
  const incomplete = await request(sales.jar, 'POST', `/api/crm/quotations/${quoteId}/convert`, { items: [{ quotationItemId: skuAssignments[0].quotationItemId, inventoryItemIds: [skuAssignments[0].inventoryItem.id] }] });
  must('Incomplete quotation conversion returns 409', incomplete.status === 409);
  const complete = await request(sales.jar, 'POST', `/api/crm/quotations/${quoteId}/convert`, { items: skuAssignments.map(item => ({ quotationItemId: item.quotationItemId, inventoryItemIds: [item.inventoryItem.id] })) });
  must('Complete quotation conversion returns 201', complete.status === 201);
  const saleId = complete.body.sale.id;
  must('Complete conversion total equals quotation lines', Number(complete.body.sale.total) === 200);
  const saleItems = await pool.query('SELECT id, inventory_item_id, amount FROM sale_items WHERE sale_id = $1 ORDER BY amount, id', [saleId]);
  must('Converted sale has two serialized sale items', saleItems.rows.length === 2);
  const tooLargeReturn = await request(sales.jar, 'POST', `/api/crm/sales/${saleId}/returns`, { reason: 'UAT amount invariant', refundAmount: 101, refundMethod: 'Credit note', items: [{ saleItemId: saleItems.rows[0].id, condition: 'Good' }] });
  must('Returned/refund amount exceeding selected item value returns 409', tooLargeReturn.status === 409);
  const partialReturn = await request(sales.jar, 'POST', `/api/crm/sales/${saleId}/returns`, { reason: 'UAT partial return', refundAmount: 100, refundMethod: 'Credit note', items: [{ saleItemId: saleItems.rows[0].id, condition: 'Good' }] });
  must('Valid partial return succeeds', partialReturn.status === 201);
  const saleState = await pool.query('SELECT status FROM sales WHERE id = $1', [saleId]);
  const retained = await pool.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(amount), 0) AS amount FROM sale_items WHERE sale_id = $1 AND returned = false', [saleId]);
  must('Profitability retains only the nonreturned unit', saleState.rows[0]?.status === 'Partially returned' && retained.rows[0].count === 1 && Number(retained.rows[0].amount) === 100);
  const profitability = await request(ceoSecond.jar, 'GET', '/api/dashboard/profitability?from=2020-01-01&to=2100-01-01');
  must('Profitability API reports only retained sale value', profitability.status === 200 && Number(profitability.body.summary?.revenue) === 100 && Number(profitability.body.summary?.units) === 1);

  const rule = await request(financeSecond.jar, 'POST', '/api/finance/commission-rules', { name: `UAT Confirmed ${runToken}`, rate: 10, triggerStatus: 'Confirmed' });
  must('Confirmed commission rule can be created', rule.status === 201);
  const firstRun = await request(financeSecond.jar, 'POST', '/api/finance/commissions/run', { ruleId: rule.body.rule.id });
  must('Commission run uses retained item value', firstRun.status === 201 && Number(firstRun.body.run.amount) === 10);
  const entry = await pool.query('SELECT id, amount FROM commission_entries WHERE sale_id = $1', [saleId]);
  must('Commission entry is created for sale', entry.rows.length === 1 && Number(entry.rows[0].amount) === 10);
  await pool.query(`UPDATE commission_entries SET status = 'Approved' WHERE id = $1`, [entry.rows[0].id]);
  const secondRun = await request(financeSecond.jar, 'POST', '/api/finance/commissions/run', { ruleId: rule.body.rule.id });
  const approvedEntry = await pool.query('SELECT amount, status FROM commission_entries WHERE id = $1', [entry.rows[0].id]);
  must('Rerunning commissions does not reset Approved entry', secondRun.status === 201 && Number(secondRun.body.run.amount) === 0 && approvedEntry.rows[0]?.status === 'Approved' && Number(approvedEntry.rows[0]?.amount) === 10);

  const invalidJob = await request(manager.jar, 'POST', '/api/jobs', { clientId: createdClientId, saleId, title: 'UAT invalid serialized installation', inventoryItemIds: [data.foreignItemId] });
  must('Job with serial outside selected sale/client returns 409', invalidJob.status === 409);

  const claim = await request(manager.jar, 'POST', '/api/warranty/claims', { inventoryItemId: data.warrantyItemId, issue: 'UAT warranty fault' });
  must('Warranty claim can be seeded through API', claim.status === 201);
  const requisition = await request(manager.jar, 'POST', `/api/warranty/claims/${claim.body.claim.id}/requisitions`, { description: 'UAT repair requisition', estimatedCost: 55 });
  const warrantyState = await pool.query(`SELECT wc.status, COUNT(rr.id)::int AS requisitions FROM warranty_claims wc LEFT JOIN repair_requisitions rr ON rr.claim_id = wc.id WHERE wc.id = $1 GROUP BY wc.status`, [claim.body.claim.id]);
  must('Warranty requisition commits requisition and Repair status atomically', requisition.status === 201 && warrantyState.rows[0]?.status === 'Repair' && warrantyState.rows[0]?.requisitions === 1);

  // ---- Workflow regression tests: stock intake, purchase orders, reservations, commissions, HR ----
  const intakeUnknown = await request(manager.jar, 'POST', '/api/inventory/intake', { category: 'Laptop', productName: 'Unlisted', sku: 'UAT-NOT-IN-CATALOGUE', location: 'UAT', serialNumbers: [`UAT-INTAKE-X-${runToken}`] });
  must('Stock intake rejects a SKU that is not in the product catalogue', intakeUnknown.status === 422);
  const intakeKnown = await request(manager.jar, 'POST', '/api/inventory/intake', { category: 'Laptop', productName: 'UAT serialized line one', sku: 'UAT-LINE-1', location: 'UAT', serialNumbers: [`UAT-INTAKE-1-${runToken}`] });
  const intakeRow = await pool.query('SELECT cost_price, selling_price, supplier_product_id FROM inventory_items WHERE serial_number = $1', [`UAT-INTAKE-1-${runToken}`]);
  must('Stock intake carries the catalogue cost and selling price', intakeKnown.status === 201 && Number(intakeRow.rows[0]?.cost_price) === 40 && Number(intakeRow.rows[0]?.selling_price) === 100 && Boolean(intakeRow.rows[0]?.supplier_product_id));

  const poSupplierId = supplier.body.supplier?.id;
  const poProduct = await request(manager.jar, 'POST', '/api/products', { supplierId: poSupplierId, productType: 'POS', productName: 'UAT PO device', sku: `UAT-PO-${runToken}`, warrantyMonths: 24, costPrice: 50, sellingPrice: 120 });
  must('Manager can add a catalogue product', poProduct.status === 201);
  const purchaseOrder = await request(manager.jar, 'POST', '/api/purchase-orders', { supplierId: poSupplierId, destination: 'UAT', items: [{ productId: poProduct.body.product?.id, quantity: 1, unitCost: 50 }] });
  must('Purchase order can be created', purchaseOrder.status === 201);
  const purchaseOrderId = purchaseOrder.body.purchaseOrder?.id;
  const poApprove = await request(ceoSecond.jar, 'POST', `/api/purchase-orders/${purchaseOrderId}/approve`);
  must('A different user can approve the purchase order', poApprove.status === 200);
  const poEdit = await request(manager.jar, 'PATCH', `/api/purchase-orders/${purchaseOrderId}`, { items: [{ productId: poProduct.body.product?.id, quantity: 5, unitCost: 1 }] });
  must('Approved purchase order lines cannot be edited', poEdit.status === 409);
  const poReopen = await request(manager.jar, 'PATCH', `/api/purchase-orders/${purchaseOrderId}`, { status: 'Draft' });
  must('Approved purchase order cannot be moved back to draft', poReopen.status === 409);
  await request(manager.jar, 'PATCH', `/api/products/${poProduct.body.product?.id}`, { costPrice: 999 });
  const poDetail = await request(manager.jar, 'GET', `/api/purchase-orders/${purchaseOrderId}`);
  const poReceive = await request(manager.jar, 'POST', `/api/purchase-orders/${purchaseOrderId}/receive`, { items: [{ purchaseOrderItemId: poDetail.body.purchaseOrder?.items?.[0]?.id, quantity: 1, serialNumbers: [`UAT-PO-SN-${runToken}`], location: 'UAT' }] });
  const poStock = await pool.query('SELECT cost_price FROM inventory_items WHERE serial_number = $1', [`UAT-PO-SN-${runToken}`]);
  must('Received stock is costed at the purchase-order price, not the later catalogue cost', poReceive.status === 201 && Number(poStock.rows[0]?.cost_price) === 50);

  const holdUnit = await pool.query(`INSERT INTO inventory_items (organization_id, serial_number, sku, description, location, status, cost_price, selling_price) VALUES ($1, $2, 'UAT-LINE-1', 'UAT hold unit', 'UAT', 'Available', 40, 100) RETURNING id`, [orgAId, `UAT-HOLD-${runToken}`]);
  const managerQuote = await request(manager.jar, 'POST', '/api/crm/quotations', { clientId: createdClientId, items: [{ sku: 'UAT-LINE-1', quantity: 1 }] });
  must('Free-typed catalogue SKU is priced from the catalogue', managerQuote.status === 201 && Number(managerQuote.body.quotation?.total) === 100);
  const belowCost = await request(sales.jar, 'POST', '/api/crm/quotations', { clientId: createdClientId, items: [{ sku: 'UAT-LINE-1', quantity: 1, unitPrice: 10 }] });
  must('A consultant cannot quote below cost', belowCost.status === 422);
  const salesQuote = await request(sales.jar, 'POST', '/api/crm/quotations', { clientId: createdClientId, items: [{ sku: 'UAT-LINE-1', quantity: 1 }] });
  must('Consultant can create a second quotation', salesQuote.status === 201);
  const hold = await request(manager.jar, 'POST', '/api/inventory/reservations', { inventoryItemId: holdUnit.rows[0].id, referenceType: 'quotation', referenceId: managerQuote.body.quotation?.number });
  must('Manager can reserve stock against a quotation by number', hold.status === 201);
  const salesQuoteLine = await pool.query('SELECT id FROM quotation_items WHERE quotation_id = $1', [salesQuote.body.quotation?.id]);
  const blockedConvert = await request(sales.jar, 'POST', `/api/crm/quotations/${salesQuote.body.quotation?.id}/convert`, { items: [{ quotationItemId: salesQuoteLine.rows[0]?.id, inventoryItemIds: [holdUnit.rows[0].id] }] });
  must('Stock held for another quotation cannot be sold by a consultant', blockedConvert.status === 409);
  await request(manager.jar, 'POST', `/api/inventory/reservations/${hold.body.reservation?.id}/release`);
  const freedConvert = await request(sales.jar, 'POST', `/api/crm/quotations/${salesQuote.body.quotation?.id}/convert`, { items: [{ quotationItemId: salesQuoteLine.rows[0]?.id, inventoryItemIds: [holdUnit.rows[0].id] }] });
  must('Released stock can be sold', freedConvert.status === 201);
  const secondSaleId = freedConvert.body.sale?.id;
  const secondInvoice = await request(sales.jar, 'POST', `/api/crm/sales/${secondSaleId}/invoice`);
  const secondInvoiceRow = await pool.query('SELECT id, due_at, total FROM invoices WHERE sale_id = $1', [secondSaleId]);
  must('New invoices get a due date from the payment terms', secondInvoice.status === 201 && secondInvoiceRow.rows[0]?.due_at !== null && Number(secondInvoiceRow.rows[0]?.total) === 100);
  const secondSaleItem = await pool.query('SELECT id FROM sale_items WHERE sale_id = $1', [secondSaleId]);
  const creditReturn = await request(sales.jar, 'POST', `/api/crm/sales/${secondSaleId}/returns`, { reason: 'UAT credit note return', refundAmount: 0, items: [{ saleItemId: secondSaleItem.rows[0]?.id, condition: 'Good' }] });
  const creditedInvoice = await pool.query('SELECT status, total FROM invoices WHERE id = $1', [secondInvoiceRow.rows[0]?.id]);
  const creditedReturn = await pool.query('SELECT id, credit_note_number FROM returns WHERE sale_id = $1', [secondSaleId]);
  must('A full return voids the unpaid invoice and issues a credit note', creditReturn.status === 201 && creditedInvoice.rows[0]?.status === 'Void' && Number(creditedInvoice.rows[0]?.total) === 0 && /^CN-/.test(creditedReturn.rows[0]?.credit_note_number || ''));
  const creditPdf = await request(sales.jar, 'GET', `/api/crm/returns/${creditedReturn.rows[0]?.id}/credit-note/pdf`);
  must('The credit note PDF can be downloaded', creditPdf.status === 200 && (creditPdf.headers.get('content-type') || '').includes('application/pdf'));


  await pool.query(`UPDATE commission_entries SET status = 'Paid' WHERE id = $1`, [entry.rows[0].id]);
  const recommission = await request(financeSecond.jar, 'POST', `/api/crm/sales/${saleId}/commission`, { rate: 50 });
  must('Recording commission again does not reopen a Paid entry', recommission.status === 409);
  const finalReturn = await request(sales.jar, 'POST', `/api/crm/sales/${saleId}/returns`, { reason: 'UAT final return', refundAmount: 0, items: [{ saleItemId: saleItems.rows[1].id, condition: 'Good' }] });
  const paidEntry = await pool.query('SELECT status, amount, clawback_amount FROM commission_entries WHERE id = $1', [entry.rows[0].id]);
  must('A return after payout records a clawback and leaves the paid amount untouched', finalReturn.status === 201 && paidEntry.rows[0]?.status === 'Paid' && Number(paidEntry.rows[0]?.amount) === 10 && Number(paidEntry.rows[0]?.clawback_amount) === 10);

  const takeover = await request(manager.jar, 'PATCH', `/api/hr/employees/${data.users.ceo.id}`, { email: `takeover.${runToken}@example.test` });
  must('A manager cannot edit a CEO account', takeover.status === 403);
  const leaverId = randomUUID();
  await pool.query(`INSERT INTO users (id, organization_id, email, full_name, password_hash, role) VALUES ($1, $2, $3, 'Luna UAT Leaver', 'not-a-real-hash', 'sales_consultant')`, [leaverId, orgAId, `leaver.${runToken}@example.test`]);
  await pool.query(`INSERT INTO opportunities (organization_id, name, client_id, owner_id) VALUES ($1, 'UAT leaver opportunity', $2, $3)`, [orgAId, createdClientId, leaverId]);
  await pool.query(`INSERT INTO quotations (organization_id, number, client_id, total, created_by) VALUES ($1, $2, $3, 0, $4)`, [orgAId, `QUO-LEAVER-${runToken}`, createdClientId, leaverId]);
  const offboard = await request(manager.jar, 'POST', `/api/hr/employees/${leaverId}/offboard`, { reassignToUserId: data.users.sales.id });
  const handover = await pool.query(`SELECT (SELECT owner_id FROM opportunities WHERE organization_id = $1 AND name = 'UAT leaver opportunity') AS opportunity_owner, (SELECT created_by FROM quotations WHERE number = $2) AS quote_owner, (SELECT is_active FROM users WHERE id = $3) AS active`, [orgAId, `QUO-LEAVER-${runToken}`, leaverId]);
  must('Offboarding hands the leaver\'s open opportunities and quotes to the chosen colleague', offboard.status === 200 && handover.rows[0]?.opportunity_owner === data.users.sales.id && handover.rows[0]?.quote_owner === data.users.sales.id && handover.rows[0]?.active === false);

  const consultantToken = `luna-sales-invite-${runToken}-${randomUUID()}`;
  await pool.query(`INSERT INTO user_invitations (organization_id, email, full_name, role, token_hash, expires_at, created_by) VALUES ($1, $2, 'Luna UAT New Consultant', 'sales_consultant', $3, now() + interval '1 hour', $4)`, [orgAId, `new.consultant.${runToken}@example.test`, createHash('sha256').update(consultantToken).digest('hex'), data.users.manager.id]);
  const consultantAccept = await request(new CookieJar(), 'POST', `/api/auth/invitations/${consultantToken}`, { password: `Consultant-${runToken}-Password!` });
  const consultantTasks = await pool.query(`SELECT COUNT(*)::int AS count FROM onboarding_tasks t JOIN users u ON u.id = t.user_id WHERE u.email = $1`, [`new.consultant.${runToken}@example.test`]);
  must('Accepting a sales-consultant invitation creates the default onboarding checklist', consultantAccept.status === 200 && consultantTasks.rows[0]?.count === 4);

  // ---- Global search and quotation reservations ----
  const searchSales = await request(sales.jar, 'GET', '/api/search?q=UAT');
  must('Search for a consultant never returns finance or procurement results', searchSales.status === 200 && searchSales.body.results.length > 0 && searchSales.body.results.every(hit => !['Invoice', 'Purchase order'].includes(hit.type)));
  const searchPo = await request(manager.jar, 'GET', `/api/search?q=${encodeURIComponent(purchaseOrder.body.purchaseOrder?.number)}`);
  must('A manager can find a purchase order by number', searchPo.status === 200 && searchPo.body.results.some(hit => hit.type === 'Purchase order'));
  const searchWildcard = await request(manager.jar, 'GET', '/api/search?q=%25%25');
  must('LIKE wildcards in search input are matched literally', searchWildcard.status === 200 && searchWildcard.body.results.length === 0);
  const searchAnonymous = await request(new CookieJar(), 'GET', '/api/search?q=UAT');
  must('Search requires a session', searchAnonymous.status === 401);

  const intakeUnit = await pool.query('SELECT id FROM inventory_items WHERE serial_number = $1', [`UAT-INTAKE-1-${runToken}`]);
  const reserveQuote = await request(sales.jar, 'POST', '/api/crm/quotations', { clientId: createdClientId, items: [{ sku: 'UAT-LINE-1', quantity: 1 }] });
  const reserveQuoteId = reserveQuote.body.quotation?.id;
  const reserveOk = await request(sales.jar, 'POST', `/api/crm/quotations/${reserveQuoteId}/reserve`, { inventoryItemIds: [intakeUnit.rows[0]?.id] });
  must('A consultant can reserve stock for their own quotation', reserveOk.status === 201 && reserveOk.body.reserved === 1);
  const reserveExtra = await request(sales.jar, 'POST', `/api/crm/quotations/${reserveQuoteId}/reserve`, { inventoryItemIds: [holdUnit.rows[0].id] });
  must('Stock that is not available cannot be reserved', reserveExtra.status === 409);
  const reserveHeld = await request(sales.jar, 'GET', `/api/crm/quotations/${reserveQuoteId}/reserve`);
  must('Held units for the quotation can be listed', reserveHeld.status === 200 && reserveHeld.body.reserved?.length === 1);
  const reserveRelease = await request(sales.jar, 'DELETE', `/api/crm/quotations/${reserveQuoteId}/reserve`);
  const reserveAfter = await request(sales.jar, 'GET', `/api/crm/quotations/${reserveQuoteId}/reserve`);
  const unitAfter = await pool.query('SELECT status FROM inventory_items WHERE id = $1', [intakeUnit.rows[0]?.id]);
  must('Releasing a quotation reservation frees the unit', reserveRelease.status === 200 && reserveAfter.body.reserved?.length === 0 && unitAfter.rows[0]?.status === 'Available');

  await pool.query('DELETE FROM organizations WHERE id = $1', [orgBId]);
  const cascadeState = await pool.query(`SELECT
    (SELECT COUNT(*)::int FROM organizations WHERE id = $1) AS organizations,
    (SELECT COUNT(*)::int FROM clients WHERE organization_id = $1) AS clients,
    (SELECT COUNT(*)::int FROM audit_logs WHERE organization_id = $1) AS audit_logs`, [orgBId]);
  must('Organization cascade delete completes without audit FK blocking', cascadeState.rows[0]?.organizations === 0 && cascadeState.rows[0]?.clients === 0 && cascadeState.rows[0]?.audit_logs === 0);
}

// Workflow rows (sales, returns, invoices, ...) reference each other without ON DELETE CASCADE, so deleting an
// organization directly fails. Delete the integration organizations' rows table by table, children before parents,
// using the live foreign-key graph. Tables without an organization_id are removed by cascade from their parent.
async function deleteIntegrationOrganizations(ids) {
  const tables = (await pool.query("SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organization_id' AND table_name <> 'organizations'")).rows.map(row => row.table_name);
  const known = new Set(tables);
  const foreignKeys = (await pool.query("SELECT conrelid::regclass::text AS child, confrelid::regclass::text AS parent, confdeltype AS action FROM pg_constraint WHERE contype = 'f'")).rows;
  // deleteBefore.get(x) = tables that must be emptied before x can be.
  const deleteBefore = new Map(tables.map(table => [table, new Set()]));
  const parentsByChild = new Map();
  for (const key of foreignKeys) {
    if (known.has(key.child) && known.has(key.parent) && key.child !== key.parent) deleteBefore.get(key.parent).add(key.child);
    if (!parentsByChild.has(key.child)) parentsByChild.set(key.child, []);
    parentsByChild.get(key.child).push(key);
  }
  // A table without organization_id is deleted by cascade from one parent while still referencing others.
  for (const [child, keys] of parentsByChild) {
    if (known.has(child)) continue;
    const cascading = keys.filter(key => key.action === 'c' && known.has(key.parent));
    const blocking = keys.filter(key => key.action !== 'c' && known.has(key.parent));
    for (const owner of cascading) for (const blocker of blocking) if (owner.parent !== blocker.parent) deleteBefore.get(blocker.parent).add(owner.parent);
  }
  // A table that references an organization-less table (e.g. inventory_items -> purchase_order_items) must be emptied
  // before the organization table that cascades into that organization-less table.
  const owners = table => {
    if (known.has(table)) return [table];
    return (parentsByChild.get(table) || []).filter(key => key.action === 'c').flatMap(key => owners(key.parent));
  };
  for (const key of foreignKeys) {
    if (!known.has(key.child) || known.has(key.parent)) continue;
    for (const owner of owners(key.parent)) if (owner !== key.child) deleteBefore.get(owner).add(key.child);
  }
  const remaining = new Set(tables);
  while (remaining.size) {
    const next = [...remaining].find(table => ![...deleteBefore.get(table)].some(other => remaining.has(other))) || [...remaining][0];
    await pool.query(`DELETE FROM "${next}" WHERE organization_id = ANY($1::uuid[])`, [ids]);
    remaining.delete(next);
  }
  await pool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [ids]);
}

async function cleanup() {
  await stopServer();
  await deleteIntegrationOrganizations([orgAId, orgBId]);
  await pool.end();
}

try {
  if (process.env.BACKUP_ADMIN_ORGANIZATION_ID && process.env.BACKUP_ADMIN_ORGANIZATION_ID.toLowerCase() !== orgAId) throw new Error('BACKUP_ADMIN_ORGANIZATION_ID must match the deterministic seeded platform organization.');
  await pool.query('SELECT 1');
  const data = await seed();
  pass('integration seed creates two organizations and six role-scoped users');
  await startServer();
  await runAssertions(data);
} catch (error) {
  fail('integration harness execution', error instanceof Error ? error.message : String(error));
} finally {
  try { await cleanup(); } catch (error) { fail('integration cleanup', error instanceof Error ? error.message : String(error)); }
}

if (failures) {
  console.error(`Integration UAT failed: ${failures} assertion(s).`);
  process.exit(1);
}
console.log('Integration UAT passed.');
