# syntax=docker/dockerfile:1
#
# Built from the monorepo ROOT as build context (`docker build -f apps/web/Dockerfile .`)
# so `turbo prune` can see the whole workspace graph.

FROM node:24-alpine AS base
RUN npm install -g pnpm@12.5.1

# ---------------------------------------------------------------------------
# pruner — turbo prune keeps the build context to exactly what @orbit/web needs
# ---------------------------------------------------------------------------
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @orbit/web --docker

# ---------------------------------------------------------------------------
# deps — install node_modules once and reuse across stages
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
# --ignore-scripts: the pruned json layer includes @orbit/api's package.json
# too (packages/api-types depends on it for the AppType import), and its
# postinstall `prisma generate` has no schema file at this stage — nothing
# in @orbit/web's own build needs any install-time script to run anyway.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# builder — build the standalone Next.js output. No Prisma anywhere in this
# image — @orbit/web has no DB access at all since the Phase 2 auth cutover.
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
ENV NEXT_TELEMETRY_DISABLED=1
# @orbit/web imports @orbit/api-types, whose only export re-exports
# @orbit/api's AppType — a type-only import, but `next build`'s type check
# still resolves the whole reachable source graph, which means @orbit/api's
# generated Prisma client has to exist even though @orbit/web itself never
# touches a database. Same placeholder-DATABASE_URL trick @orbit/api's own
# Dockerfile uses — this never connects, prisma generate is purely static.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm --filter @orbit/api exec prisma generate
# Baked in at build time — Next.js inlines NEXT_PUBLIC_* into the client
# bundle, so this can't be a runtime env var like everything apps/api reads.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter @orbit/web build

# ---------------------------------------------------------------------------
# runner — minimal production image
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat curl
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

COPY --from=builder /app/apps/web/public ./apps/web/public
# The standalone server bundles only traced files; static assets are copied separately.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
