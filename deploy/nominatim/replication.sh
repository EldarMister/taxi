#!/bin/sh
set -u

child=0
failures=0
stop() {
  if [ "$child" -ne 0 ]; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap stop TERM INT
rm -f /tmp/taxi-nominatim-replication-failed

while :; do
  started=$(date +%s)
  sudo -H -E -u nominatim nominatim replication --project-dir "$PROJECT_DIR" >> /var/log/replication.log 2>&1 &
  child=$!
  wait "$child" || true
  child=0
  elapsed=$(($(date +%s)-started))
  if [ "$elapsed" -ge 300 ]; then failures=0; fi
  failures=$((failures+1))
  if [ "$failures" -ge "${REPLICATION_MAX_FAILURES:-5}" ]; then
    echo "$(date -u +%FT%TZ) Replication retry budget exhausted; investigate stale data" | tee -a /var/log/replication.log >&2
    touch /tmp/taxi-nominatim-replication-failed
    exit 1
  fi
  delay=$((60 * (1 << (failures-1))))
  echo "$(date -u +%FT%TZ) Replication stopped; retry $failures in ${delay}s" | tee -a /var/log/replication.log >&2
  sleep "$delay" &
  child=$!
  wait "$child" || true
  child=0
done
