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
  let now = Date.now(), callback, started = false, stops = 0, tokens = true, releaseNetwork = () => {};
  const storage = new Map(), uploads = [], speaks = [], routes = [];
  const AppState = { currentState: options.foreground ? 'active' : 'background' };
  class Clock extends Date { static now() { return now; } }
  class ApiError extends Error { constructor(status) { super('error'); this.status = status; } }
  const a = { latitude: 41.1987, longitude: 72.1802, address: 'Подача' }, b = { ...a, latitude: 41.1996 }, c = { ...b, longitude: 72.181 };
  const step = (type, location, geometry) => ({ name: 'улица Ленина', geometry, distanceMeters: 100, durationSeconds: 20, maneuver: { type, modifier: 'right', location, bearingBefore: 0, bearingAfter: 90 } });
  const order = { id: 'order', status: 'ASSIGNED', pickup: c, dropoff: a };
  const session = { userId: 'driver', order, voice: true };
  const navigation = compile('../src/navigation.ts', {}, { Date: Clock });
  const module = compile('../src/native/driverTracking.ts', {
    'expo-location': { Accuracy: { BestForNavigation: 6 }, ActivityType: { AutomotiveNavigation: 1 }, getBackgroundPermissionsAsync: async () => ({ granted: options.permission !== false }), getForegroundPermissionsAsync: async () => ({ granted: options.permission !== false, android: { accuracy: options.coarse ? 'coarse' : 'fine' } }), hasStartedLocationUpdatesAsync: async () => started, startLocationUpdatesAsync: async (_task, config) => { assert.equal(config.foregroundService.killServiceOnDestroy, true); assert.equal(config.timeInterval, 1000); started = true; }, stopLocationUpdatesAsync: async () => { started = false; stops++; } },
    'expo-task-manager': { defineTask: (_name, task) => { callback = task; } },
    'expo-secure-store': { getItemAsync: async key => storage.get(key), setItemAsync: async (key, value) => storage.set(key, value), deleteItemAsync: async key => storage.delete(key) },
    'expo-speech': { getAvailableVoicesAsync: async () => [{ identifier: 'ru-offline', language: 'ru-RU', quality: 'Enhanced' }], stop: async () => {}, speak: text => speaks.push(text) },
    'react-native': { AppState, Platform: { OS: 'android' }, Alert: {}, Linking: {} },
    '../appVariant': { isRoleAllowed: () => !options.client }, '../navigation': navigation,
    '../api': { ApiError, api: { getTokens: () => tokens, restore: async () => tokens, patch: async (path, fix) => { uploads.push({ path, fix }); if (options.rejected) throw new ApiError(403); if (options.networkFailure) throw new Error('offline'); if (options.hangingNetwork) await new Promise(resolve => { releaseNetwork = resolve; }); return { orderId: 'order', driverId: 'driver', status: 'ASSIGNED', pickup: c, dropoff: a }; }, post: async (path, body) => { routes.push(body); return { provider: 'osrm', distanceMeters: 170, durationSeconds: 30, geometry: [a,b,c], steps: [step('depart',a,[a,b]),step('turn',b,[b,c]),step('arrive',c,[c])] }; } } },
  }, { Date: Clock });
  return { module, session, AppState, uploads, speaks, routes, storage, releaseNetwork: () => releaseNetwork(), get stops() { return stops; }, get started() { return started; }, async fix(age = 0, coords = {}) { now += 3000; await callback({ data: { locations: [{ timestamp: now - age, coords: { ...a, accuracy: 8, heading: 0, speed: 10, ...coords } }] } }); } };
}
test('background task uploads only the active order and announces metres plus street', async () => {
  const h = setup(); await h.module.setDriverTrackingSession(h.session);
  await h.fix(); assert.equal(h.uploads[0].path, '/orders/order/driver-location');
  assert.equal(h.uploads[0].fix.driverId, 'driver');
  assert.equal(h.uploads[0].fix.tripId, 'order');
  assert.equal(h.uploads[0].fix.sequence, 1);
  assert.ok(h.uploads[0].fix.trackingStartedAt <= h.uploads[0].fix.measuredAt);
  assert.equal(h.uploads[0].fix.measuredAt, h.uploads[0].fix.timestamp);
  assert.equal(h.uploads[0].fix.accuracyM, h.uploads[0].fix.accuracy);
  assert.match(h.speaks[0], /Через 100 метров поверните направо на улицу Ленина/);
  await h.fix(); assert.equal(h.speaks.length, 1, 'same maneuver stage is not repeated');
  assert.equal(h.uploads[1].fix.sequence, 2);
  assert.equal(h.uploads[1].fix.trackingSessionId, h.uploads[0].fix.trackingSessionId);
  await h.fix(35000); assert.equal(h.uploads.length, 2, 'stale native batch is discarded');
  await h.module.setDriverTrackingSession(null); await h.fix(); assert.equal(h.uploads.length, 2);
});

test('stationary background fixes refresh the upload without moving the car', async () => {
  const h = setup(); await h.module.setDriverTrackingSession(h.session);
  await h.fix(0, { speed: 0, heading: 90, accuracy: 20 });
  await h.fix(0, { speed: 0, heading: 240, accuracy: 20, latitude: 41.19875 });
  assert.equal(h.uploads.length, 2);
  assert.equal(h.uploads[1].fix.latitude, h.uploads[0].fix.latitude);
  assert.equal(h.uploads[1].fix.heading, h.uploads[0].fix.heading);
  assert.ok(h.uploads[1].fix.timestamp > h.uploads[0].fix.timestamp);
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
test('revoked assignment stops reporting and never plays a route; client task cannot upload', async () => {
  const h = setup({ rejected: true }); await h.module.setDriverTrackingSession(h.session);
  await h.fix(); await h.fix(); assert.equal(h.uploads.length, 1); assert.equal(h.speaks.length, 0); assert.equal(h.storage.size, 0);
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
