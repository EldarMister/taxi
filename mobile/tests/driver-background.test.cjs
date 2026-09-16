const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function compile(path, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, Date, require: id => { if (!(id in dependencies)) throw Error(id); return dependencies[id]; }, ...globals });
  return exports;
}
function setup(options = {}) {
  let now = Date.now(), callback, started = false, starts = 0, stops = 0, tokens = true, releaseNetwork = () => {};
  const storage = new Map(), uploads = [], speaks = [], routes = [];
  const AppState = { currentState: options.foreground ? 'active' : 'background' };
  class Clock extends Date { static now() { return now; } }
  class ApiError extends Error { constructor(status) { super('error'); this.status = status; } }
  const a = { latitude: 41.1987, longitude: 72.1802, address: 'Подача' }, b = { ...a, latitude: 41.1996 }, c = { ...b, longitude: 72.181 };
  const step = (type, location, geometry) => ({ name: 'улица Ленина', geometry, distanceMeters: 100, durationSeconds: 20, maneuver: { type, modifier: 'right', location, bearingBefore: 0, bearingAfter: 90 } });
  const order = { id: 'order', assignmentId: '00000000-0000-4000-8000-000000000001', status: 'ASSIGNED', pickup: c, dropoff: a };
  const session = { userId: 'driver', order, voice: true };
  const navigation = compile('../src/navigation.ts', {}, { Date: Clock });
  const module = compile('../src/native/driverTracking.ts', {
    'expo-location': { Accuracy: { BestForNavigation: 6 }, ActivityType: { AutomotiveNavigation: 1 }, getBackgroundPermissionsAsync: async () => ({ granted: options.permission !== false }), getForegroundPermissionsAsync: async () => ({ granted: options.permission !== false, android: { accuracy: options.coarse ? 'coarse' : 'fine' } }), hasStartedLocationUpdatesAsync: async () => started, startLocationUpdatesAsync: async (_task, config) => { assert.equal(config.foregroundService.killServiceOnDestroy, true); assert.equal(config.timeInterval, 1000); started = true; starts++; }, stopLocationUpdatesAsync: async () => { started = false; stops++; } },
    'expo-task-manager': { defineTask: (_name, task) => { callback = task; } },
    'expo-secure-store': { getItemAsync: async key => storage.get(key), setItemAsync: async (key, value) => storage.set(key, value), deleteItemAsync: async key => storage.delete(key) },
    'expo-speech': { getAvailableVoicesAsync: async () => [{ identifier: 'ru-offline', language: 'ru-RU', quality: 'Enhanced' }], stop: async () => {}, speak: text => speaks.push(text) },
    'react-native': { AppState, Platform: { OS: 'android' }, Alert: {}, Linking: {} },
    '../appVariant': { isRoleAllowed: () => !options.client }, '../navigation': navigation,
    '../api': { ApiError, api: { getTokens: () => tokens, restore: async () => tokens, patch: async (path, fix) => { uploads.push({ path, fix }); if (options.rejected) throw new ApiError(403); if (options.networkFailure) throw new Error('offline'); if (options.hangingNetwork || (options.hangFirst && uploads.length === 1)) await new Promise(resolve => { releaseNetwork = resolve; }); return { orderId: 'order', driverId: 'driver', status: 'ASSIGNED', pickup: c, dropoff: a }; }, post: async (path, body) => { routes.push(body); return { provider: 'osrm', distanceMeters: 170, durationSeconds: 30, geometry: [a,b,c], steps: [step('depart',a,[a,b]),step('turn',b,[b,c]),step('arrive',c,[c])] }; } } },
  }, { Date: Clock, __DEV__: options.diagnosticDev === true,
    process: { env: { EXPO_PUBLIC_TRACKING_DIAGNOSTICS: options.diagnosticDev ? '1' : undefined } },
    setTimeout, clearTimeout });
  return { module, session, AppState, uploads, speaks, routes, storage, releaseNetwork: () => releaseNetwork(),
    advance: ms => { now += ms; }, get starts() { return starts; }, get stops() { return stops; }, get started() { return started; },
    async batch(points) { now += 3000; await callback({ data: { locations: points.map(({ age = 0, coords = {} }) => ({ timestamp: now - age,
      coords: { ...a, accuracy: 8, heading: 0, speed: 10, ...coords } })) } }); },
    async fix(age = 0, coords = {}) { now += 3000; await callback({ data: { locations: [{ timestamp: now - age, coords: { ...a, accuracy: 8, heading: 0, speed: 10, ...coords } }] } }); } };
}
test('background task uploads only the active order and announces metres plus street', async () => {
  const h = setup(); await h.module.setDriverTrackingSession(h.session);
  await h.fix(); assert.equal(h.uploads[0].path, '/orders/order/driver-location');
  assert.equal(h.uploads[0].fix.schemaVersion, 1);
  assert.equal(h.uploads[0].fix.orderId, 'order');
  assert.equal(h.uploads[0].fix.assignmentId, h.session.order.assignmentId);
  assert.equal('driverId' in h.uploads[0].fix, false);
  assert.equal(h.uploads[0].fix.sequence, 1);
  assert.ok(h.uploads[0].fix.trackingStartedAtMs <= h.uploads[0].fix.measuredAtMs);
  assert.equal(h.uploads[0].fix.accuracyM, 8);
  assert.equal(h.uploads[0].fix.courseDeg, 0);
  assert.equal(h.uploads[0].fix.speedMps, 10);
  assert.match(h.speaks[0], /Через 100 метров поверните направо на улицу Ленина/);
  await h.fix(); assert.equal(h.speaks.length, 1, 'same maneuver stage is not repeated');
  assert.equal(h.uploads[1].fix.sequence, 2);
  assert.equal(h.uploads[1].fix.trackingSessionId, h.uploads[0].fix.trackingSessionId);
  await h.fix(35000); assert.equal(h.uploads.length, 2, 'stale native batch is discarded');
  await h.module.setDriverTrackingSession(null); await h.fix(); assert.equal(h.uploads.length, 2);
});

