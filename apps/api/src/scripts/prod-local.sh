#!/usr/bin/env bash
# One-command wrapper around the docs/prod-db-access.md workflow: opens the
# SSH tunnel to production Postgres in the background, waits for it, then
# starts the local `api` container against it via docker-compose.prod-local.yml.
# `down` reverses both — stops the container and kills the tunnel.
#
# Usage:
#   DEPLOY_HOST=<vps> PROD_DB_PASSWORD=<prod postgres password> ./scripts/prod-local.sh up
#   ./scripts/prod-local.sh down
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-vandl}"
PID_FILE="/tmp/orbit-prod-db-tunnel.pid"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod-local.yml)

usage() {
  echo "Usage: $0 up|down" >&2
  exit 1
}

up() {
  : "${DEPLOY_HOST:?Set DEPLOY_HOST to the VPS address}"
  : "${PROD_DB_PASSWORD:?Set PROD_DB_PASSWORD to the real production postgres password}"

  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "Tunnel already running (pid $(cat "$PID_FILE")) — reusing it."
  else
    echo "Opening tunnel to ${DEPLOY_HOST}..."
    ssh -N -L 5432:127.0.0.1:5432 "${DEPLOY_USER}@${DEPLOY_HOST}" &
    echo $! > "$PID_FILE"

    for _ in $(seq 1 20); do
      if (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
        exec 3>&- 3<&-
        break
      fi
      sleep 0.5
    done

    if ! (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then
      echo "Tunnel did not come up in time." >&2
      kill "$(cat "$PID_FILE")" 2>/dev/null || true
      rm -f "$PID_FILE"
      exit 1
    fi
    exec 3>&- 3<&-
  fi

  echo "Tunneled into PRODUCTION — every write through this container is real."
  PROD_DB_PASSWORD="$PROD_DB_PASSWORD" "${COMPOSE[@]}" up -d --no-deps --build api
  "${COMPOSE[@]}" ps api
}

down() {
  # docker-compose.prod-local.yml requires PROD_DB_PASSWORD just to parse
  # (interpolation happens before `down` even looks at what's running) — the
  # value itself is irrelevant here since nothing new gets started.
  PROD_DB_PASSWORD="${PROD_DB_PASSWORD:-unused}" "${COMPOSE[@]}" down

  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
    echo "Tunnel closed."
  fi
}

case "${1:-}" in
  up) up ;;
  down) down ;;
  *) usage ;;
esac
