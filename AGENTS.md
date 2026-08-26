<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Orbit

Personal/couple finance app. Next.js 16 App Router, PostgreSQL 17, Prisma 7, Auth.js v5, Vitest. Technical text and code stay English; Czech is reserved for user-facing copy.

## Setup and checks

- Use npm; `package-lock.json` is authoritative.
- Create `.env` from `.env.example` before `npm ci`: postinstall runs `prisma generate`, whose config requires `DATABASE_URL`. Populate `AUTH_SECRET` and `INGESTION_SECRET` before any Compose command; Compose validates required variables from unselected services too.
- Local stack: `docker compose up -d postgres`, then `npm run db:migrate`, `npm run db:seed`, `npm run dev`.
- `npm run db:up` is misleading: it runs all Compose services, including app and cron, and fails unless `AUTH_SECRET` and `INGESTION_SECRET` are populated.
- Standard verification: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
- Focus one unit file: `npm test -- lib/finance/settlement.test.ts`.
- Integration tests require running Postgres: `npm run test:integration -- lib/import/process-csv.integration.test.ts`. Global setup creates/migrates/seeds `<DATABASE_URL database>_test`, or uses `ORBIT_TEST_DATABASE_URL`; never point it at development data.
- Schema changes require a migration and regenerated client: `npm run db:migrate -- --name <name>`, then `npm run db:generate`.

## Boundaries

- `app/` contains App Router pages/routes and colocated server actions. Root `/` redirects to `/dashboard`; auth protection lives in root `proxy.ts`, not `middleware.ts`.
- Pure finance logic lives in `lib/finance/{settlement,share,split,transfer-matching,burn-rate,net-worth}.ts`; keep Prisma/network/time outside these modules. `lib/finance/net-worth-service.ts` is the intentional Prisma wrapper.
- `lib/parsers/**` is pure parsing. `lib/import/process-csv.ts` owns account checks, deduplication, persistence, checkpoints, and post-import transfer matching.
- Trading 212 code lives in `lib/providers/trading212/`. Treat root `api.json`/`api.yaml` as endpoint contract, not remembered API paths.

## Data invariants

- Money uses Prisma `Decimal` and decimal strings; expenses are negative, income positive. Do not use JS `number` for application money arithmetic.
- Validate external input with Zod before use. Call lazy `getEnv()` inside runtime handlers; import-time env validation breaks `next build`.
- Every transaction requires stable `idempotencyKey`. Source reference wins; account ID must remain part of hash. Changing `lib/finance/idempotency.ts` requires a data backfill or old rows become unreachable and re-imports duplicate.
- Moneta CSV and XML encode one reference differently. Both parsers must use `normalizeSourceReference` from `lib/parsers/reference.ts`, or importing both formats duplicates transactions.
- Imports are preview-first (`dryRun` defaults true), preserve failed raw rows, reject account mismatch, and use `createMany({ skipDuplicates: true })` for committed rows. Never weaken these protections for convenience.
- `SPLIT_PARENT` rows are excluded from aggregates; children carry value. `INTERNAL_TRANSFER` is excluded from cash-flow/settlement but still changes each account balance. Settled rows must not be mutated.
- Reporting currency is CZK. Changing `REPORTING_CURRENCY` requires a data migration.

## Prisma and runtime traps

- Prisma 7 connection URL belongs in `prisma.config.ts`, not `schema.prisma`.
- Generated client lives in ignored `lib/generated/prisma/`. Import client/Decimal from `@/lib/generated/prisma/client`, enums from `@/lib/generated/prisma/enums`, and shared runtime client from `@/lib/db/prisma`; never import application Prisma types from `@prisma/client` or edit generated files.
- Prisma and parsers require Node.js runtime. Do not add `runtime = 'edge'`.
- `next.config.ts` explicitly traces generated Prisma files into standalone output; preserve this when changing build layout.

## Providers and fixtures

- Trading 212 uses HTTP Basic: key ID is username, secret is password. `npm run t212:check` verifies credentials without writes. Endpoint rate limits differ; preserve client pacing and 429 retry behavior.
- Real exports belong in ignored `private/` and must never be committed. Parser tests use anonymized `docs/samples/moneta/` fixtures.
