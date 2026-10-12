#!/bin/bash
# Shared verbatim with Photon. Updates deliberately terminate the child once.
supervise_server() {
  local pid_file="$1"; shift
  local failures=0 started status ended delay finished=''
  while true; do
    started=$SECONDS
    "$@" &
    server_pid=$!
    printf '%s\n' "$server_pid" > "$pid_file"
    status=0
    wait -n -p finished "$server_pid" "$updater_pid" || status=$?
    ended=$SECONDS
    if [ "${finished:-}" = "$updater_pid" ]; then
      echo 'Map updater exited: refusing to serve silently stale data indefinitely' >&2
      kill "$server_pid" 2>/dev/null || true
      wait "$server_pid" 2>/dev/null || true
      exit 1
    fi
    server_pid=''
    rm -f "$pid_file"
    if [ "$((ended-started))" -ge "${SUPERVISOR_STABLE_SECONDS:-300}" ]; then failures=0; fi
    failures=$((failures+1))
    # The 60s activation probe must have time to roll back a bad graph/index.
    if [ "$failures" -ge "${SUPERVISOR_MAX_FAILURES:-7}" ]; then
      echo "Map server exhausted its restart budget (last status $status)" >&2
      kill "$updater_pid" 2>/dev/null || true
      wait "$updater_pid" 2>/dev/null || true
      exit 1
    fi
    delay=$((2 ** failures))
    if [ "$delay" -gt 60 ]; then delay=60; fi
    echo "Map server exited ($status); retry $failures after ${delay}s" >&2
    sleep "$delay"
  done
}

refresh_loop() {
  local failures=0 delay
  while true; do
    if refresh; then
      failures=0
      rm -f "${MAP_UPDATE_FAILURE_MARKER:-/data/http.failed}"
      delay="${MAP_UPDATE_INTERVAL_SECONDS:-86400}"
    else
      failures=$((failures+1))
      echo "Map refresh failed ($failures); preserving the accepted data" >&2
      if [ "$failures" -ge "${MAP_UPDATE_MAX_FAILURES:-5}" ]; then
        echo 'Map refresh exhausted its retry round; accepted data remains available, investigate freshness' >&2
        date -u +%FT%TZ > "${MAP_UPDATE_FAILURE_MARKER:-/data/http.failed}"
        failures=0
        delay="${MAP_UPDATE_INTERVAL_SECONDS:-86400}"
      else
        delay=$((300 * 2 ** (failures-1)))
      fi
    fi
    sleep "$delay"
  done
}
