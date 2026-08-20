# Deployment runbook

## Local Docker Compose

```bash
docker compose up --build
curl http://localhost:3000/api/health
```

The local stack starts the Next.js container and PostgreSQL with a named persistent volume. Apply the SQL migrations before creating the first user.

```bash
npm run db:migrate
ADMIN_EMAIL=manager@example.com ADMIN_PASSWORD='use-a-strong-password' ADMIN_ROLE=manager npm run db:create-user
```

## Dokploy

1. Create a PostgreSQL database service and keep it on the private Dokploy network.
2. Create an Application from the repository and use the repository root as the build context.
3. Set the application port to `3000` and health check path to `/api/health`.
4. Configure the environment variables from `.env.example`; use a generated `AUTH_SECRET` of at least 32 characters, set `HEALTHCHECK_DATABASE=true`, and use an HTTPS `APP_URL`.
5. Run migrations as a single release step before starting multiple application replicas. The migration runner uses a PostgreSQL advisory lock, but only one migration-enabled container should be active during a release. Ensure Dokploy has `DATABASE_URL` configured; for a non-Docker deployment, run `npm run db:migrate` once before starting the app, then provision a manager or CEO with `npm run db:create-user`.
6. Set `STORAGE_DRIVER=s3`, configure all S3-compatible endpoint, bucket, region, and credential variables, and configure `RESEND_API_KEY` plus `EMAIL_FROM` before enabling production workflows. Generate `BACKUP_ENCRYPTION_KEY` with `openssl rand -hex 32`; keep it in the deployment secret store and never in the database or repository. `npm run check:env` fails fast if any are missing.
7. Build and release with `docker build -t ipaytech-ops .`. Run only one migration-enabled release container at a time when multiple replicas are configured.
8. Back up PostgreSQL before releases and test restore procedures separately. The CEO dashboard's encrypted backup control creates a full custom-format PostgreSQL dump, encrypts it with AES-256-GCM, and stores it under the private R2 bucket. The dashboard intentionally exposes status, size, checksum, and timestamps only; platform operations own restore access.

## Dokku PostgreSQL topology

Create and link the database from the Dokku host, then pass the resulting private `DATABASE_URL` to the Dokploy application. If the database is cross-host, require TLS and firewall allow-listing. Do not commit database credentials or expose PostgreSQL publicly.

## Backups and restore

The CEO dashboard backup module requires `STORAGE_DRIVER=s3`, the R2-compatible `S3_*` variables, `BACKUP_ENCRYPTION_KEY`, and the `backup_runs` migration. The application image includes `pg_dump` and `pg_restore`. Backups are written as `<iv><encrypted pg_dump><auth tag>` and cannot be restored without the external encryption key. Keep an offline copy of the key and periodically perform a controlled restore test.

Use the platform's scheduled PostgreSQL backups. For a manual backup:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=ipaytech-ops-$(date +%Y%m%d).dump
pg_restore --clean --if-exists --dbname="$DATABASE_URL" ipaytech-ops-YYYYMMDD.dump
```

## Release checklist

- Run `npm run check:env` with `NODE_ENV=production`.
- Run `npm run typecheck`.
- Build the image with `docker build .`.
- Confirm `/api/health` returns `ok: true`.
- Confirm backups, object storage, and secret rotation are configured.
- Keep the current image and database backup available for rollback.

## Current release status

The application now uses PostgreSQL-backed domain workflows, session authentication, server-side role checks, organization scoping, transactional stock and sales operations, document generation, attachments, audit logging, and deployment migrations. Before going live, apply the migrations, configure private S3-compatible storage, enable the database health check, verify backups, and complete the production smoke suite.
