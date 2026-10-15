#!/bin/sh
set -eu
exec sudo -H -E -u nominatim python3 /usr/local/bin/taxi-nominatim-replication.py >> /var/log/replication.log 2>&1
