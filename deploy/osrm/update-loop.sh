#!/bin/bash
set -euo pipefail
source "$(dirname "$0")/http-update.sh"
source "$(dirname "$0")/supervisor.sh"

refresh() {
  local stage previous next current_hash new_hash attempt old_pid live_pid
  stage="$(mktemp -d /data/sets/build.XXXXXXXX)"
  trap 'rm -rf "$stage"' RETURN
  echo 'Checking Geofabrik for a newer Kyrgyzstan extract'
  local fetch_status=0
  http_fetch_candidate "$OSM_PBF_URL" "$stage/kyrgyzstan.osm.pbf" /data/http "$stage/http" || fetch_status=$?
  if [ "$fetch_status" = 3 ]; then http_mark_checked /data/http; echo 'OSRM extract unchanged (HTTP 304)'; return; fi
  if [ "$fetch_status" != 0 ]; then
    fetch_status=0
    http_fetch_candidate "$OSM_PBF_FALLBACK_URL" "$stage/kyrgyzstan.osm.pbf" /data/http "$stage/http" || fetch_status=$?
    if [ "$fetch_status" = 3 ]; then http_mark_checked /data/http; echo 'OSRM fallback unchanged (HTTP 304)'; return; fi
    [ "$fetch_status" = 0 ] || return 1
  fi
  [ -s "$stage/kyrgyzstan.osm.pbf" ] || return 1
  current_hash="$(sha256sum /data/current/kyrgyzstan.osm.pbf | cut -d ' ' -f 1)" || return 1
  new_hash="$(sha256sum "$stage/kyrgyzstan.osm.pbf" | cut -d ' ' -f 1)" || return 1
  if [ "$new_hash" = "$current_hash" ]; then
    http_accept_candidate "$stage/http" /data/http || return 1
    echo 'OSRM extract is unchanged'
    return
  fi
  osrm-extract --threads 2 -p /opt/car.lua "$stage/kyrgyzstan.osm.pbf" || return 1
  osrm-partition --threads 2 "$stage/kyrgyzstan.osrm" || return 1
  osrm-customize --threads 2 "$stage/kyrgyzstan.osrm" || return 1
  osrm-routed --trial --algorithm mld "$stage/kyrgyzstan.osrm" || return 1
  printf '%s  %s\n' "$new_hash" 'kyrgyzstan.osm.pbf' > "$stage/prepared-26.9.0"
  previous="$(readlink -f /data/current)"
  next="/data/sets/$(date -u +%Y%m%dT%H%M%SZ)"
  mv "$stage" "$next" || return 1
  trap - RETURN
  rm -f /data/current.next
  ln -s "$next" /data/current.next || return 1
  mv -Tf /data/current.next /data/current || return 1
  old_pid="$(cat /tmp/taxi-osrm-router.pid 2>/dev/null || true)"
  if [ -n "$old_pid" ]; then kill -TERM "$old_pid" 2>/dev/null || true; fi
  for attempt in $(seq 1 30); do
    live_pid="$(cat /tmp/taxi-osrm-router.pid 2>/dev/null || true)"
    if [ -n "$live_pid" ] && [ "$live_pid" != "$old_pid" ] && curl --fail --silent --max-time 2 "http://127.0.0.1:${PORT:-5000}/route/v1/driving/74.6001,42.8743;74.5866,42.8704" | grep -q '"code":"Ok"'; then
      http_accept_candidate "$next/http" /data/http || return 1
      echo "OSRM switched to $next"
      if [ "$previous" != "$next" ] && [ "${previous#/data/sets/}" != "$previous" ]; then
        rm -rf -- "$previous"
      fi
      return
    fi
    sleep 2
  done
  echo 'New OSRM graph failed the route check; restoring the previous graph' >&2
  ln -s "$previous" /data/current.next
  mv -Tf /data/current.next /data/current
  if [ -f /tmp/taxi-osrm-router.pid ]; then
    kill -TERM "$(cat /tmp/taxi-osrm-router.pid)" 2>/dev/null || true
  fi
  return 1
}

refresh_loop
