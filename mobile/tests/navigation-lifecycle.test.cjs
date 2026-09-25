const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
function compile(file, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: id => { if (!(id in dependencies)) throw new Error(`Unexpected import ${id}`); return dependencies[id]; }, Date, AbortController, ...globals });
  return exports;
}
const a = { latitude: 42.87, longitude: 74.59, address: 'Подача' }, b = { latitude: 42.875, longitude: 74.59, address: 'Назначение' };
const mkStep = (type, location, geometry) => ({ distanceMeters: 555, durationSeconds: 70, name: 'Улица', geometry, maneuver: { type, location, bearingBefore: 0, bearingAfter: 0 } });
const route = { provider: 'osrm', distanceMeters: 555, durationSeconds: 70, geometry: [a,b], steps: [mkStep('depart', a, [a,b]), mkStep('arrive', b, [b])] };
const order = { id: 'order1', status: 'ASSIGNED', pickup: b, dropoff: a };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function setup(options = {}) {
  let clock = Date.now(), props = { userId: 'driver1', enabled: true, locationEnabled: true, mapVisible: options.initialMapVisible ?? true, language: options.language ?? 'ru', order: options.initialOrder === undefined ? order : options.initialOrder }, value, renderer;
  let appStateListener, gps, gpsError, watchConfig, backgroundFix, speechOptions, removed = 0, stops = 0;
  const speaks = [], requests = [], intervals = new Map();
  const voiceStorage = options.voiceStorage ?? new Map();
  class TestDate extends Date { static now() { return clock; } }
  const navigation = compile('../src/navigation.ts', {}, { Date: TestDate });
  const roadFeatures = compile('../src/roadFeatures.ts', {});
  let lastReliableFix = null, pendingJump = null;
  const hook = compile('../src/useDriverNavigation.ts', {
    react: React, './navigation': navigation, './roadFeatures': roadFeatures,
    './native/driverTracking': { setDriverTrackingSession: async () => {}, startDriverBackgroundTracking: async () => options.backgroundReady ?? false, requestDriverBackgroundAccess: async () => true,
      ingestDriverLocation: async raw => {
        if (!navigation.usableNavigationFix(raw, clock)) return null;
        const fix = navigation.stableNavigationFix(lastReliableFix, raw, clock, pendingJump);
        if (fix.timestamp !== raw.timestamp) { pendingJump = raw; return null; }
        pendingJump = null; lastReliableFix = fix; backgroundFix?.(fix); return fix;
      },
      subscribeDriverFix: callback => { backgroundFix = callback; return () => { backgroundFix = undefined; }; } },
    'react-native': { Platform: { OS: 'android' }, AppState: { currentState: 'active', addEventListener: (_, callback) => { appStateListener = callback; return { remove() {} }; } } },
    'expo-location': { Accuracy: { BestForNavigation: 'navigation' }, getLastKnownPositionAsync: async config => {
      assert.equal(config.maxAge, 5000);
      return options.lastKnown ? { timestamp: clock - 1000, coords: { ...options.lastKnown, accuracy: 8, speed: 0, heading: 0 } } : null;
    }, watchPositionAsync: async (config, callback, errorCallback) => {
      gps = callback; gpsError = errorCallback; watchConfig = config; assert.equal(config.accuracy, 'navigation');
      assert.equal(config.distanceInterval, 0, 'the driver map must keep its GPS fix fresh even while stopped');
      if (options.watchPending) await options.watchPending.promise;
      return { remove: () => removed++ };
    } },
    'expo-speech': { getAvailableVoicesAsync: async () => options.voices ?? [{ identifier: 'ru', language: 'ru-RU' }], stop: async () => { stops++; if (options.speechStopPending && speaks.length) await options.speechStopPending.promise; }, speak: (text, options) => { speaks.push(text); speechOptions = options; } },
    'expo-secure-store': { getItemAsync: async key => voiceStorage.get(key) ?? null, setItemAsync: async (key, value) => { voiceStorage.set(key, value); } },
    './native/routeVoice': { routeVoice: {
      stop: async () => { stops++; if (options.speechStopPending && speaks.length) await options.speechStopPending.promise; },
      speak: (text, options) => { speaks.push(text); speechOptions = options; },
    } },
    'expo-keep-awake': { activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} },
    './api': { messageOf: error => error.message, api: { request: async (path, init) => {
      if (path === '/routes/road-features') return { features: options.roadFeatures ?? [] };
      const body = JSON.parse(init.body); requests.push({ path, init, body });
      if (options.legacyRouteServer && ('fast' in body || 'bearing' in body)) {
        const error = new Error(`property ${'fast' in body ? 'fast' : 'bearing'} should not exist`); error.status = 400; throw error;
      }
      if (options.routeFailureAt === requests.length) throw new Error('Сеть недоступна');
      if (options.routePending) return options.routePending.promise;
      const start = body.pickup, end = body.dropoff;
      return { ...route, geometry: [start,end], distanceMeters: navigation.distanceBetween(start,end), steps: [mkStep('depart', start, [start,end]), mkStep('arrive', end, [end])] };
    } } },
  }, { Date: TestDate, setTimeout, clearTimeout, setInterval: callback => { const id = intervals.size + 1; intervals.set(id, callback); return id; }, clearInterval: id => intervals.delete(id) });
  function Probe() { value = hook.useDriverNavigation(props); return null; }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  return {
    get value() { return value; }, get removed() { return removed; }, get stops() { return stops; }, get speechOptions() { return speechOptions; }, get watchConfig() { return watchConfig; }, speaks, requests, voiceStorage,
    async gps(point = a, accuracy = 5) { clock += 1000; await act(async () => { gps({ timestamp: clock, coords: { ...point, accuracy, speed: 10, heading: 0 } }); }); },
    async serviceFix(point = a, accuracy = 5) { clock += 1000; await act(async () => { backgroundFix?.({ ...point, timestamp: clock, accuracy, speed: 10, heading: 0 }); }); },
    async advance(milliseconds) { clock += milliseconds; await act(async () => { for (const callback of intervals.values()) callback(); }); },
    async state(state) { await act(async () => appStateListener(state)); },
    async gpsFailure() { await act(async () => gpsError('GPS unavailable')); },
    async speechStarted() { await act(async () => speechOptions?.onStart?.()); },
    async speechFailed() { await act(async () => speechOptions?.onError?.(new Error('TTS failed'))); },
    async update(next) { props = { ...props, ...next }; await act(async () => renderer.update(React.createElement(Probe))); },
    async run(callback) { await act(async () => callback()); },
    async close() { await act(async () => renderer.unmount()); },
  };
}
test('idle driver uses a fresh location before the GPS watch reports a new fix', async () => {
  const app = await setup({ initialOrder: null, lastKnown: { latitude: 41.1987, longitude: 72.1802 } });
  try {
    assert.equal(app.value.active, false);
    assert.equal(app.value.position.latitude, 41.1987);
    assert.equal(app.watchConfig.distanceInterval, 0);
  } finally { await app.close(); }
});
test('active native foreground service and fast map GPS watcher keep the latest fix', async () => {
  const app = await setup({ backgroundReady: true });
  try {
    assert.equal(app.value.backgroundReady, true);
    assert.equal(app.removed, 0);
    assert.equal(app.watchConfig.timeInterval, 1000);
    await app.serviceFix(a);
    assert.equal(app.value.position.latitude, a.latitude);
  } finally { await app.close(); }
});
test('returning to the driver map or foreground resumes following the live location', async () => {
  const app = await setup({ initialOrder: null });
  try {
    await app.run(() => app.value.setFollowDriver(false));
    assert.equal(app.value.followDriver, false);
    await app.state('background');
    await app.state('active');
    assert.equal(app.value.followDriver, true);
    await app.run(() => app.value.setFollowDriver(false));
    await app.update({ mapVisible: false });
    assert.equal(app.value.followDriver, false);
    await app.update({ mapVisible: true });
    assert.equal(app.value.followDriver, true);
  } finally { await app.close(); }
});
test('a new trip stage resets a paused map to driver follow', async () => {
  const app = await setup();
  try {
    await app.run(() => app.value.setFollowDriver(false));
    await app.update({ order: { ...order, status: 'ARRIVED' } });
    assert.equal(app.value.followDriver, true);
  } finally { await app.close(); }
});
test('active navigation resumes a paused camera after a short inspection and a fresh GPS fix', async () => {
  const app = await setup();
  try {
    await app.gps(a);
    await app.run(() => app.value.setFollowDriver(false));
    assert.equal(app.value.followDriver, false);
    await app.advance(12000);
    assert.equal(app.value.followDriver, false, 'stale GPS must not recenter the camera');
    await app.gps(a);
    assert.equal(app.value.followDriver, true);
  } finally { await app.close(); }
});
test('navigation uses authenticated endpoint and does not reload on each GPS fix; cue is spoken once', async () => {
  const app = await setup();
  try {
    await app.gps({ ...a, latitude: 42.8741 });
    assert.equal(app.requests[0].path, '/routes'); assert.equal(app.requests[0].body.dropoff.latitude, b.latitude);
    assert.ok(app.speaks.some(text => /100 метров/.test(text)));
    const count = app.speaks.length;
    await app.gps({ ...a, latitude: 42.87412 });
    assert.equal(app.requests.length, 1); assert.equal(app.speaks.length, count);
  } finally { await app.close(); }
});
test('a visible road sign speaks once and its remaining distance follows GPS progress', async () => {
  const signs = [
    { id: 'stop-1', kind: 'stop', latitude: 42.8727, longitude: 74.59, along: 300 },
    { id: 'stop-2', kind: 'stop', latitude: 42.873, longitude: 74.59, along: 330 },
    { id: 'light-1', kind: 'traffic_light', latitude: 42.8732, longitude: 74.59, along: 350 },
  ];
  const app = await setup({ roadFeatures: signs });
  try {
    await app.gps(a); await app.gps(a);
    assert.equal(app.value.roadFeatures.length, 2);
    assert.equal(app.value.roadFeatures[0].id, 'stop-1');
    assert.equal(app.speaks.filter(text => /знак Стоп/.test(text)).length, 1);
    assert.match(app.speaks.find(text => /знак Стоп/.test(text)), /светофор/);
    const before = app.value.roadFeatures[0].along - app.value.progress.along;
    await app.speechStarted();
    await app.run(() => app.speechOptions?.onDone?.());
    await app.gps({ ...a, latitude: 42.8702 });
    assert.ok(app.value.roadFeatures[0].along - app.value.progress.along < before);
    await app.advance(3000);
    assert.equal(app.speaks.filter(text => /знак Стоп/.test(text)).length, 1);
  } finally { await app.close(); }
});
test('inaccurate and stale GPS stops prompts; muting cancels and blocks speech', async () => {
  const app = await setup();
  try {
    await app.gps(a, 200); assert.equal(app.requests.length, 0); assert.match(app.value.gpsStatus, /Слабый/); assert.equal(app.value.position, null);
    await app.gps(a); await app.run(() => app.value.toggleVoice()); const count = app.speaks.length;
    await app.gps({ ...a, latitude: 42.874 }); assert.equal(app.speaks.length, count);
    await app.advance(31000); assert.match(app.value.gpsStatus, /Актуальное местоположение недоступно/); assert.ok(app.value.position); assert.ok(app.stops > 0);
  } finally { await app.close(); }
});
test('background removes GPS and cancels pending route; late result cannot revive navigation', async () => {
  const pending = deferred(), app = await setup({ routePending: pending });
  try {
    await app.gps(); assert.equal(app.requests.length, 1);
    await app.state('background'); assert.equal(app.removed, 1); assert.equal(app.requests[0].init.signal.aborted, true);
    await app.run(() => pending.resolve(route)); assert.equal(app.value.route, null); assert.equal(app.speaks.length, 0);
  } finally { await app.close(); }
});
test('late native GPS subscription is removed after unmount', async () => {
  const pending = deferred(), app = await setup({ watchPending: pending });
  await app.close(); await app.run(() => pending.resolve()); assert.equal(app.removed, 1);
});
test('a route received after GPS is stale and fails cannot resume voice guidance', async () => {
  const pending = deferred(), app = await setup({ routePending: pending });
  try {
    await app.gps(); await app.advance(31000); await app.gpsFailure(); await app.run(() => pending.resolve(route));
    assert.match(app.value.gpsStatus, /Актуальное местоположение недоступно/); assert.equal(app.speaks.length, 0);
  } finally { await app.close(); }
});
test('driver navigation retries without unsupported route fields on the deployed legacy server', async () => {
  const app = await setup({ legacyRouteServer: true });
  try {
    await app.gps(a);
    assert.equal(app.requests.length, 2);
    assert.equal(app.requests[0].body.bearing, 0);
    assert.equal(app.requests[1].body.bearing, undefined);
    assert.ok(app.value.route?.geometry?.length > 1);
    assert.equal(app.value.error, '');
    await app.advance(31000);
    await app.gps({ ...a, latitude: a.latitude + .0001 });
    assert.equal(app.requests.at(-1).body.fast, undefined);
    assert.equal(app.requests.at(-1).body.bearing, undefined);
  } finally { await app.close(); }
});
test('route voice choice persists for the driver across app sessions', async () => {
  const voiceStorage = new Map();
  const first = await setup({ voiceStorage });
  try {
    await first.run(() => first.value.setVoiceEnabled(false));
    assert.equal(voiceStorage.get('atlas.driver.routeVoice.v1.driver1'), '0');
  } finally { await first.close(); }
  const second = await setup({ voiceStorage });
  try { assert.equal(second.value.voiceEnabled, false); }
  finally { await second.close(); }
});
test('driver route request carries the selected language into road-name lookup', async () => {
  const app = await setup({ language: 'ky' });
  try {
    await app.gps({ ...a, latitude: 42.8741 });
    assert.equal(app.requests[0].body.language, 'ky');
    assert.equal(app.speechOptions.language, 'ky');
  } finally { await app.close(); }
});
test('the driver keeps the last position while 5-second and 15-second freshness states change', async () => {
  const app = await setup();
  try {
    await app.gps(a);
    await app.advance(6000);
    assert.match(app.value.gpsStatus, /Местоположение обновляется с задержкой/);
    assert.equal(app.value.position.latitude, a.latitude);
    await app.advance(10000);
    assert.match(app.value.gpsStatus, /Актуальное местоположение недоступно/);
    assert.equal(app.value.position.latitude, a.latitude);
  } finally { await app.close(); }
});
test('a transient GPS error keeps the recent fix and recovers on the next update', async () => {
  const app = await setup();
  try {
    await app.gps(); await app.gpsFailure();
    assert.equal(app.value.gpsStatus, '');
    await app.gps({ ...a, latitude: 42.8702 });
    assert.equal(app.value.gpsStatus, '');
  } finally { await app.close(); }
});

