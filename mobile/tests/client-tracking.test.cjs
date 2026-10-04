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
const appStateListeners = new Set();
const appState = { currentState: 'active', addEventListener: (_name, callback) => {
  appStateListeners.add(callback);
  return { remove() { appStateListeners.delete(callback); } };
} };
vm.runInNewContext(compiled, { exports: moduleExports, setInterval, clearInterval, AbortController, require: id => {
  if (id === 'react') return require('react');
  if (id === 'react-native') return { AppState: appState };
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
  const live = fix({ stateVersion: 3, sequence: 3, measuredAtMs: now + 1000, latitude: 42.0001 });
  await act(async () => state.receive(event(live, { stateVersion: 3, serverTimeMs: now + 2000 })));
  assert.equal(state.position.latitude, 42.0001);
  await act(async () => resolveSnapshot(event(fix({ stateVersion: 2, sequence: 2, latitude: 42 }), { stateVersion: 2 })));
  assert.equal(state.position.latitude, 42.0001);
});

test('stationary filtered fixes still update freshness instead of being mistaken for duplicate coordinates', () => {
  assert.equal(moduleExports.newerTrackingLocation(fix(), fix({ measuredAtMs: now - 500, sequence: 3, stateVersion: 3 })), true);
});

test('explicit null metrics are accepted while non-finite speed, course and server clock are rejected', () => {
  assert.equal(moduleExports.validTrackingEvent(event(fix({ courseDeg: null, speedMps: null, accuracyM: null, accuracy: 500 })), order, now), true);
  assert.equal(moduleExports.validTrackingEvent(event(fix({ speedMps: NaN })), order, now), false);
  assert.equal(moduleExports.validTrackingEvent(event(fix({ courseDeg: 360 })), order, now), false);
  assert.equal(moduleExports.validTrackingEvent(event(fix(), { serverTimeMs: Infinity }), order, now), false);
});

test('schema, session start and course-quality metadata reject malformed values without confusing null with north', () => {
  for (const overrides of [
    { schemaVersion: 2 }, { schemaVersion: null }, { trackingSessionId: '' }, { trackingSessionId: null },
    { trackingStartedAtMs: null }, { trackingStartedAtMs: Infinity }, { trackingStartedAtMs: now + 6000 },
    { measuredAtMs: null }, { measuredAtMs: undefined }, { courseAccuracyDeg: -1 }, { courseAccuracyDeg: 181 },
    { courseAccuracyDeg: NaN }, { courseSource: 'phone' }, { stateVersion: 1.5 },
  ]) assert.equal(moduleExports.validTrackingEvent(event(fix(overrides)), order, now), false, JSON.stringify(overrides));
  assert.equal(moduleExports.validTrackingEvent(event(fix({ courseDeg: 0, courseAccuracyDeg: null, courseSource: null })), order, now), true);
  assert.equal(moduleExports.validTrackingEvent(event(fix({ courseDeg: null, courseAccuracyDeg: 0, courseSource: 'gps' })), order, now), true);
});

test('batched live events retain order and never resurrect a retired tracking session', async t => {
  let state, renderer;
  function Hook() { state = moduleExports.useClientDriverTracking(order, true); return React.createElement('View'); }
  await act(async () => { renderer = create(React.createElement(Hook)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  await act(async () => {
    state.receive(event(fix({ trackingStartedAtMs: undefined })));
    state.receive(event(fix({ trackingSessionId: 'session-3', trackingStartedAtMs: undefined,
      measuredAtMs: now, sequence: 1, stateVersion: 3, latitude: 42.0001 })));
    state.receive(event(fix({ trackingStartedAtMs: undefined, measuredAtMs: now + 1000,
      sequence: 3, stateVersion: 4, latitude: 42.0002 })));
  });
  assert.equal(state.position.trackingSessionId, 'session-3');
  assert.equal(state.position.latitude, 42.0001);
  assert.equal(state.position.playbackAgeAtReceiptMs, 0);
  assert.ok(Number.isFinite(state.position.playbackReceivedAtMs));
});

test('previous-assignment snapshots and old terminal events cannot erase current tracking', async t => {
  const pending = [];
  requestImpl = () => new Promise(resolve => pending.push(resolve));
  let state, renderer;
  function Hook({ activeOrder }) { state = moduleExports.useClientDriverTracking(activeOrder, true); return React.createElement('View'); }
  await act(async () => { renderer = create(React.createElement(Hook, { activeOrder: order })); });
  t.after(async () => { await act(async () => renderer.unmount()); requestImpl = async () => { throw Error('No snapshot'); }; });
  const nextOrder = { ...order, assignmentId: 'assignment-3' };
  await act(async () => renderer.update(React.createElement(Hook, { activeOrder: nextOrder })));
  assert.equal(state.position, null);
  await act(async () => state.receive(event(fix({ assignmentId: 'assignment-3', stateVersion: 8 }), { assignmentId: 'assignment-3', stateVersion: 8 })));
  await act(async () => pending[0](event(fix())));
  assert.equal(state.position.assignmentId, 'assignment-3');
  await act(async () => state.receive(event(null, { assignmentId: 'assignment-3', status: 'COMPLETED', stateVersion: 2 })));
  assert.equal(state.position.assignmentId, 'assignment-3');
});

test('foreground resume requests a fresh snapshot and unmount clears the app-state subscription', async () => {
  let calls = 0, renderer;
  requestImpl = async () => { calls++; return event(fix()); };
  function Hook() { moduleExports.useClientDriverTracking(order, true); return React.createElement('View'); }
  try {
    await act(async () => { renderer = create(React.createElement(Hook)); });
    assert.equal(appStateListeners.size, 1);
    assert.equal(calls, 1);
    await act(async () => { for (const callback of appStateListeners) callback('active'); });
    assert.equal(calls, 2);
  } finally {
    await act(async () => renderer.unmount());
    requestImpl = async () => { throw Error('No snapshot'); };
  }
  assert.equal(appStateListeners.size, 0);
});

test('one GPS spike is held, two consistent new fixes recover without waiting for the old point to age out', async t => {
  let state, renderer;
  function Hook() { state = moduleExports.useClientDriverTracking(order, true); return React.createElement('View'); }
  await act(async () => { renderer = create(React.createElement(Hook)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  await act(async () => state.receive(event(fix())));
  const jump = fix({ measuredAtMs: now, latitude: 42.01, sequence: 3, stateVersion: 3 });
  await act(async () => state.receive(event(jump)));
  assert.equal(state.position.latitude, 42);
  await act(async () => state.receive(event(jump)));
  assert.equal(state.position.latitude, 42, 'a replay is not a confirming measurement');
  await act(async () => state.receive(event(fix({ measuredAtMs: now + 1000, latitude: 42.01001, sequence: 4, stateVersion: 4 }))));
  assert.equal(state.position.latitude, 42.01001);
  assert.equal(state.position.playbackPositionValidated, true);
});
