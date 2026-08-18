# iPayTech Ops

iPayTech Ops is an operations console for serialized POS and laptop inventory, procurement, sales, jobs, warranty service, finance, HR, and reporting.

The repository contains the responsive dashboard and operations workspace, typed local records, serial traceability UI, warranty checker, workflow panels, PDF/CSV/XLSX exports, a production Dockerfile, Compose topology, and deployment runbook. It is not yet safe for real customer or financial data because Prisma persistence, authentication, and server-side RBAC are still pending.

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

This starts the app and PostgreSQL on a persistent named volume. The current UI still reads typed local records; the database is ready for the Prisma integration.

## Production image

```bash
cp .env.example .env
# Set NODE_ENV=production, DATABASE_URL, APP_URL, and a strong AUTH_SECRET.
npm run check:env
docker build -t ipaytech-ops .
docker run --env-file .env -p 3000:3000 ipaytech-ops
```

The image uses Next standalone output, runs as a non-root user, listens on the platform `PORT`, and exposes `/api/health` for liveness checks.

## Environment

See [.env.example](./.env.example). Production requires `DATABASE_URL`, `AUTH_SECRET`, and `APP_URL`. Production uploads should use `STORAGE_DRIVER=s3`; local storage is development-only.

## Deployment

See [docs/deployment.md](./docs/deployment.md) for Dokploy, Dokku PostgreSQL, backups, restore, and release steps.

## Verification

```bash
npm run typecheck
npm run check:env
```

## Product decisions

- Default timezone: `Africa/Harare`.
- Default reporting currency: `USD`.
- Serial numbers are the inventory source of truth.
- Stock-changing workflows should be transactional and append-only once Prisma services are enabled.
- Production uploads should use private S3-compatible storage with signed access URLs.
