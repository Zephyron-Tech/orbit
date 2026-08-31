#!/usr/bin/env bash
# Mirrors the VPS's nightly pg_dump backups (docker-compose.prod.yml's
# `backup` service, /opt/docker/orbit/backups) down to a local directory —
# a second copy on different hardware, so a VPS-provider incident or disk
# failure doesn't take out the only backup too. Meant to run on the Mac Mini
# via launchd (see ops/mac-mini/com.orbit.backup-pull.plist.example).
#
# Uses a dedicated SSH key that is restricted server-side to read-only rsync
# of that one directory (see docs/db-backup-restore.md) — this key can never
# open a shell on the VPS, even if it leaks.
#
# Retention is applied locally, not via rsync --delete: the server-side
# `rrsync -ro` restriction rejects delete-oriented rsync options outright
# (read-only means read-only, including "delete what I don't send you"), so
# this prunes the same way the VPS's own backup service does instead of
# relying on rsync to mirror deletions.
#
# Usage: DEPLOY_HOST=77.42.45.121 [DEPLOY_USER=vandl] ./scripts/backup/pull-from-vps.sh [dest-dir]
set -euo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST to the VPS address}"
DEPLOY_USER="${DEPLOY_USER:-vandl}"
DEST="${1:-$HOME/orbit-backups}"
KEY="${ORBIT_BACKUP_KEY:-$HOME/.ssh/orbit_backup_pull}"

mkdir -p "$DEST"

rsync -az \
  -e "ssh -i ${KEY} -o StrictHostKeyChecking=accept-new" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:/opt/docker/orbit/backups/" "${DEST}/"

find "$DEST" -name 'orbit-*.dump' -mtime +30 -delete

echo "Backups mirrored to ${DEST} ($(find "$DEST" -name 'orbit-*.dump' | wc -l | tr -d ' ') files)."
