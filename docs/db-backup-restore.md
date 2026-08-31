# Database backups and restore

Two layers, both `.dump` files (Postgres custom format, `pg_dump -Fc`), both retained 30 days:

1. **VPS** (`docker-compose.prod.yml`'s `backup` service) — dumps nightly into `/opt/docker/orbit/backups/`, deletes anything older than 30 days.
2. **Mac Mini** (`scripts/backup/pull-from-vps.sh`, run nightly via `launchd`) — pulls that directory down over SSH with `rsync --delete`, mirroring the same 30-day window onto a second machine in a different location.

Neither layer replaces the other: the VPS copy is the fast-recovery path (same
network as the app); the Mac Mini copy is what survives a VPS-provider
incident, a bad `docker volume rm`, or the VPS itself being compromised.

## Checking it's actually running

- VPS: `docker logs orbit-backup --tail 5` — should show a `backup ok: orbit-<timestamp>.dump` line once a day. `backup FAILED` means `pg_dump` errored; check the full log.
- Mac Mini: `cat /tmp/orbit-backup-pull.log` (path from the installed plist) and `ls -la ~/orbit-backups`.

## One-time setup on the Mac Mini

1. Generate a dedicated key that never leaves this machine:
   ```
   ssh-keygen -t ed25519 -f ~/.ssh/orbit_backup_pull -C orbit-backup-pull
   ```
2. Check whether `rrsync` (restricts an SSH key to read-only rsync of one directory — no shell, no other paths) is already installed as part of the `rsync` package:
   ```
   dpkg -L rsync | grep -i rrsync
   ```
   On Debian/Ubuntu with a full `rsync` package this usually already prints `/usr/bin/rrsync` — nothing to install. If it prints nothing, the doc-scripts variant is missing and you'll need to fetch `rrsync` from the `rsync` source distribution matching your installed version and place it at `/usr/local/bin/rrsync` (`chmod +x`) — adjust the path in the next step accordingly.
3. Append the Mac Mini's **public** key to the deploy user's `~/.ssh/authorized_keys` on the VPS, prefixed with the forced command (single line, using whichever `rrsync` path step 2 found — `/usr/bin/rrsync` if already installed):
   ```
   command="/usr/bin/rrsync -ro /opt/docker/orbit/backups/",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty ssh-ed25519 AAAA...your-key-here orbit-backup-pull
   ```
   Verify the restriction: `ssh -i ~/.ssh/orbit_backup_pull <user>@<host>` should be refused a shell (the forced command runs instead of a login shell).
4. Test the pull once by hand:
   ```
   DEPLOY_HOST=<vps-address> ./scripts/backup/pull-from-vps.sh
   ```
5. Install the scheduled job:
   ```
   cp ops/mac-mini/com.orbit.backup-pull.plist.example ~/Library/LaunchAgents/com.orbit.backup-pull.plist
   # edit it: fill in DEPLOY_HOST and the real path to scripts/backup/pull-from-vps.sh
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.orbit.backup-pull.plist
   launchctl kickstart gui/$(id -u)/com.orbit.backup-pull   # trigger once to confirm it fires
   ```

## Restoring

Never restore into the running production database directly — verify against a scratch instance first.

```bash
docker run --rm -d --name orbit-restore-test \
  -e POSTGRES_USER=orbit -e POSTGRES_PASSWORD=test -e POSTGRES_DB=orbit \
  -p 15432:5432 postgres:17-alpine

# wait for it to accept connections, then:
docker cp ~/orbit-backups/orbit-<timestamp>.dump orbit-restore-test:/tmp/restore.dump
docker exec orbit-restore-test pg_restore -U orbit -d orbit --clean --if-exists /tmp/restore.dump

# sanity-check: does the transaction count look right?
docker exec orbit-restore-test psql -U orbit -d orbit -c 'select count(*) from "Transaction";'

docker rm -f orbit-restore-test
```

A backup that has never been restored is not a verified backup — do this once
after setting the pipeline up, and again any time the schema changes
significantly.

To restore into **actual** production (disaster recovery, not routine):
follow the same `pg_restore` steps against the real `orbit-postgres`
container instead of a scratch one, after confirming with whoever else uses
the app that overwriting current data is intended.
