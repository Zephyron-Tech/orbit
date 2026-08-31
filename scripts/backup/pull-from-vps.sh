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
# macOS ships openrsync as /usr/bin/rsync (Catalina onward), which the
# server's rrsync forced command (written for classic GPL rsync) rejects
# with "invalid rsync-command syntax". The client must use classic rsync too
# — `brew install rsync` and point ORBIT_RSYNC_BIN at it if it's not the
# first `rsync` on PATH.
#
# Retention is applied locally, not via rsync --delete: the server-side
# `rrsync -ro` restriction rejects delete-oriented rsync options outright
# (read-only means read-only, including "delete what I don't send you"), so
# this prunes the same way the VPS's own backup service does instead of
# relying on rsync to mirror deletions.
#
# The remote path is just ":" (empty), not the absolute backups path: the
# forced command on the VPS (`rrsync -ro /opt/docker/orbit/backups/`) already
# locks the session's root to that directory, so requesting the same
# absolute path again on top of it doubles up and rsync can't find it.
#
# Discord (DISCORD_BOT_TOKEN + ORBIT_DISCORD_CHANNEL_ID) and an Uptime Kuma
# push monitor (ORBIT_PULL_KUMA_URL) are both optional — unset means the
# notify/heartbeat step is skipped, never that the pull itself fails. The
# Kuma ping fires unconditionally on exit (success or failure), same
# dead-man's-switch convention mac-automation's shared/heartbeat.py uses:
# it proves this launchd job fired at all, which a Discord message alone
# can't (a job that never runs sends no Discord message either).
#
# Usage: DEPLOY_HOST=77.42.45.121 [DEPLOY_USER=vandl] [ORBIT_RSYNC_BIN=/opt/homebrew/bin/rsync] ./scripts/backup/pull-from-vps.sh [dest-dir]
set -euo pipefail

: "${DEPLOY_HOST:?Set DEPLOY_HOST to the VPS address}"
DEPLOY_USER="${DEPLOY_USER:-vandl}"
DEST="${1:-$HOME/orbit-backups}"
KEY="${ORBIT_BACKUP_KEY:-$HOME/.ssh/orbit_backup_pull}"
RSYNC_BIN="${ORBIT_RSYNC_BIN:-rsync}"

notify_discord_success() {
  local count="$1" dest="$2"
  [ -n "${DISCORD_BOT_TOKEN:-}" ] && [ -n "${ORBIT_DISCORD_CHANNEL_ID:-}" ] || return 0
  local ts payload
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  payload=$(printf '{"embeds":[{"author":{"name":"💻 Orbit Mac Mini"},"title":"✅ Pull complete","description":"Mirrored %s file(s)","color":3066993,"fields":[{"name":"Files","value":"%s","inline":true},{"name":"Destination","value":"%s","inline":true}],"footer":{"text":"Orbit backups · Mac Mini"},"timestamp":"%s"}]}' "$count" "$count" "$dest" "$ts")
  curl -fsS \
    -H "Content-Type: application/json" \
    -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
    -d "$payload" \
    "https://discord.com/api/v10/channels/${ORBIT_DISCORD_CHANNEL_ID}/messages" >/dev/null \
    || echo "discord notify failed"
}

notify_discord_failure() {
  local rc="$1"
  [ -n "${DISCORD_BOT_TOKEN:-}" ] && [ -n "${ORBIT_DISCORD_CHANNEL_ID:-}" ] || return 0
  local ts payload
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  payload=$(printf '{"embeds":[{"author":{"name":"💻 Orbit Mac Mini"},"title":"❌ Pull failed","description":"rsync/prune failed (exit %s) — check /tmp/orbit-backup-pull.log.","color":15158332,"footer":{"text":"Orbit backups · Mac Mini"},"timestamp":"%s"}]}' "$rc" "$ts")
  curl -fsS \
    -H "Content-Type: application/json" \
    -H "Authorization: Bot ${DISCORD_BOT_TOKEN}" \
    -d "$payload" \
    "https://discord.com/api/v10/channels/${ORBIT_DISCORD_CHANNEL_ID}/messages" >/dev/null \
    || echo "discord notify failed"
}

ping_kuma() {
  [ -n "${ORBIT_PULL_KUMA_URL:-}" ] && curl -fsS "$ORBIT_PULL_KUMA_URL" >/dev/null 2>&1
  return 0
}
trap ping_kuma EXIT

main() {
  mkdir -p "$DEST"

  # `|| return 1` is required, not decorative: `if main; then` below suspends
  # `set -e` for everything main() runs, so a failing rsync here would
  # otherwise be silently swallowed by the later `find` succeeding and
  # becoming main()'s exit status instead.
  "$RSYNC_BIN" -az \
    -e "ssh -i ${KEY} -o StrictHostKeyChecking=accept-new" \
    "${DEPLOY_USER}@${DEPLOY_HOST}:" "${DEST}/" || return 1

  find "$DEST" -name 'orbit-*.dump' -mtime +30 -delete
}

if main; then
  count=$(find "$DEST" -name 'orbit-*.dump' | wc -l | tr -d ' ')
  echo "Backups mirrored to ${DEST} (${count} files)."
  notify_discord_success "$count" "$DEST"
else
  rc=$?
  echo "Pull FAILED (exit ${rc})"
  notify_discord_failure "$rc"
  exit "$rc"
fi
