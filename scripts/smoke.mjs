const baseUrl = process.env.SMOKE_BASE_URL || process.env.APP_URL || 'http://localhost:3001';

const checks = [
  { name: 'health endpoint', method: 'GET', path: '/api/health', expected: 200 },
  { name: 'login page', method: 'GET', path: '/login', expected: 200 },
  { name: 'login security headers', method: 'GET', path: '/login', expected: 200, headers: ['x-content-type-options', 'x-frame-options', 'referrer-policy'] },
  ...[
    '/api/auth/me', '/api/organization-settings', '/api/audit-logs', '/api/dashboard/summary', '/api/inventory',
    '/api/inventory/summary', '/api/purchase-orders', '/api/suppliers', '/api/crm/clients',
    '/api/crm/leads', '/api/crm/opportunities', '/api/crm/quotations', '/api/crm/sales',
    '/api/crm/invoices', '/api/crm/delivery-notes', '/api/jobs', '/api/warranty/claims',
    '/api/finance/expenses', '/api/finance/targets', '/api/hr/employees',
    '/api/reports/summary?from=2026-01-01&to=2026-12-31',
  ].map(path => ({ name: `protected ${path}`, method: 'GET', path, expected: 401 })),
  ...[
    ['/api/attachments', 'POST'],
    ['/api/purchase-orders', 'POST'],
    ['/api/inventory/transfers', 'POST'],
    ['/api/finance/expenses', 'POST'],
    ['/api/hr/employees', 'POST'],
    ['/api/warranty/claims', 'POST'],
  ].map(([path, method]) => ({ name: `protected ${method} ${path}`, method, path, expected: 401 })),
];

let failures = 0;
for (const check of checks) {
  try {
    const response = await fetch(`${baseUrl}${check.path}`, { method: check.method, redirect: 'manual' });
    const missingHeader = (check.headers || []).find(header => !response.headers.has(header));
    if (response.status !== check.expected || missingHeader) {
      failures += 1;
      console.error(`FAIL ${check.name}: status ${response.status}, expected ${check.expected}${missingHeader ? `, missing ${missingHeader}` : ''}`);
    } else {
      console.log(`PASS ${check.name}`);
    }
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${check.name}: ${error instanceof Error ? error.message : error}`);
  }
}

if (failures) {
  console.error(`Smoke checks failed: ${failures}`);
  process.exit(1);
}
console.log(`Smoke checks passed: ${checks.length}`);
