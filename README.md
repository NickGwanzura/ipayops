# iPayTech Ops

iPayTech Ops is a PostgreSQL-backed operations console for serialized POS and laptop inventory, procurement, sales, jobs, warranty service, finance, HR, and reporting.

The repository contains the responsive dashboard and operations workspace, role-specific dashboards, serial traceability UI, warranty checker, transactional workflows, PDF/CSV/XLSX exports, PostgreSQL migrations, session authentication, server-side RBAC, audit logging, a production Dockerfile, Compose topology, and deployment runbook.

The active role model is CEO, Manager, Finance, and Sales Consultant. CEO has full oversight; Managers control people, onboarding, stock, and commission settings; Finance controls payments, debtors, expenses, refunds, and settlement; Sales Consultants work CRM, pre-sales, sales, assigned jobs, and personal commission views. Migration `011_rbac_role_model.sql` consolidates legacy roles.

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000` or `http://localhost:3000/operations`. Health: `http://localhost:3000/api/health`.

## Docker development stack

```bash
docker compose up --build
```

This starts the app and PostgreSQL on a persistent named volume. The container applies PostgreSQL migrations before starting the application.

## Production image

```bash
cp .env.example .env
# Set NODE_ENV=production, DATABASE_URL, HTTPS APP_URL, a strong AUTH_SECRET,
# HEALTHCHECK_DATABASE=true, TRUST_PROXY=true, Resend email variables,
# BACKUP_ENCRYPTION_KEY, and STORAGE_DRIVER=s3 with all S3_* variables.
npm run check:env
docker build -t ipaytech-ops .
docker run --env-file .env -p 3000:3000 ipaytech-ops
```

The image uses Next standalone output, runs as a non-root user, listens on the platform `PORT`, and exposes `/api/health` for liveness checks.

## Environment

See [.env.example](./.env.example). Production requires `DATABASE_URL`, `AUTH_SECRET`, HTTPS `APP_URL`, `HEALTHCHECK_DATABASE=true`, `TRUST_PROXY=true`, Resend email configuration, a 64-hex-character `BACKUP_ENCRYPTION_KEY`, and S3-compatible variables with `STORAGE_DRIVER=s3`. Production uploads must not use local storage.

## Deployment

See [docs/deployment.md](./docs/deployment.md) for Dokploy, Dokku PostgreSQL, backups, restore, and release steps.

## Verification

```bash
npm run typecheck
npm run check:env
npm run test:smoke
```

## Product decisions

- Default timezone: `Africa/Harare`.
- Default reporting currency: `USD`.
- Serial numbers are the inventory source of truth.
- Stock-changing workflows are transactional and organization-scoped.
- Production uploads should use private S3-compatible storage with signed access URLs.
