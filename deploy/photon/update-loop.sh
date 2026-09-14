#!/bin/bash
set -euo pipefail

refresh() {
  local stage previous next old_hash new_hash trial_pid attempt old_pid live_pid
  stage="$(mktemp -d /data/indices/build.XXXXXXXX)"
  trap 'rm -rf "$stage"' RETURN
  echo 'Checking GraphHopper for a newer Photon dump'
  curl --fail --location --retry 3 --max-time 900 "$PHOTON_DUMP_URL" -o "$stage/input.jsonl.zst" || return 1
  [ -s "$stage/input.jsonl.zst" ] || return 1
  old_hash="$(sha256sum /data/current/input.jsonl.zst | cut -d ' ' -f 1)" || return 1
  new_hash="$(sha256sum "$stage/input.jsonl.zst" | cut -d ' ' -f 1)" || return 1
  if [ "$new_hash" = "$old_hash" ]; then
    echo 'Photon dump is unchanged'
    return
  fi
  zstd -t "$stage/input.jsonl.zst" || return 1
  zstd -dc "$stage/input.jsonl.zst" | java -Xms256m -Xmx768m -XX:ActiveProcessorCount=2 -jar /app/photon.jar import -import-file - -country-codes kg -languages ru,ky,en -data-dir "$stage" || return 1
  printf '%s  %s\n' "$new_hash" 'input.jsonl.zst' > "$stage/import-complete"
  java -Xms256m -Xmx768m -XX:ActiveProcessorCount=2 -jar /app/photon.jar serve -data-dir "$stage" -listen-ip 127.0.0.1 -listen-port 8181 -default-language ru -query-timeout 3 -max-results 20 > /tmp/taxi-photon-trial.log 2>&1 &
  trial_pid=$!
  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 2 http://127.0.0.1:8181/status | grep -q '"status":"Ok"'; then break; fi
    sleep 2
  done
  if ! curl --fail --silent --max-time 2 http://127.0.0.1:8181/status | grep -q '"status":"Ok"'; then
    kill "$trial_pid" 2>/dev/null || true
    wait "$trial_pid" 2>/dev/null || true
    echo 'New Photon index failed its readiness check' >&2
    return 1
  fi
  kill "$trial_pid" 2>/dev/null || true
  wait "$trial_pid" 2>/dev/null || true
  previous="$(readlink -f /data/current)"
  next="/data/indices/$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$stage" "$next" || return 1
  trap - RETURN
  rm -f /data/current.next
  ln -s "$next" /data/current.next || return 1
  mv -Tf /data/current.next /data/current || return 1
  old_pid="$(cat /tmp/taxi-photon-server.pid 2>/dev/null || true)"
  if [ -n "$old_pid" ]; then kill -TERM "$old_pid" 2>/dev/null || true; fi
  for attempt in $(seq 1 30); do
    live_pid="$(cat /tmp/taxi-photon-server.pid 2>/dev/null || true)"
    if [ -n "$live_pid" ] && [ "$live_pid" != "$old_pid" ] && curl --fail --silent --max-time 2 "http://127.0.0.1:${PORT:-8080}/status" | grep -q '"status":"Ok"'; then
      echo "Photon switched to $next"
      if [ "$previous" != /data/index-v1 ] && [ "${previous#/data/indices/}" != "$previous" ]; then
        rm -rf -- "$previous"
      fi
      return
    fi
    sleep 2
  done
  echo 'New Photon index failed after switching; restoring the previous index' >&2
  ln -s "$previous" /data/current.next
  mv -Tf /data/current.next /data/current
  if [ -f /tmp/taxi-photon-server.pid ]; then
    kill -TERM "$(cat /tmp/taxi-photon-server.pid)" 2>/dev/null || true
  fi
  return 1
}

while true; do
  refresh || echo 'Photon daily refresh failed; keeping the previous index' >&2
  sleep "${MAP_UPDATE_INTERVAL_SECONDS:-86400}"
done
