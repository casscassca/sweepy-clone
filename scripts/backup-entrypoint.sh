#!/bin/sh
set -eu

seconds_until_4am() {
  h=$(date +%H)
  m=$(date +%M)
  s=$(date +%S)
  h=${h#0}; m=${m#0}; s=${s#0}
  h=${h:-0}; m=${m:-0}; s=${s:-0}
  now=$((h * 3600 + m * 60 + s))
  target=$((4 * 3600))
  if [ "$now" -ge "$target" ]; then
    echo $((86400 - now + target))
  else
    echo $((target - now))
  fi
}

echo "backup: $(date -Iseconds) sidecar up, TZ=${TZ:-unset}"

sh /scripts/backup.sh || echo "backup: $(date -Iseconds) run failed" >&2

while true; do
  wait=$(seconds_until_4am)
  echo "backup: $(date -Iseconds) next run in ${wait}s"
  sleep "$wait"
  sh /scripts/backup.sh || echo "backup: $(date -Iseconds) run failed" >&2
done
