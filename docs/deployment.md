# Deployment runbook

## Local Docker Compose

```bash
docker compose -f docker-compose.dev.yml up --build
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
3. Set the application port to `3000`. Use `/api/health?probe=live` as the container liveness check (it never touches the database or storage, so a dependency outage cannot trigger restarts) and `/api/health` only for readiness or external uptime monitoring.
4. Configure the environment variables from `.env.example`; use a generated `AUTH_SECRET` of at least 32 characters, set `HEALTHCHECK_DATABASE=true` and `HEALTHCHECK_STORAGE=true`, use an HTTPS `APP_URL` and `ERROR_MONITORING_WEBHOOK_URL`, explicitly set `REQUIRE_PRIVILEGED_MFA=true` or `false`, and set `BACKUP_ADMIN_ORGANIZATION_ID` to the platform organization UUID that is allowed to view and request whole-database backups. These are required in production; they are never returned by the application.
5. Prefer running migrations as a Dokploy pre-deploy command (`node scripts/migrate.mjs`) and set `RUN_MIGRATIONS=false` on the application so replicas do not race at start-up. Run migrations as a single release step before starting multiple application replicas. The migration runner uses a PostgreSQL advisory lock, but only one migration-enabled container should be active during a release. Ensure Dokploy has `DATABASE_URL` configured; for a non-Docker deployment, run `npm run db:migrate` once before starting the app, then provision a manager or CEO with `npm run db:create-user`.
6. Set `STORAGE_DRIVER=s3`, configure all S3-compatible endpoint, bucket, region, and credential variables, and configure `RESEND_API_KEY` plus `EMAIL_FROM` before enabling production workflows. Generate `BACKUP_ENCRYPTION_KEY` with `openssl rand -hex 32`; keep it in the deployment secret store and never in the database or repository. `ERROR_MONITORING_WEBHOOK_URL` must be an HTTPS endpoint; telemetry contains only error class, request ID, revision, runtime/source, and timestamp. `npm run check:env` fails fast if any are missing.
   With `HEALTHCHECK_STORAGE=true`, `/api/health` performs an authenticated S3-compatible `HeadBucket`; production returns HTTP 503 when the configured bucket cannot be reached. Requests receive a generated or validated `x-request-id`, and the ID is also applied to database transaction context when a request reaches server auth/database code.
7. Build and release with provenance arguments, for example `docker build --build-arg APP_VERSION=2026.08.24 --build-arg DEPLOY_SHA=$(git rev-parse HEAD) -t ipaytech-ops .`. The image exposes these values to the runner as `APP_VERSION` and `DEPLOY_SHA`; do not pass secrets as build arguments. Run only one migration-enabled release container at a time when multiple replicas are configured.
8. Back up PostgreSQL before releases and test restore procedures separately. The CEO dashboard's encrypted backup control creates a full custom-format PostgreSQL dump, encrypts it with AES-256-GCM, and stores it under the private R2 bucket. The dashboard intentionally exposes status, size, checksum, and timestamps only; platform operations own restore access.

### Additional production settings

- `DATABASE_SSL=true` now verifies the server certificate. Provide `DATABASE_SSL_CA_FILE` (or `DATABASE_SSL_CA`), or set `DATABASE_SSL_REJECT_UNAUTHORIZED=false` only if you knowingly accept an unverifiable certificate.
- `TRUSTED_PROXY_HOPS` (default `1`) is the number of reverse proxies in front of the app. Client IPs for rate limiting and audit logs are read from the right of `X-Forwarded-For`, so forged values cannot evade limits. Use `2` behind Cloudflare plus Traefik.
- `MONITORING_INGEST_TOKEN` enables `POST /api/monitoring/errors`, which then requires `Authorization: Bearer <token>`. While unset the endpoint returns 404.
- `BACKUP_INTERVAL_HOURS` (default `24` in production, `0` disables) makes the background worker queue an encrypted backup when none has completed in that window. Restore a backup into a scratch database regularly with `npm run test:restore` equivalents; the `pg_dump` client in the image (Alpine 3.22, PostgreSQL 17) can dump PostgreSQL 16 and 17 servers.
- State-changing `/api/*` requests that carry a cross-site `Origin` header are rejected.
- Bootstrap: `npm run db:create-user` prints the organization ID; use it as `BACKUP_ADMIN_ORGANIZATION_ID`, which `check:env` requires before the first production start.
- Size the container for PDF generation, `sharp` image work and `pg_dump` (start with at least 1 GB of memory).

## Dokku PostgreSQL topology

Create and link the database from the Dokku host, then pass the resulting private `DATABASE_URL` to the Dokploy application. If the database is cross-host, require TLS and firewall allow-listing. Do not commit database credentials or expose PostgreSQL publicly.

## Backups and restore

The CEO dashboard backup module requires `STORAGE_DRIVER=s3`, the R2-compatible `S3_*` variables, `BACKUP_ENCRYPTION_KEY`, and the `backup_runs` migration. The application image includes `pg_dump` and `pg_restore`. Backups are written as the exact `[12-byte IV][ciphertext][16-byte GCM tag]` envelope and cannot be restored without the external encryption key. Keep an offline copy of the key and periodically perform a controlled restore test.

Use the platform's scheduled PostgreSQL backups. For a manual backup:

```bash
pg_dump "$DATABASE_URL" --format=custom --file=ipaytech-ops-$(date +%Y%m%d).dump
pg_restore --clean --if-exists --dbname="$DATABASE_URL" ipaytech-ops-YYYYMMDD.dump
```

## Authenticated integration and restore tests

CI runs the production-shaped test batch against an ephemeral PostgreSQL 16 service. It applies migrations, builds the standalone server, runs `npm run test:integration` with `INTEGRATION_TEST_DATABASE=true`, then creates a separate empty test database and runs `npm run test:restore` with `RESTORE_DRILL=true`. The harness uses deterministic test-only organizations and credentials, requires local/test-looking database targets, exercises privileged MFA enrollment and recovery-code reuse, checks tenant and database-trigger invariants, and removes only its two integration organizations on exit. `RESEND_API_KEY` is intentionally absent in this job so queued notifications become `not_configured` without sending email.

For a local isolated PostgreSQL test database, use equivalent test-only variables and never point these commands at a development or production database:

```bash
INTEGRATION_TEST_DATABASE=true NODE_ENV=production REQUIRE_PRIVILEGED_MFA=true HEALTHCHECK_DATABASE=true TRUST_PROXY=true npm run db:migrate
INTEGRATION_TEST_DATABASE=true NODE_ENV=production REQUIRE_PRIVILEGED_MFA=true HEALTHCHECK_DATABASE=true TRUST_PROXY=true npm run test:integration
RESTORE_DRILL=true npm run test:restore
```

The restore target must already exist, be empty, and use a different local/test database URL in `RESTORE_DATABASE_URL`. The drill uses `pg_dump --format=custom`, encrypts and decrypts the exact application envelope with `BACKUP_ENCRYPTION_KEY`, runs `pg_restore` on the decrypted artifact, verifies the migration count and required business tables, prints restore evidence, and removes its temporary dump directory.

## Release checklist

- Run `npm run check:env` with `NODE_ENV=production`.
- Confirm the production environment check fails when `REQUIRE_PRIVILEGED_MFA` is missing or invalid, then passes when it is explicitly set to `true` or `false`.
- Run `npm run typecheck`.
- Build the image with `docker build --build-arg APP_VERSION=<release-version> --build-arg DEPLOY_SHA=<source-commit> .`.
- Confirm `/api/health` returns `ok: true` and includes the expected `version` and `revision` values, for example `curl -fsS https://your-host.example/api/health`.
- Confirm a CEO from the configured platform organization can access backup history, while a CEO from another organization receives `403`; missing or invalid production backup authority configuration returns `503`.
- Confirm backups, object storage, and secret rotation are configured.
- Keep the current image and database backup available for rollback.

## Current release status

The application now uses PostgreSQL-backed domain workflows, session authentication, server-side role checks, organization scoping, transactional stock and sales operations, document generation, attachments, audit logging, and deployment migrations. Before going live, apply the migrations, configure private S3-compatible storage, enable the database health check, verify backups, and complete the production smoke suite.
