#!/usr/bin/env bash
# Stops the on-demand dev environment (orbit-app-dev / orbit-migrate-dev) on
# the VPS. Nothing else runs it automatically — a push to `dev` starts it,
# this is how you stop it again once you're done testing.
#
# Usage: DEPLOY_HOST=77.42.45.121 [DEPLOY_USER=vandl] ./scripts/dev-env-down.sh
set -euo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST to the VPS address}"
DEPLOY_USER="${DEPLOY_USER:-vandl}"

ssh "${DEPLOY_USER}@${DEPLOY_HOST}" "cd /opt/docker/orbit-dev && docker compose down"
