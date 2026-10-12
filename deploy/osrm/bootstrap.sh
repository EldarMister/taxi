#!/bin/sh
set -eu
# Existing Railway volume stays at /data. No recreate/delete/relocation occurs.
mkdir -p /data
if [ "$(id -u)" = 0 ]; then
  # A marker is written only after the complete legacy-tree ownership migration.
  # Checking /data alone could skip children after an interrupted chown.
  if [ ! -f /data/.taxi-osrm-owner-1000 ] || [ "$(stat -c %u /data)" != 1000 ]; then
    chown -R taxi-osrm:taxi-osrm /data
    touch /data/.taxi-osrm-owner-1000
    chown taxi-osrm:taxi-osrm /data/.taxi-osrm-owner-1000
  fi
  exec gosu taxi-osrm /usr/local/bin/taxi-osrm-start
fi
exec /usr/local/bin/taxi-osrm-start
