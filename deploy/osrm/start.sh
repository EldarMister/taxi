#!/bin/bash
set -euo pipefail
cd /data
mkdir -p /data/sets

# Migrate the prepared graph from earlier deployments without rebuilding it.
if [ ! -L /data/current ]; then
  if [ ! -f /data/prepared-26.9.0 ]; then
    if [ ! -s /data/kyrgyzstan.osm.pbf ]; then
      curl --fail --location --retry 3 --max-time 900 "$OSM_PBF_URL" -o /data/kyrgyzstan.osm.pbf.partial \
        || curl --fail --location --retry 3 --max-time 900 "$OSM_PBF_FALLBACK_URL" -o /data/kyrgyzstan.osm.pbf.partial
      mv /data/kyrgyzstan.osm.pbf.partial /data/kyrgyzstan.osm.pbf
    fi
    osrm-extract --threads 2 -p /opt/car.lua /data/kyrgyzstan.osm.pbf
    osrm-partition --threads 2 /data/kyrgyzstan.osrm
    osrm-customize --threads 2 /data/kyrgyzstan.osrm
    sha256sum /data/kyrgyzstan.osm.pbf > /data/prepared-26.9.0
  fi
  mkdir -p /data/sets/initial
  mv /data/kyrgyzstan.osm.pbf /data/prepared-26.9.0 /data/kyrgyzstan.osrm* /data/sets/initial/
  ln -s /data/sets/initial /data/current
fi

router_pid=''
updater_pid=''
shutdown() {
  trap - TERM INT
  if [ -n "$updater_pid" ]; then kill "$updater_pid" 2>/dev/null || true; fi
  if [ -n "$router_pid" ]; then kill "$router_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

/usr/local/bin/taxi-osrm-update-loop &
updater_pid=$!
while true; do
  osrm-routed --ip :: --port "${PORT:-5000}" --threads 2 --algorithm mld --max-viaroute-size 10 /data/current/kyrgyzstan.osrm &
  router_pid=$!
  printf '%s\n' "$router_pid" > /tmp/taxi-osrm-router.pid
  wait "$router_pid" || true
  router_pid=''
  rm -f /tmp/taxi-osrm-router.pid
  sleep 2
done
