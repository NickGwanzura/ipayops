# Pinned to a specific Alpine release for reproducible builds; override with --build-arg NODE_IMAGE=... when upgrading.
ARG NODE_IMAGE=node:22-alpine3.22
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
# Keep the source layer explicit so a production rebuild cannot reuse an old
# compiled Next.js bundle when Dokploy's builder cache is warm.
COPY . /app/
RUN npm run typecheck
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ARG APP_VERSION=0.1.0
ARG DEPLOY_SHA=unknown
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV APP_VERSION=${APP_VERSION}
ENV DEPLOY_SHA=${DEPLOY_SHA}
# Production controls and all deployment-specific values must be supplied by
# Dokploy at runtime. Never bake organization identifiers or endpoints into
# the image; missing values must fail the environment contract explicitly.
RUN apk add --no-cache postgresql-client
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/db ./db
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pg/esm ./node_modules/pg/esm
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/bcryptjs ./node_modules/bcryptjs
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/sharp ./node_modules/sharp
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@img ./node_modules/@img
RUN mkdir -p /app/uploads && chown nextjs:nodejs /app/uploads
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT}/api/health?probe=live" || exit 1
# Set RUN_MIGRATIONS=false when migrations run as a separate release step (Dokploy pre-deploy command: node scripts/migrate.mjs).
CMD ["sh","-c","npm run check:env && { [ \"$RUN_MIGRATIONS\" = \"false\" ] || node scripts/migrate.mjs; } && exec node server.js"]
