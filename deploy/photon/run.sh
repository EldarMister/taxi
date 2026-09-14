#!/bin/bash
set -euo pipefail
mkdir -p /data/index-v1 /data/indices
cd /data/index-v1
if [ ! -f import-complete ]; then
  if [ ! -s input.jsonl.zst ]; then
    curl -fL --retry 3 --max-time 900 "$PHOTON_DUMP_URL" -o input.jsonl.zst.partial
    mv input.jsonl.zst.partial input.jsonl.zst
  fi
  zstd -t input.jsonl.zst
  zstd -dc input.jsonl.zst | java -Xms256m -Xmx768m -XX:ActiveProcessorCount=2 -jar /app/photon.jar import -import-file - -country-codes kg -languages ru,ky,en -data-dir /data/index-v1
  sha256sum input.jsonl.zst > import-complete
fi
if [ ! -L /data/current ]; then ln -s /data/index-v1 /data/current; fi

server_pid=''
updater_pid=''
shutdown() {
  trap - TERM INT
  if [ -n "$updater_pid" ]; then kill "$updater_pid" 2>/dev/null || true; fi
  if [ -n "$server_pid" ]; then kill "$server_pid" 2>/dev/null || true; fi
  wait 2>/dev/null || true
  exit 0
}
trap shutdown TERM INT

/app/update-loop.sh &
updater_pid=$!
while true; do
  java -Xms256m -Xmx768m -XX:ActiveProcessorCount=2 -jar /app/photon.jar serve -data-dir /data/current -listen-ip :: -listen-port "${PORT:-8080}" -default-language ru -query-timeout 3 -max-results 20 &
  server_pid=$!
  printf '%s\n' "$server_pid" > /tmp/taxi-photon-server.pid
  wait "$server_pid" || true
  server_pid=''
  rm -f /tmp/taxi-photon-server.pid
  sleep 2
done
