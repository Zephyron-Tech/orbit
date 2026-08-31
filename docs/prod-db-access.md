# Running local containers against production data

For the rare case where you need the actual containerized app (not `npm run
dev`, not a one-off script) pointed at real production data — e.g.
reproducing something that only shows up in the full Docker build.

**Read this before running anything here.** Every write through this setup
is a real write to production. There is no separate "prod-local" database —
it *is* production.

## Why this needs an override file at all

`docker-compose.yml`'s `app` service builds `DATABASE_URL` from
`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` with the hostname
`postgres` baked into the string — that's the local `postgres` service on
the compose network, not overridable by just setting a different
`DATABASE_URL` in `.env`. `docker-compose.prod-local.yml` is a small
override that replaces `app`'s `DATABASE_URL` outright and drops its
dependency on the local `postgres`/`migrate` services, so `docker compose
up` never touches your local database or applies a migration against
production.

## Steps

1. **Open the tunnel** (separate terminal, stays running):
   ```bash
   DEPLOY_HOST=<vps-ip> ./scripts/prod-db-tunnel.sh
   ```
   Forwards production Postgres (bound loopback-only on the VPS —
   `docker-compose.prod.yml`) to `localhost:5432` on your machine.

2. **Stop your normal local stack first**, if it's running — same port
   (3000) and you don't want the two confused for each other:
   ```bash
   docker compose down
   ```

3. **Set the production DB password** for this shell only (never write it to
   a tracked file):
   ```bash
   export PROD_DB_PASSWORD="<the real POSTGRES_PASSWORD from prod secrets>"
   ```

4. **Start only `app`, with the override, skipping local dependencies:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod-local.yml up -d --no-deps --build app
   ```
   `--no-deps` is doing real work here — without it, compose would still try
   to start `postgres`/`migrate` even though the override cleared `app`'s
   `depends_on`.

5. **Verify it's actually pointed at production** before doing anything
   else — `curl localhost:3000/api/health` should say `"database":"up"`,
   and the login screen should accept your real production credentials.

6. **Tear down when done:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod-local.yml down
   unset PROD_DB_PASSWORD
   ```
   Then Ctrl-C the tunnel, and bring your normal local stack back with
   `docker compose up -d`.

## What this does *not* need

`AUTH_SECRET`/`INGESTION_SECRET`/`FUEL_INGESTION_SECRET` can stay whatever
placeholder values are already in your local `.env` — they only sign local
session cookies and machine-to-machine headers for *this* container, they
don't need to match production's values for anything here to work.
