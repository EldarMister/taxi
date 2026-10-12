import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const q = value => `'${String(value).replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
function shell(script, env = {}) {
  const result = spawnSync(bash, ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true, timeout: 10_000 });
  if (result.error) throw result.error;
  return result;
}
test('standalone OSRM and Photon share the exact update and supervisor logic', () => {
  for (const file of ['http-update.sh', 'supervisor.sh']) assert.equal(readFileSync(join(root, 'deploy/osrm', file), 'utf8'), readFileSync(join(root, 'deploy/photon', file), 'utf8'));
});
test('every map shell script parses with bash', () => {
  for (const [service, files] of [['osrm', ['start.sh', 'bootstrap.sh', 'update-loop.sh', 'http-update.sh', 'supervisor.sh']], ['photon', ['start.sh', 'run.sh', 'update-loop.sh', 'http-update.sh', 'supervisor.sh']], ['nominatim', ['start.sh', 'replication.sh']]]) {
    for (const file of files) {
      const result = spawnSync(bash, ['-n', join(root, 'deploy', service, file)], { encoding: 'utf8', windowsHide: true });
      assert.equal(result.status, 0, result.stderr);
    }
  }
});
test('conditional requests only advance accepted validators after successful activation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-http-update-'));
  try {
    const script = `set -euo pipefail
source ${q(join(root, 'deploy/osrm/http-update.sh'))}
cd ${q(dir)}
curl() {
 local out='' headers='' prev='' arg
 printf '%s\\n' "$@" > request-args
 for arg in "$@"; do
   if [ "$prev" = '--output' ]; then out="$arg"; fi
   if [ "$prev" = '--dump-header' ]; then headers="$arg"; fi
   prev="$arg"
 done
 if [ "$MOCK_CODE" = 200 ]; then
   printf '%s' "$MOCK_BODY" > "$out"
   printf 'HTTP/1.1 302 Found\\r\\nETag: redirect-invalid\\r\\n\\r\\nHTTP/2 200\\r\\nETag: %s\\r\\nLast-Modified: Tue, 12 Oct 2026 00:00:00 GMT\\r\\n\\r\\n' "$MOCK_ETAG" > "$headers"
 else : > "$headers"; fi
 printf '%s' "$MOCK_CODE"
}
MOCK_CODE=200 MOCK_BODY=one MOCK_ETAG='"version-1"'
http_fetch_candidate https://source.example/map stage-payload accepted candidate
[ ! -f accepted.etag ]
http_accept_candidate candidate accepted
grep -q '"version-1"' accepted.etag
MOCK_CODE=304
status=0; http_fetch_candidate https://source.example/map stage-payload accepted next || status=$?
[ "$status" = 3 ]
[ ! -f stage-payload ]
grep -q 'If-None-Match: "version-1"' request-args
grep -q 'If-Modified-Since:' request-args
MOCK_CODE=200 MOCK_BODY=two MOCK_ETAG='"version-2"'
http_fetch_candidate https://source.example/map stage-payload accepted rejected
# Simulated failed import: do not call accept; retry must retain version-1.
grep -q '"version-1"' accepted.etag
http_fetch_candidate https://fallback.example/map stage-payload accepted fallback
! grep -q 'If-None-Match' request-args
MOCK_CODE=304
status=0; http_fetch_candidate https://unknown.example/map stage-payload accepted unknown || status=$?
[ "$status" = 1 ]
MOCK_CODE=200 MOCK_BODY=same MOCK_ETAG=''
http_fetch_candidate https://source.example/map stage-payload accepted noetag
http_accept_candidate noetag accepted
[ ! -s accepted.etag ]
http_fetch_candidate https://source.example/map stage-payload accepted sha-fallback
! grep -q 'If-None-Match' request-args
`;
    const result = shell(script);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.ok(existsSync(join(dir, 'accepted.checked')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('refresh failure retry round is bounded without losing accepted data, successful cadence remains daily', () => {
  const source = `source ${q(join(root, 'deploy/osrm/supervisor.sh'))}`;
  const dir = mkdtempSync(join(tmpdir(), 'atlas-refresh-budget-'));
  try {
    const failure = shell(`${source}\nrefresh(){ return 1; }; sleep(){ if [ "$1" = 86400 ]; then exit 0; fi; }; MAP_UPDATE_FAILURE_MARKER=${q(join(dir, 'http.failed'))}; MAP_UPDATE_MAX_FAILURES=3; refresh_loop`);
    assert.equal(failure.status, 0);
    assert.match(failure.stderr, /exhausted/);
    assert.ok(existsSync(join(dir, 'http.failed')));
    const success = shell(`${source}\nrefresh(){ return 0; }; sleep(){ echo "$1"; exit 0; }; MAP_UPDATE_FAILURE_MARKER=${q(join(dir, 'http.failed'))}; refresh_loop`);
    assert.equal(success.stdout.trim(), '86400');
    assert.ok(!existsSync(join(dir, 'http.failed')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('fast server crashes terminate after the restart budget', () => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-supervisor-'));
  try {
    const result = shell(`source ${q(join(root, 'deploy/osrm/supervisor.sh'))}
