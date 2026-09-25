#!/bin/sh
set -u

child=0
stop() {
  if [ "$child" -ne 0 ]; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit 0
}
trap stop TERM INT

while :; do
  sudo -H -E -u nominatim nominatim replication --project-dir "$PROJECT_DIR" >> /var/log/replication.log 2>&1 &
  child=$!
  wait "$child" || true
  child=0
  echo "$(date -u +%FT%TZ) Nominatim replication stopped; retrying in 60 seconds" >> /var/log/replication.log
  sleep 60 &
  child=$!
  wait "$child" || true
  child=0
done
