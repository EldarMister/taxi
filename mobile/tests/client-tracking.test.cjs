const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const file = fs.readFileSync(path.join(__dirname, '../src/useDriverTracking.ts'), 'utf8');
const compiled = ts.transpileModule(file, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleExports = {};
let requestImpl = async () => { throw Error('No snapshot'); };
vm.runInNewContext(compiled, { exports: moduleExports, setInterval, clearInterval, AbortController, require: id => {
  if (id === 'react') return require('react');
  if (id === 'react-native') return { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } };
  if (id === './api') return { api: { request: (...args) => requestImpl(...args) } };
  if (id === './navigation') return { distanceBetween() {}, DrivingRoute: {} };
  throw Error(id);
} });

const now = 1_800_000_000_000;
const order = { id: 'ride', status: 'ASSIGNED', driver: { id: 'driver' }, assignmentId: 'assignment-2' };
const fix = (overrides = {}) => ({ schemaVersion: 1, orderId: 'ride', assignmentId: 'assignment-2', driverId: 'driver',
  latitude: 42, longitude: 74, measuredAtMs: now - 1000, timestamp: now - 1000, receivedAtMs: now,
  stateVersion: 2, accuracyM: 0, accuracy: 0, speedMps: 0, courseDeg: 0, sequence: 2,
  trackingSessionId: 'session-2', trackingStartedAtMs: now - 2000, ...overrides });
const event = (location, overrides = {}) => ({ orderId: 'ride', assignmentId: 'assignment-2', driverId: 'driver',
  status: 'ASSIGNED', serverTimeMs: now, stateVersion: location?.stateVersion ?? 0, location, ...overrides });

test('client accepts zero speed/bearing but rejects a previous assignment and reversed coordinates', () => {
  assert.equal(moduleExports.validTrackingEvent(event(fix()), order, now), true);
  assert.equal(moduleExports.validTrackingEvent(event(fix({ assignmentId: 'assignment-1' })), order, now), false);
  assert.equal(moduleExports.validTrackingEvent(event(fix(), { assignmentId: 'assignment-1' }), order, now), false);
  assert.equal(moduleExports.validTrackingEvent(event(fix(), { assignmentId: undefined }), order, now), false);
  assert.equal(moduleExports.validTrackingEvent(event(fix({ latitude: 180, longitude: 42 })), order, now), false);
  assert.equal(moduleExports.validTrackingEvent(event(fix({ orderId: 'other' })), order, now), false);
});

test('late snapshots, duplicate sequences and retired sessions cannot move the car backwards', () => {
  const latest = fix();
  assert.equal(moduleExports.newerTrackingLocation(latest, fix({ measuredAtMs: now - 2000, stateVersion: 1, sequence: 1 })), false);
  assert.equal(moduleExports.newerTrackingLocation(latest, fix({ measuredAtMs: now + 1000, stateVersion: 2, sequence: 3 })), false);
  assert.equal(moduleExports.newerTrackingLocation(latest, fix({ measuredAtMs: now + 1000, stateVersion: 3, sequence: 2 })), false);
  assert.equal(moduleExports.newerTrackingLocation(latest, fix({ measuredAtMs: now + 1000, stateVersion: 3, sequence: 1,
    trackingSessionId: 'session-1', trackingStartedAtMs: now - 3000 })), false);
  assert.equal(moduleExports.newerTrackingLocation(latest, fix({ measuredAtMs: now + 1000, stateVersion: 3, sequence: 3 })), true);
});

test('position age uses server clock at receipt, then the local monotonic interval', () => {
  const localReceivedAt = now + 3_600_000; // client's clock is one hour ahead of server
  const serverTimeAtReceipt = now + 4000;
  assert.equal(moduleExports.trackingAgeStatus(fix(), localReceivedAt, localReceivedAt, serverTimeAtReceipt).ageSeconds, 5);
  assert.equal(moduleExports.trackingAgeStatus(fix(), localReceivedAt + 8000, localReceivedAt, serverTimeAtReceipt).ageSeconds, 13);
  const stale = moduleExports.trackingAgeStatus(fix(), localReceivedAt + 12000, localReceivedAt, serverTimeAtReceipt);
  assert.equal(stale.unavailable, true);
  assert.match(stale.message, /Местоположение не обновляется/);
});

test('a late HTTP snapshot cannot undo a newer live event', async t => {
  let resolveSnapshot;
  requestImpl = () => new Promise(resolve => { resolveSnapshot = resolve; });
  let state, renderer;
  function Hook() { state = moduleExports.useClientDriverTracking(order, true); return React.createElement('View'); }
  await act(async () => { renderer = create(React.createElement(Hook)); });
  t.after(async () => { await act(async () => renderer.unmount()); requestImpl = async () => { throw Error('No snapshot'); }; });
  assert.equal(typeof resolveSnapshot, 'function');
  const live = fix({ stateVersion: 3, sequence: 3, measuredAtMs: now + 1000, latitude: 42.1 });
  await act(async () => state.receive(event(live, { stateVersion: 3, serverTimeMs: now + 2000 })));
  assert.equal(state.position.latitude, 42.1);
  await act(async () => resolveSnapshot(event(fix({ stateVersion: 2, sequence: 2, latitude: 42 }), { stateVersion: 2 })));
  assert.equal(state.position.latitude, 42.1);
});
