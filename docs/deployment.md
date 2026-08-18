# Deployment runbook

## Local Docker Compose

```bash
docker compose up --build
curl http://localhost:3000/api/health
```

The local stack starts the Next.js container and PostgreSQL with a named persistent volume. Apply the SQL migrations before creating the first user.

```bash
npm run db:migrate
ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='use-a-strong-password' npm run db:create-user
```

## Dokploy

1. Create a PostgreSQL database service and keep it on the private Dokploy network.
2. Create an Application from the repository and use the repository root as the build context.
3. Set the application port to `3000` and health check path to `/api/health`.
4. Configure the environment variables from `.env.example`; use a generated `AUTH_SECRET` of at least 32 characters.
5. Apply migrations once per release using `npm run db:migrate`, then provision an administrator with `npm run db:create-user`.
6. Set `STORAGE_DRIVER=s3` and configure the S3-compatible endpoint before enabling production uploads.
7. Build and release with `docker build -t ipaytech-ops .`; do not run destructive database migrations automatically from every replica.
8. Back up PostgreSQL before releases and test restore procedures separately.

## Dokku PostgreSQL topology

Create and link the database from the Dokku host, then pass the resulting private `DATABASE_URL` to the Dokploy application. If the database is cross-host, require TLS and firewall allow-listing. Do not commit database credentials or expose PostgreSQL publicly.

## Backups and restore

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

## Current limitation

The repository now has the first PostgreSQL and session-authentication foundation. Domain tables, server-side RBAC enforcement, and persistent business workflows still need to be added before handling real customer, inventory, or financial data.
