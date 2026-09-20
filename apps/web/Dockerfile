# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# deps — install node_modules once and reuse across stages
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
# --ignore-scripts skips the postinstall `prisma generate`; the schema is not
# copied yet and generation happens explicitly in the stages that need it.
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# builder — generate the Prisma client and build the standalone Next.js output
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `prisma generate` never connects to the database, but prisma.config.ts still
# resolves DATABASE_URL, so a placeholder is enough at build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# migrator — one-shot container that applies migrations and seeds
# ---------------------------------------------------------------------------
FROM node:24-alpine AS migrator
WORKDIR /app
RUN apk add --no-cache libc6-compat
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
COPY --from=builder /app/lib/generated ./lib/generated
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

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

COPY --from=builder /app/public ./public
# The standalone server bundles only traced files; static assets are copied separately.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
