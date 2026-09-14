#!/bin/sh
set -eu
# Mounted disks contain lost+found, so initialize PostgreSQL in a child directory.
mkdir -p /var/lib/postgresql/16/main/data
mkdir -p /var/lib/postgresql/16/main/project
if [ ! -f /var/lib/postgresql/16/main/project/.env ]; then
  cp -a /nominatim-template/. /var/lib/postgresql/16/main/project/
fi
exec /app/start.sh