test('stationary background fixes suppress drift after two readings while preserving measurement time', async () => {
  const h = setup(); await h.module.setDriverTrackingSession(h.session);
  await h.fix(0, { speed: 0, heading: 90, accuracy: 20 });
  await h.fix(0, { speed: 0, heading: 240, accuracy: 20, latitude: 41.19875 });
  assert.equal(h.uploads.length, 1);
  await h.fix(0, { speed: 0, heading: 250, accuracy: 20, latitude: 41.19876 });
  assert.equal(h.uploads.length, 2);
  assert.equal(h.uploads[1].fix.latitude, h.uploads[0].fix.latitude);
  assert.equal(h.uploads[1].fix.courseDeg, h.uploads[0].fix.courseDeg);
  assert.ok(h.uploads[1].fix.measuredAtMs > h.uploads[0].fix.measuredAtMs);
});

test('background driver location reacquires after two matching GPS readings', async () => {
  const h = setup(); await h.module.setDriverTrackingSession(h.session);
  await h.fix();
  await h.fix(0, { latitude: 41.2087 });
  assert.equal(h.uploads.length, 1);
  await h.fix(0, { latitude: 41.20872 });
  assert.equal(h.uploads.length, 2);
  assert.ok(h.uploads[1].fix.latitude > 41.2087);
});
test('native GPS batches are processed in time order and an inaccurate last reading cannot hide a good fix', async () => {
  const h = setup(); await h.module.setDriverTrackingSession(h.session);
  await h.batch([{ age: 2000, coords: { latitude: 41.1987 } },
    { age: 1000, coords: { latitude: 41.1988 } },
    { age: 0, coords: { latitude: 41.1989, accuracy: 150 } }]);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].fix.latitude, 41.1988);
  assert.equal(h.module.getDriverTrackingDiagnostics().raw.accuracy, 150);
  assert.equal(h.module.getDriverTrackingDiagnostics().processed.latitude, 41.1988);
});
test('same assignment retains one background service and packet sequence; replacement starts a fresh stream', async () => {
  const h = setup({ foreground: true }); await h.module.setDriverTrackingSession(h.session);
  await Promise.all([h.module.startDriverBackgroundTracking(), h.module.startDriverBackgroundTracking()]);
  assert.equal(h.starts, 1);
  await h.fix();
  const first = h.uploads[0].fix;
  await h.module.setDriverTrackingSession({ ...h.session, voice: false });
  await h.module.startDriverBackgroundTracking();
  await h.fix();
  assert.equal(h.starts, 1);
  assert.equal(h.uploads[1].fix.trackingSessionId, first.trackingSessionId);
  assert.equal(h.uploads[1].fix.sequence, 2);
  await h.module.setDriverTrackingSession({ ...h.session, order: { ...h.session.order,
    assignmentId: '00000000-0000-4000-8000-000000000002' } });
  await h.fix();
  assert.equal(h.uploads[2].fix.sequence, 1);
  assert.notEqual(h.uploads[2].fix.trackingSessionId, first.trackingSessionId);
  assert.equal(h.uploads[2].fix.assignmentId, '00000000-0000-4000-8000-000000000002');
});
test('latest fix received during an in-flight HTTP upload is sent once the network responds', async () => {
  const h = setup({ hangFirst: true }); await h.module.setDriverTrackingSession(h.session);
  const pending = h.fix();
  await new Promise(resolve => setTimeout(resolve, 10));
  await h.fix(0, { latitude: 41.1988 });
  await h.fix(0, { latitude: 41.1989 });
  assert.equal(h.uploads.length, 1);
  h.releaseNetwork(); await pending;
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.uploads.length, 2);
  assert.equal(h.uploads[1].fix.latitude, 41.1989);
  assert.equal(h.uploads[1].fix.sequence, 2);
});
test('a slow upload from the previous assignment cannot block the replacement driver stream', async () => {
  const h = setup({ hangFirst: true }); await h.module.setDriverTrackingSession(h.session);
  const oldRequest = h.fix();
  await new Promise(resolve => setTimeout(resolve, 10));
  await h.module.setDriverTrackingSession({ ...h.session, order: { ...h.session.order,
    assignmentId: '00000000-0000-4000-8000-000000000002' } });
  await h.fix();
  assert.equal(h.uploads.length, 2);
  assert.equal(h.uploads[1].fix.sequence, 1);
  assert.equal(h.uploads[1].fix.assignmentId, '00000000-0000-4000-8000-000000000002');
  h.releaseNetwork(); await oldRequest;
  assert.equal(h.uploads.length, 2);
});
test('a long GPS gap permits a real relocation without replaying an impossible jump', async () => {
  const h = setup(); await h.module.setDriverTrackingSession(h.session);
  await h.fix(); h.advance(60_000);
  await h.fix(0, { latitude: 41.2087 });
  assert.equal(h.uploads.length, 2);
  assert.equal(h.uploads[1].fix.latitude, 41.2087);
});
test('GPS freeze and trace replay are development-only and never publish synthetic positions', async () => {
  const release = setup(); await release.module.setDriverTrackingSession(release.session);
  await release.fix();
  assert.equal(release.module.freezeDriverGps(), false);
  assert.equal(release.module.startDriverGpsRecording(), false);
  const h = setup({ diagnosticDev: true }); await h.module.setDriverTrackingSession(h.session);
  assert.equal(h.module.startDriverGpsRecording(), true);
  await h.fix(); await h.fix(0, { latitude: 41.1988 });
  const trace = h.module.stopDriverGpsRecording();
  assert.equal(trace.length, 2);
  const actualUploads = h.uploads.length;
  assert.equal(h.module.freezeDriverGps(), true);
  await h.fix(0, { latitude: 41.1989 });
  assert.equal(h.uploads.length, actualUploads);
  assert.equal(h.module.getDriverTrackingDiagnostics().diagnosticMode, 'freeze');
  assert.equal(h.module.replayDriverGps(trace.map((fix, index) => ({ ...fix, timestamp: 1000 + index * 50 }))), true);
  h.advance(100);
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(h.uploads.length, actualUploads);
  assert.equal(h.module.getDriverTrackingDiagnostics().diagnosticMode, 'replay');
  h.module.stopDriverGpsDiagnostic();
  assert.equal(h.module.getDriverTrackingDiagnostics().diagnosticMode, 'off');
});
test('background permission is required and the foreground service stops with the session', async () => {
  const denied = setup({ permission: false, foreground: true }); await denied.module.setDriverTrackingSession(denied.session);
  assert.equal(await denied.module.startDriverBackgroundTracking(), false);
  const coarse = setup({ coarse: true, foreground: true }); await coarse.module.setDriverTrackingSession(coarse.session);
  assert.equal(await coarse.module.startDriverBackgroundTracking(), false);
  const h = setup({ foreground: true }); await h.module.setDriverTrackingSession(h.session);
  assert.equal(await h.module.startDriverBackgroundTracking(), true); assert.equal(h.started, true);
  await h.fix(); assert.equal(h.speaks.length, 0, 'foreground navigation owns speech');
  await h.module.setDriverTrackingSession(null); assert.equal(h.started, false); assert.equal(h.stops, 1);
});
test('background navigation still speaks when position upload fails temporarily', async () => {
  const h = setup({ networkFailure: true }); await h.module.setDriverTrackingSession(h.session);
  await h.fix();
  assert.equal(h.uploads.length, 1);
  assert.equal(h.routes.length, 1);
  assert.match(h.speaks[0], /Через 100 метров/);
});
test('a slow position upload cannot delay an urgent background maneuver', async () => {
  const h = setup({ hangingNetwork: true }); await h.module.setDriverTrackingSession(h.session);
  const pending = h.fix();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.uploads.length, 1);
  assert.match(h.speaks[0], /Через 100 метров/);
  h.releaseNetwork(); await pending;
});
test('revoked assignment stops reporting and clears the persisted session; client task cannot upload', async () => {
  const h = setup({ rejected: true }); await h.module.setDriverTrackingSession(h.session);
  await h.fix(); await h.fix(); assert.equal(h.uploads.length, 1); assert.equal(h.storage.size, 0);
  const client = setup({ client: true }); await client.module.setDriverTrackingSession(client.session); await client.fix(); assert.equal(client.uploads.length, 0);
});
test('tracking display rejects other orders and drivers while retaining the last known stale fix', () => {
  const { validTrackingEvent, trackingAgeStatus, newerTrackingLocation } = compile('../src/useDriverTracking.ts', { react: {}, 'react-native': {}, './api': {}, './navigation': {} });
  const order = { id: 'own', driver: { id: 'driver' }, status: 'ASSIGNED' };
  const event = { orderId: 'own', driverId: 'driver', status: 'ASSIGNED', location: { driverId: 'driver', latitude: 41, longitude: 72, accuracy: 8, timestamp: Date.now() } };
  assert.equal(validTrackingEvent(event, order), true);
  for (const changed of [{ ...event, orderId: 'other' }, { ...event, driverId: 'other' }, { ...event, status: 'COMPLETED' }, { ...event, location: { ...event.location, tripId: 'other' } }, { ...event, location: { ...event.location, latitude: 999 } }]) assert.equal(validTrackingEvent(changed, order), false);
  const stale = { ...event.location, timestamp: Date.now() - 31000 };
  assert.equal(validTrackingEvent({ ...event, location: stale }, order), true);
  assert.equal(trackingAgeStatus(stale).unavailable, true);
  assert.equal(trackingAgeStatus({ ...stale, timestamp: Date.now() - 7000 }).delayed, true);
  assert.equal(trackingAgeStatus({ ...stale, timestamp: Date.now() - 4000 }).delayed, false);
  assert.equal(newerTrackingLocation({ ...event.location, timestamp: 100, sequence: 2, trackingSessionId: 'a' }, { ...event.location, timestamp: 101, sequence: 1, trackingSessionId: 'a' }), false);
  assert.equal(validTrackingEvent(event, { ...order, status: 'COMPLETED' }), false);
});
