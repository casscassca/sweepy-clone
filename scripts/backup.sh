#!/bin/sh
set -eu
set -o pipefail

REMOTE="${RCLONE_REMOTE:-gdrive:backups/sweepy}"
URL="${DIRECT_URL:-${DATABASE_URL:-}}"
RCLONE_FLAGS="--retries 1 --low-level-retries 2 --contimeout 15s --timeout 2m"

if [ -z "$URL" ]; then
  echo "backup: $(date -Iseconds) DIRECT_URL or DATABASE_URL is missing" >&2
  exit 1
fi

echo "backup: $(date -Iseconds) starting"

if ! rclone mkdir "$REMOTE" $RCLONE_FLAGS; then
  echo "backup: $(date -Iseconds) rclone cannot reach ${REMOTE}" >&2
  exit 1
fi

stamp=$(date +%Y%m%d)
file="/tmp/sweepy-${stamp}.sql.gz"
rm -f "$file"
PGCONNECT_TIMEOUT=15 pg_dump --no-owner --no-acl "$URL" | gzip > "$file"
rclone copy "$file" "$REMOTE" $RCLONE_FLAGS
rclone delete "$REMOTE" $RCLONE_FLAGS --min-age 30d --include "sweepy-*.sql.gz" || true
rm -f "$file"
ok=0
i=0
while [ "$i" -lt 12 ]; do
  if PGCONNECT_TIMEOUT=15 psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
INSERT INTO "Settings" (id, "backupAt")
VALUES ('singleton', CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET "backupAt" = CURRENT_TIMESTAMP;
SQL
  then
    ok=1
    break
  fi
  i=$((i + 1))
  sleep 5
done
if [ "$ok" -ne 1 ]; then
  echo "backup: $(date -Iseconds) uploaded the dump but could not record backupAt" >&2
  exit 1
fi
echo "backup: $(date -Iseconds) uploaded sweepy-${stamp}.sql.gz to ${REMOTE}"
