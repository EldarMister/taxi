#!/bin/sh
set -eu
# Mounted disks contain lost+found, so initialize PostgreSQL in a child directory.
mkdir -p /var/lib/postgresql/16/main/data
mkdir -p /var/lib/postgresql/16/main/project
if [ ! -f /var/lib/postgresql/16/main/project/.env ]; then
  cp -a /nominatim-template/. /var/lib/postgresql/16/main/project/
fi
# Railway resolves private service names to IPv6. Grant network authentication
# only to the dedicated read-only Photon role, never to all database users.
if ! grep -Fq 'host nominatim photon_reader ::/0 scram-sha-256' /etc/postgresql/16/main/pg_hba.conf; then
  printf '\nhost nominatim photon_reader ::/0 scram-sha-256\n' >> /etc/postgresql/16/main/pg_hba.conf
fi
exec /app/start.sh
