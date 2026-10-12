// A real Socket.IO client, not a generic WebSocket ping test.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { assertLoadTarget, validateLoadManifest } from './target.mjs';
import { socketAcceptance } from './socket-acceptance.mjs';
import { safeErrorMessage, errorDiagnostic } from './error-diagnostics.mjs';
const require = createRequire(resolve(import.meta.dirname, '../../server/package.json'));
const { io } = require('socket.io-client');
const profile = validateLoadManifest(JSON.parse(readFileSync(process.env.LOAD_MANIFEST, 'utf8')));
const base = assertLoadTarget(profile.target, profile.approvedStagingOrigin), origin = base.replace(/\/api$/, '');
const fixtureText = readFileSync(process.env.LOAD_FIXTURES, 'utf8'), fixtures = JSON.parse(fixtureText);
if (process.env.LOAD_FIXTURE_DIGEST && createHash('sha256').update(fixtureText).digest('hex') !== process.env.LOAD_FIXTURE_DIGEST) throw new Error('Socket fixture changed after startup authorization.');
if (fixtures.fixtureRunId !== profile.fixtureRunId) throw new Error('Load fixture identity mismatch.');
const accounts = [...fixtures.clients.slice(0, Math.floor(profile.activeUsers * .8)), ...fixtures.drivers.slice(0, Math.round(profile.activeUsers * .15))];
const metrics = { attempted: 0, ready: 0, expectedReconnects: 0, unexpectedDisconnects: 0, connectErrors: 0, connectTimeouts: 0, unavailable: 0, expired: 0, snapshotsSucceeded: 0, snapshotsFailed: 0, snapshotTimeouts: 0, unexpected429: 0, canonicalResyncSucceeded: 0, canonicalResyncFailed: 0, pendingSyncs: 0, events: 0, readinessMs: [], reconnectReadinessMs: [] };
const sockets = [], intervals = [], timers = [], outcomes = [], pending = new Set(); let shuttingDown = false;
const plannedStart = process.env.LOAD_START_AT ? Number(process.env.LOAD_START_AT) : Date.now();
if (!Number.isSafeInteger(plannedStart) || plannedStart < Date.now() - 1000) throw new Error('Socket.IO missed the shared measured profile start.');
await delay(Math.max(0, plannedStart - Date.now()));
const deadline = performance.now() + profile.durationSeconds * 1000;
const errors = []; let errorsBeyondLimit = 0;
function diagnostic(category, account, detail = {}) {
  if (errors.length >= 1000) { errorsBeyondLimit++; return; }
  errors.push({ at: new Date().toISOString(), category, accountId: account.userId, role: account.role, ...detail });
}
async function snapshot(account) {
  let succeeded = true;
  for (const path of account.role === 'CLIENT' ? ['/orders/active', '/food/orders/active-all'] : ['/orders/active']) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 18000);
    try {
      const response = await fetch(base + path, { headers: { Authorization: `Bearer ${account.token}` }, signal: controller.signal, redirect: 'error' });
      if (response.status === 429) metrics.unexpected429++;
      if (response.ok) { await response.json(); metrics.snapshotsSucceeded++; } else { succeeded = false; metrics.snapshotsFailed++; diagnostic('snapshot-status', account, { path, status: response.status }); }
    } catch (error) { succeeded = false; metrics.snapshotsFailed++; if (error.name === 'AbortError') metrics.snapshotTimeouts++; diagnostic('snapshot-error', account, { path, ...errorDiagnostic(error) }); }
    finally { clearTimeout(timer); }
  }
  return succeeded;
}
for (const account of accounts) {
  metrics.attempted++; const started = performance.now();
  const socket = io(origin, { auth: { token: account.token }, transports: ['websocket'], reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 10000, timeout: 18000 });
  sockets.push(socket);
  let intentional = false, reconnectStarted = 0;
  const outcome = { index: outcomes.length, role: account.role, ready: false, readyEvents: 0, expectedReconnects: 0, reconnectReady: 0, initialSyncSucceeded: false, reconnectSyncSucceeded: 0, canonicalSyncSucceeded: 0 }; outcomes.push(outcome);
  const timeout = setTimeout(() => { if (!outcome.ready) metrics.connectTimeouts++; }, 18000); timers.push(timeout);
  socket.on('session:ready', () => {
    if (shuttingDown) return;
    const initial = !outcome.ready; outcome.readyEvents++;
    if (initial) { outcome.ready = true; metrics.ready++; metrics.readinessMs.push(performance.now() - started); clearTimeout(timeout); }
    else { outcome.reconnectReady++; if (reconnectStarted) metrics.reconnectReadinessMs.push(performance.now() - reconnectStarted); }
    const tracking = account.trackingOrderId ? new Promise(resolveAck => socket.timeout(5000).emit('tracking:subscribe', { orderId: account.trackingOrderId }, (error, result) => resolveAck(!error && result?.ok === true))) : Promise.resolve(true);
    const sync = Promise.all([snapshot(account), tracking]).then(results => {
      if (results.every(Boolean)) { metrics.canonicalResyncSucceeded++; outcome.canonicalSyncSucceeded++; if (initial) outcome.initialSyncSucceeded = true; else outcome.reconnectSyncSucceeded++; }
      else metrics.canonicalResyncFailed++;
    });
    pending.add(sync); sync.finally(() => pending.delete(sync));
  });
  socket.on('session:unavailable', () => metrics.unavailable++);
  socket.on('session:expired', () => metrics.expired++);
  socket.on('connect_error', error => { metrics.connectErrors++; diagnostic('connect-error', account, { initial: !outcome.ready, ...errorDiagnostic(error) }); });
  socket.on('disconnect', reason => { if (!shuttingDown && !intentional) { metrics.unexpectedDisconnects++; diagnostic('unexpected-disconnect', account, { reason: safeErrorMessage(reason) }); } });
  socket.onAny(event => { if (!event.startsWith('session:')) metrics.events++; });
  intervals.push(setInterval(() => {
    // Leave a full HTTP timeout before the fixed end so a boundary reconnect
    // cannot manufacture an incomplete observation or a false success.
    if (shuttingDown || !socket.connected || performance.now() + 18000 >= deadline) return;
    intentional = true; metrics.expectedReconnects++; outcome.expectedReconnects++; reconnectStarted = performance.now(); socket.disconnect(); socket.connect(); intentional = false;
  }, profile.intervalsSeconds.forcedReconnect * 1000));
  await delay(10); // Record the fixed connect ramp rather than a simultaneous storm.
}
await delay(Math.max(0, deadline - performance.now()));
shuttingDown = true; for (const interval of intervals) clearInterval(interval); for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.disconnect();
if (pending.size) {
  let drainTimer;
  await Promise.race([Promise.allSettled([...pending]), new Promise(resolveDrain => { drainTimer = setTimeout(resolveDrain, 20000); })]);
  clearTimeout(drainTimer);
}
metrics.pendingSyncs = pending.size;
metrics.readinessMs.sort((a, b) => a - b);
const quantile = q => metrics.readinessMs[Math.min(metrics.readinessMs.length - 1, Math.floor(metrics.readinessMs.length * q))] ?? null;
const { passed, blocked } = socketAcceptance(metrics, outcomes);
metrics.reconnectReadinessMs.sort((a, b) => a - b);
const reconnectQuantile = q => metrics.reconnectReadinessMs[Math.min(metrics.reconnectReadinessMs.length - 1, Math.floor(metrics.reconnectReadinessMs.length * q))] ?? null;
writeFileSync(process.env.LOAD_RESULT || '.local/load/socket-summary.json', JSON.stringify({ profile, measuredStartAt: new Date(plannedStart).toISOString(), metrics, accounts: outcomes, errors, errorsBeyondLimit, readiness: { p50: quantile(.5), p95: quantile(.95), p99: quantile(.99) }, reconnectReadiness: { p50: reconnectQuantile(.5), p95: reconnectQuantile(.95), p99: reconnectQuantile(.99) }, passed, blocked, productionReady: false }, null, 2));
console.log(`Socket.IO: ${metrics.ready}/${metrics.attempted} ready, snapshots=${metrics.snapshotsSucceeded}, unexpected disconnects=${metrics.unexpectedDisconnects}; passed=${passed}`);
if (!passed) process.exitCode = 1;