sleep(){ :; }
/bin/bash -c 'sleep 10' &
updater_pid=$!
SUPERVISOR_MAX_FAILURES=3
supervise_server ${q(join(dir, 'server.pid'))} /bin/bash -c 'exit 7'
`);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /exhausted/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('OSRM and Photon failed live activation restores the accepted set and its validators', () => {
  for (const kind of ['osrm', 'photon']) {
    const dir = mkdtempSync(join(tmpdir(), `atlas-${kind}-rollback-`)), unix = dir.replaceAll('\\', '/');
    try {
      const update = readFileSync(join(root, `deploy/${kind}/update-loop.sh`), 'utf8');
      const functionBody = update.slice(update.indexOf('refresh() {'), update.lastIndexOf('\nrefresh_loop')).replaceAll('/data', unix).replaceAll('/tmp/taxi-osrm-router.pid', `${unix}/server.pid`).replaceAll('/tmp/taxi-photon-server.pid', `${unix}/server.pid`).replaceAll('/tmp/taxi-photon-trial.log', `${unix}/trial.log`);
      const payload = kind === 'osrm' ? 'kyrgyzstan.osm.pbf' : 'input.jsonl.zst';
      // Git Bash's default ln copies directories on Windows without symlink
      // privilege. Model link storage there; Linux CI exercises actual symlinks.
      const windowsLinks = process.platform === 'win32' ? `
ln(){ [ "$1" = -s ]; printf '%s' "$2" > "$3"; }
readlink(){ if [ "$1" = -f ] && [ -f "$2" ]; then command readlink -f "$(cat "$2")"; else command readlink "$@"; fi; }
sha256sum(){ local path="$1"; if [[ "$path" = *'/current/'* ]]; then path="$(readlink -f ${q(join(dir, 'current'))})/\${path##*/}"; fi; command sha256sum "$path"; }
canonical(){ cygpath -am "$1"; }
` : '';
      const script = `set -euo pipefail
source ${q(join(root, 'deploy', kind, 'http-update.sh'))}
cd ${q(dir)}
${windowsLinks}
${process.platform === 'win32' ? '' : 'canonical(){ printf "%s" "$1"; }'}
mkdir -p sets/initial indices initial
printf 'old' > initial/${payload}
ln -s ${q(join(dir, 'initial'))} current
printf 'https://source.example/map' > http.url
printf '"accepted-old"' > http.etag
printf '1001' > server.pid
OSM_PBF_URL=https://source.example/map
OSM_PBF_FALLBACK_URL=https://fallback.example/map
PHOTON_DUMP_URL=https://source.example/map
PORT=8080
sleep(){ :; }
# Two representative failed probes cover the rollback branch; actual durations
# and full 30-probe timing require a container/staging test.
seq(){ printf '1 2\\n'; }
kill(){
 local last="\${!#}"
 if [ "$last" = "$(cat server.pid)" ]; then printf '%s' "$((last+1))" > server.pid; fi
 return 0
}
osrm-extract(){ :; }; osrm-partition(){ :; }; osrm-customize(){ :; }; osrm-routed(){ :; }
zstd(){ if [ "$1" = -dc ]; then cat "$2"; fi; }
java(){ cat >/dev/null || true; }
curl(){
 local out='' headers='' previous='' arg
 for arg in "$@"; do
   if [ "$previous" = '--output' ]; then out="$arg"; fi
   if [ "$previous" = '--dump-header' ]; then headers="$arg"; fi
   previous="$arg"
 done
 if [ -n "$out" ]; then printf 'new' > "$out"; printf 'HTTP/2 200\\r\\nETag: "rejected-new"\\r\\n\\r\\n' > "$headers"; printf '200'; return; fi
 # The trial process succeeds; the new active process deliberately fails.
 if [ "\${!#}" = http://127.0.0.1:8181/status ]; then printf '{"status":"Ok"}'; else printf '{"code":"Error","status":"Error"}'; fi
}
${functionBody}
status=0; refresh || status=$?
[ "$status" = 1 ]
[ "$(canonical "$(readlink -f current)")" = "$(canonical "$(readlink -f initial)")" ]
grep -q 'accepted-old' http.etag
! grep -q 'rejected-new' http.etag
`;
      const result = shell(script);
      assert.equal(result.status, 0, `${kind}: ${result.stderr} ${result.stdout}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
