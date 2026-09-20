# syntax=docker/dockerfile:1
#
# Built from the monorepo ROOT as build context (`docker build -f apps/api/Dockerfile .`)
# so `turbo prune` can see the whole workspace graph.

FROM node:24-alpine AS base
# A global npm install, not `corepack enable`: corepack's shim re-resolves
# and lazily downloads its cached package from the npm registry on first
# invocation by a *different* user than the one that ran `corepack prepare`
# (its cache lives under that user's home directory) — the runner stage
# switches to a non-root user, which silently triggered a network fetch at
# container startup. A plain global install has no such per-user cache.
RUN npm install -g pnpm@12.5.1

# ---------------------------------------------------------------------------
# pruner — turbo prune keeps the build context to exactly what @orbit/api needs
# ---------------------------------------------------------------------------
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @orbit/api --docker

# ---------------------------------------------------------------------------
# deps — install node_modules once and reuse across stages
# ---------------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=pruner /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
# --ignore-scripts skips apps/api's postinstall `prisma generate`; the schema
# is not copied yet and generation happens explicitly in the stages that need it.
RUN pnpm install --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# builder — generate the Prisma client and typecheck the source
# ---------------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/ .
# `prisma generate` never connects to the database, but prisma.config.ts still
# resolves DATABASE_URL, so a placeholder is enough at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm --filter @orbit/api exec prisma generate
RUN pnpm --filter @orbit/api build

# ---------------------------------------------------------------------------
# migrator — one-shot container that applies migrations and seeds
# ---------------------------------------------------------------------------
FROM base AS migrator
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
COPY --from=deps /app/ .
COPY --from=pruner /app/out/full/apps/api/prisma ./apps/api/prisma
COPY --from=pruner /app/out/full/apps/api/prisma.config.ts ./apps/api/prisma.config.ts
COPY --from=builder /app/apps/api/src/lib/generated ./apps/api/src/lib/generated
WORKDIR /app/apps/api
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm exec prisma db seed"]

# ---------------------------------------------------------------------------
# runner — minimal production image, runs the API via tsx (no separate JS
# bundle step yet — the source is plain ESM/TS, tsx's startup cost is a few
# hundred ms, acceptable for a single long-lived server process; revisit with
# a real esbuild bundle only if cold-start time ever actually matters here)
# ---------------------------------------------------------------------------
FROM base AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat curl
ENV NODE_ENV=production
ENV PORT=4000

RUN addgroup --system --gid 1001 orbit \
  && adduser --system --uid 1001 orbit

COPY --from=deps --chown=orbit:orbit /app/ .
COPY --from=pruner --chown=orbit:orbit /app/out/full/ .
COPY --from=builder --chown=orbit:orbit /app/apps/api/src/lib/generated ./apps/api/src/lib/generated

USER orbit
WORKDIR /app/apps/api
EXPOSE 4000
CMD ["pnpm", "exec", "tsx", "src/server.ts"]