test('foreground navigation accepts a fresh service GPS fix when the watch stream pauses', async () => {
  const app = await setup();
  try {
    await app.gps(a);
    await app.advance(31000);
    assert.ok(app.value.position);
    await app.serviceFix({ ...a, latitude: a.latitude + .0002 });
    assert.ok(app.value.position);
    assert.equal(app.value.gpsStatus, '');
  } finally { await app.close(); }
});

test('driver position ignores a single far GPS spike and reacquires on confirmation', async () => {
  const app = await setup();
  try {
    await app.gps(a);
    const newPlace = { ...a, latitude: a.latitude + .01 };
    await app.gps(newPlace);
    assert.equal(app.value.position.latitude, a.latitude);
    await app.gps({ ...newPlace, latitude: newPlace.latitude + .00002 });
    assert.ok(app.value.position.latitude > a.latitude + .009);
  } finally { await app.close(); }
});
test('speech failure leaves a cue eligible for the next GPS update', async () => {
  const app = await setup();
  try {
    await app.gps({ ...a, latitude: 42.8741 });
    const first = app.speaks.length;
    await app.speechFailed();
    await app.gps({ ...a, latitude: 42.87411 });
    assert.equal(app.speaks.length, first + 1);
  } finally { await app.close(); }
});
test('a queued instruction refreshes its distance immediately before speech starts', async () => {
  const speechStopPending = deferred(), app = await setup({ speechStopPending });
  try {
    await app.gps({ ...a, latitude: 42.8705 });
    await app.speechStarted();
    await app.advance(10000);
    await app.gps({ ...a, latitude: 42.8732 });
    assert.equal(app.speaks.length, 1, 'the new cue waits while the old speech queue is cleared');
    await app.advance(10000);
    await app.gps({ ...a, latitude: 42.8741 });
    await app.run(() => speechStopPending.resolve());
    assert.match(app.speaks.at(-1), /100 метров/);
    assert.doesNotMatch(app.speaks.at(-1), /200 метров/);
  } finally { await app.close(); }
});
test('a GPS gap cancels stale speech and rebuilds guidance from the fresh fix', async () => {
  const app = await setup();
  try {
    await app.gps({ ...a, latitude: 42.8741 });
    await app.speechStarted();
    const first = app.speaks.length;
    await app.advance(31000);
    assert.match(app.value.gpsStatus, /Актуальное местоположение недоступно/);
    await app.gps({ ...a, latitude: 42.87411 });
    assert.equal(app.requests.length, 2);
    assert.equal(app.value.rerouteReason, 'gps-gap');
    assert.ok(app.speaks.length >= first + 1);
  } finally { await app.close(); }
});
test('Android can use its Russian default voice when enumeration is empty', async () => {
  const app = await setup({ voices: [] });
  try {
    assert.equal(app.value.voiceError, '');
    await app.gps({ ...a, latitude: 42.8741 });
    assert.equal(app.speechOptions.language, 'ru');
    assert.equal(app.speechOptions.voice, undefined);
  } finally { await app.close(); }
});
test('returning from background keeps the route and already spoken instructions', async () => {
  const app = await setup();
  try {
    await app.gps({ ...a, latitude: 42.8741 });
    await app.speechStarted();
    const cues = app.speaks.length;
    await app.state('background'); await app.state('active');
    await app.gps({ ...a, latitude: 42.87411 });
    assert.equal(app.requests.length, 1);
    assert.equal(app.speaks.length, cues);
  } finally { await app.close(); }
});
test('trip start changes target; terminal status aborts old work and stops guidance', async () => {
  const app = await setup();
  try {
    await app.gps(); await app.update({ order: { ...order, status: 'IN_PROGRESS' } });
    assert.equal(app.requests.at(-1).body.dropoff.latitude, a.latitude);
    await app.update({ order: { ...order, status: 'COMPLETED' } });
    assert.equal(app.value.active, false); assert.equal(app.value.route, null);
  } finally { await app.close(); }
});
test('three confirmed accurate off-route fixes trigger prompt rerouting', async () => {
  const app = await setup();
  try {
    await app.gps(); await app.advance(7000);
    const away = { latitude: 42.87, longitude: 74.596 };
    await app.gps(away); assert.equal(app.requests.length, 1);
    await app.advance(1000); await app.gps(away); assert.equal(app.requests.length, 1);
    await app.gps(away); assert.equal(app.requests.length, 1);
    await app.gps(away); assert.equal(app.requests.length, 2);
  } finally { await app.close(); }
});
test('a failed reroute retains the previous geometry and reports the unavailable service', async () => {
  const app = await setup({ routeFailureAt: 2 });
  try {
    await app.gps(a);
    const original = app.value.route;
    await app.advance(8000);
    const away = { latitude: 42.87, longitude: 74.596 };
    await app.gps(away); await app.gps(away); await app.gps(away); await app.gps(away);
    assert.equal(app.requests.length, 2);
    assert.equal(app.value.route, original);
    assert.match(app.value.error, /Сеть недоступна/);
  } finally { await app.close(); }
});
