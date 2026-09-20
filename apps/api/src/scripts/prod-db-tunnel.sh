#!/usr/bin/env bash
# Opens an SSH tunnel to production Postgres, so a local script (scripts/*.ts)
# can run against real production data with DATABASE_URL pointed at
# localhost:5432. Postgres itself is bound loopback-only on the VPS
# (docker-compose.prod.yml) — this tunnel is the only way in.
#
# Never run `docker compose up` against the tunneled DATABASE_URL: the local
# `migrate` service unconditionally runs `prisma migrate deploy` before `api`
# starts, which would apply schema migrations against production with no
# confirmation step. Migrations only ever happen through the real deploy
# pipeline. Run a one-off script (`DATABASE_URL=... npx tsx scripts/x.ts`) or
# `npm run dev` instead — neither triggers a migration.
#
# Usage: DEPLOY_HOST=77.42.45.121 [DEPLOY_USER=vandl] ./scripts/prod-db-tunnel.sh
set -euo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST to the VPS address}"
DEPLOY_USER="${DEPLOY_USER:-vandl}"

echo "Tunneled into PRODUCTION — every write through this connection is real."
echo "localhost:5432 -> ${DEPLOY_HOST}:5432 (orbit-postgres). Ctrl-C to close."

ssh -N -L 5432:127.0.0.1:5432 "${DEPLOY_USER}@${DEPLOY_HOST}"
