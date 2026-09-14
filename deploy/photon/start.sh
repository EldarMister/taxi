#!/bin/sh
set -eu
mkdir -p /data/index-v1
chown photon:photon /data /data/index-v1
exec gosu photon /app/run.sh
