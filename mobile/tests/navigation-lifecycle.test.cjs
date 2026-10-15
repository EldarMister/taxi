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
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText,
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
  const speaks = [], requests = [], featureRequests = [], diagnosticEvents = [], intervals = new Map();
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
    './native/trackingRecorder': { recordTrackingEvent: (type, data) => diagnosticEvents.push({ type, data }) },
    'expo-keep-awake': { activateKeepAwakeAsync: async () => {}, deactivateKeepAwake: async () => {} },
    './api': { messageOf: error => error.message, api: { request: async (path, init) => {
      if (path === '/routes/road-features') {
        featureRequests.push(JSON.parse(init.body));
        return { features: typeof options.roadFeatures === 'function' ? options.roadFeatures(featureRequests.length) : options.roadFeatures ?? [] };
      }
      if (path === '/routes/match') return null;
      const body = JSON.parse(init.body); requests.push({ path, init, body });
      if (options.legacyRouteServer && ('fast' in body || 'bearing' in body)) {
        const error = new Error(`property ${'fast' in body ? 'fast' : 'bearing'} should not exist`); error.status = 400; throw error;
      }
      if (options.routeFailureAt === requests.length) throw new Error('Сеть недоступна');
      if (options.routePending) return options.routePending.promise;
      if (options.routeResponse) return options.routeResponse;
      const start = body.pickup, end = body.dropoff;
      return { ...route, geometry: [start,end], distanceMeters: navigation.distanceBetween(start,end), steps: [mkStep('depart', start, [start,end]), mkStep('arrive', end, [end])] };
    } } },
  }, { Date: TestDate, setTimeout, clearTimeout, setInterval: callback => { const id = intervals.size + 1; intervals.set(id, callback); return id; }, clearInterval: id => intervals.delete(id) });
  function Probe() { value = hook.useDriverNavigation(props); return null; }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  return {
    get value() { return value; }, get removed() { return removed; }, get stops() { return stops; }, get speechOptions() { return speechOptions; }, get watchConfig() { return watchConfig; }, speaks, requests, featureRequests, voiceStorage, diagnosticEvents,
    async gps(point = a, accuracy = 5) { clock += 1000; await act(async () => { gps({ timestamp: clock, coords: { ...point, accuracy, speed: 10, heading: 0 } }); }); },
    async serviceFix(point = a, accuracy = 5, motion = {}) { clock += 1000; await act(async () => { backgroundFix?.({ ...point, timestamp: clock, accuracy, speed: 10, heading: 0, ...motion }); }); },
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
    await app.gps({ ...a, latitude: 42.87411 });
    assert.equal(app.requests[0].path, '/routes'); assert.equal(app.requests[0].body.dropoff.latitude, b.latitude);
    assert.ok(app.speaks.some(text => /100 метров/.test(text)));
    const count = app.speaks.length;
    await app.gps({ ...a, latitude: 42.87412 });
    assert.equal(app.requests.length, 1); assert.equal(app.speaks.length, count);
  } finally { await app.close(); }
});
test('a visible road sign speaks once and its remaining distance follows GPS progress', async () => {
  const signs = [
    { id: 'stop-1', kind: 'stop', latitude: 42.8727, longitude: 74.59, along: 80 },
    { id: 'stop-2', kind: 'stop', latitude: 42.873, longitude: 74.59, along: 90 },
    { id: 'light-1', kind: 'traffic_light', latitude: 42.8732, longitude: 74.59, along: 100 },
  ];
  const app = await setup({ roadFeatures: signs });
  try {
    await app.gps(a); await app.speechStarted(); await app.run(() => app.speechOptions?.onDone?.()); await app.gps(a);
    assert.equal(app.value.roadFeatures.length, 2);
    assert.equal(app.value.roadFeatures[0].id, 'stop-1');
    assert.equal(app.speaks.filter(text => /знак Стоп/.test(text)).length, 1, JSON.stringify(app.speaks));
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
    assert.equal(app.requests.length, 2, 'a GPS pause on the same road keeps the current route');
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
    await app.gps({ ...a, latitude: 42.87411 });
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

test('navigation preserves validated displacement course when the OS cannot report speed', async () => {
  const app = await setup();
  try {
    await app.serviceFix(a, 3, { speed: undefined, heading: 90, courseSource: 'displacement', courseAccuracyDeg: 20 });
    assert.equal(app.value.position.heading, 90);
    assert.equal(app.value.position.courseSource, 'displacement');
    assert.equal(app.requests[0].body.bearing, 90, 'routing uses the same validated movement course as the marker');
    await app.serviceFix(a, 3, { speed: 0, heading: 90, courseSource: null });
    assert.equal(app.value.position.heading, 90, 'stopping retains the tracker course');
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
    await app.gps({ ...a, latitude: 42.87411 });
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
    await app.gps({ ...a, latitude: 42.87411 });
    await app.run(() => speechStopPending.resolve());
    assert.match(app.speaks.at(-1), /100 метров/);
    assert.doesNotMatch(app.speaks.at(-1), /200 метров/);
  } finally { await app.close(); }
});
test('a GPS gap on the same road resumes guidance without replacing the route', async () => {
  const app = await setup();
  try {
    await app.gps({ ...a, latitude: 42.87411 });
    await app.speechStarted();
    const first = app.speaks.length;
    await app.advance(31000);
    assert.match(app.value.gpsStatus, /Актуальное местоположение недоступно/);
    await app.gps({ ...a, latitude: 42.87411 });
    assert.equal(app.requests.length, 1);
    assert.equal(app.value.rerouteReason, 'initial');
    assert.ok(app.speaks.length >= first + 1);
  } finally { await app.close(); }
});
test('a GPS gap far from the previous road builds a new route', async () => {
  const app = await setup();
  try {
    await app.gps(a);
    await app.advance(31000);
    await app.gps({ latitude: a.latitude, longitude: a.longitude + .002 });
    assert.equal(app.requests.length, 2);
    assert.equal(app.value.rerouteReason, 'gps-gap');
  } finally { await app.close(); }
});
test('Android can use its Russian default voice when enumeration is empty', async () => {
  const app = await setup({ voices: [] });
  try {
    assert.equal(app.value.voiceError, '');
    await app.gps({ ...a, latitude: 42.87411 });
    assert.equal(app.speechOptions.language, 'ru');
    assert.equal(app.speechOptions.voice, undefined);
  } finally { await app.close(); }
});
test('returning from background keeps the route and already spoken instructions', async () => {
  const app = await setup();
  try {
    await app.gps({ ...a, latitude: 42.87411 });
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
test('rerouting starts on the third distinct departing fix without an extra matcher round trip', async () => {
  const app = await setup();
  try {
    await app.gps(); await app.advance(7000);
    const away = { latitude: 42.87, longitude: 74.5908 };
    await app.gps(away); assert.equal(app.requests.length, 1);
    await app.gps({ ...away, longitude: away.longitude + .00010 });
    assert.equal(app.requests.length, 1);
    await app.gps({ ...away, longitude: away.longitude + .00020 });
    assert.equal(app.requests.length, 2);
    assert.equal(app.requests[1].body.fast, true);
    assert.equal(app.requests[1].body.language, 'ru');
    assert.equal(app.requests[1].body.pickup.longitude, away.longitude + .00020);
    assert.deepEqual(app.diagnosticEvents.filter(event => event.type === 'route' && event.data.reason === 'off-route')
      .map(event => event.data.stage), ['requested', 'received', 'applied']);
  } finally { await app.close(); }
});

test('speech delayed by synthesis is rejected before playback when its distance or maneuver has expired', async () => {
  const app = await setup();
  try {
    await app.serviceFix({ ...a, latitude: 42.87411 });
    const queued = app.speechOptions;
    assert.equal(queued.shouldStart(), true);
    await app.serviceFix({ ...a, latitude: 42.87445 });
    assert.equal(queued.shouldStart(), false, 'a hundred-metre instruction cannot start after another 38 metres of driving');
    await app.serviceFix({ ...a, latitude: 42.8749 });
    assert.equal(queued.shouldStart(), false, 'an arrival/next stage also invalidates the old clip');
  } finally { await app.close(); }
});
test('a failed reroute retains the previous geometry and reports the unavailable service', async () => {
  const app = await setup({ routeFailureAt: 2 });
  try {
    await app.gps(a);
    const original = app.value.route;
    await app.advance(8000);
    const away = { latitude: 42.87, longitude: 74.5908 };
    for (let index = 0; index < 3; index++) await app.gps({ ...away, longitude: away.longitude + index * .00010 });
    assert.equal(app.requests.length, 2);
    assert.equal(app.value.route, original);
    assert.match(app.value.error, /Сеть недоступна/);
  } finally { await app.close(); }
});

test('reroute ignores a single excursion, repeated timer renders and stationary off-road jitter', async () => {
  const app = await setup();
  try {
    await app.serviceFix(a);
    await app.serviceFix({ ...a, longitude: a.longitude + .0005 });
    await app.advance(3000);
    assert.equal(app.requests.length, 1, 'timer renders do not count as distinct GPS fixes');
    await app.serviceFix(a);
    for (let i = 0; i < 8; i++) await app.serviceFix({ ...a, longitude: a.longitude + .0005 + (i % 2) * .00003 }, 5, { speed: 0 });
    assert.equal(app.requests.length, 1, 'standing GPS wobble cannot confirm departure');
  } finally { await app.close(); }
});

function maneuverRoute(type, modifier, distance = 80) {
  const via = { latitude: a.latitude + distance / 111195, longitude: a.longitude };
  const after = modifier.includes('sharp') ? 135 : modifier.includes('slight') ? 25 : 90;
  const bearing = modifier.includes('left') ? 360 - after : after;
  const end = { latitude: via.latitude + Math.cos(bearing * Math.PI / 180) * .003,
    longitude: via.longitude + Math.sin(bearing * Math.PI / 180) * .003 / Math.cos(via.latitude * Math.PI / 180) };
  const turn = { ...mkStep(type, via, [via,end]), name: 'улица Ленина',
    maneuver: { type, modifier, location: via, bearingBefore: 0, bearingAfter: bearing } };
  return { ...route, geometry: [a,via,end], distanceMeters: distance + 334,
    steps: [mkStep('depart', a, [a,via]), turn, mkStep('arrive', end, [end])] };
}

test('router modifiers reach the live guidance text and speech for turns and same-road bends', async () => {
  for (const type of ['turn', 'continue']) for (const [modifier, phrase] of [
    ['slight right', 'плавно поверните направо'], ['slight left', 'плавно поверните налево'],
    ['sharp right', 'круто поверните направо'], ['sharp left', 'круто поверните налево'],
  ]) {
    const response = maneuverRoute(type, modifier);
    const app = await setup({ routeResponse: response });
    try {
      await app.gps(a);
      assert.equal(app.value.route.steps[1].maneuver.modifier, modifier);
      assert.ok(app.value.progress.instruction.toLowerCase().startsWith(phrase), `${type}: ${modifier}`);
      assert.ok(app.speaks.some(text => text.includes(`80 метров ${phrase}`)), app.speaks.join('\n'));
      assert.equal(app.speechOptions.shouldStart(), true);
    } finally { await app.close(); }
  }
});

test('early voice preview includes the real bend and discards stale distance before playback', async () => {
  const app = await setup({ routeResponse: maneuverRoute('continue', 'slight right', 450) });
  try {
    await app.gps(a);
    assert.match(app.speaks[0], /^Через 450 метров плавно поверните направо/);
    const queued = app.speechOptions;
    assert.equal(queued.shouldStart(), true);
    await app.serviceFix({ ...a, latitude: a.latitude + 60 / 111195 });
    assert.equal(queued.shouldStart(), false, 'a far preview cannot start with a materially outdated distance');
    await app.run(() => queued.onStopped());
    await app.serviceFix({ ...a, latitude: a.latitude + 62 / 111195 });
    assert.match(app.speaks.at(-1), /^Через 390 метров плавно поверните направо/);
  } finally { await app.close(); }
});

test('camera warnings start at 500 metres and current limit persists to its segment end', async () => {
  const app = await setup({ roadFeatures: [
    { id: 'camera', kind: 'speed_camera', along: 400 },
    { id: 'limit', kind: 'speed_limit', speedLimit: 40, along: 0, endAlong: 200 },
  ] });
  try {
    await app.gps(a); await app.speechStarted(); await app.run(() => app.speechOptions?.onDone?.()); await app.gps(a);
    assert.equal(app.value.currentSpeedLimit, 40);
    assert.match(app.speaks.at(-1), /камера контроля скорости/);
    assert.equal(app.speechOptions.shouldStart(), true, 'camera cue is relevant outside the old 100 metre window');
    await app.speechStarted(); await app.run(() => app.speechOptions?.onDone?.());
    await app.serviceFix({ ...a, latitude: a.latitude + .0006 });
    assert.equal(app.value.currentSpeedLimit, 40);
    assert.ok(app.value.roadFeatures.every(feature => feature.id !== 'limit'), 'passed warning disappears while its limit remains');
    await app.serviceFix({ ...a, latitude: a.latitude + .0012 });
    await app.serviceFix({ ...a, latitude: a.latitude + .0019 });
    assert.equal(app.value.currentSpeedLimit, null, 'leaving the mapped segment clears its speed limit');
  } finally { await app.close(); }
});

test('rolling feature refresh keeps the active limit from the preceding road section', async () => {
  const end = { latitude: a.latitude + .03, longitude: a.longitude };
  const response = { ...route, geometry: [a,end], distanceMeters: 3335,
    steps: [mkStep('depart', a, [a,end]), mkStep('arrive', end, [end])] };
  const app = await setup({ routeResponse: response,
    roadFeatures: call => call === 1 ? [{ id: 'limit', kind: 'speed_limit', speedLimit: 40, along: 0, endAlong: 1200 }]
      : [{ id: 'limit-refreshed', kind: 'speed_limit', speedLimit: 40, along: 685, endAlong: 1885 }] });
  try {
    await app.gps(a);
    assert.equal(app.value.currentSpeedLimit, 40);
    for (let distance = 80; distance <= 800; distance += 80) {
      await app.advance(1000);
      await app.serviceFix({ ...a, latitude: a.latitude + distance / 111195 });
    }
    assert.ok(app.featureRequests.length >= 2, 'driving reaches the next feature window');
    assert.equal(app.value.currentSpeedLimit, 40, 'window eviction preserves the active preceding speed section');
    await app.update({ order: { ...order, status: 'ARRIVED' } });
    assert.equal(app.value.currentSpeedLimit, null, 'ending navigation clears the old road limit');
  } finally { await app.close(); }
});

test('a dense shortened feature window waits for route progress before requesting again', async () => {
  const geometry = [a];
  for (let index = 1; index <= 160; index++) geometry.push({ latitude: a.latitude + index * 2 / 111195,
    longitude: a.longitude + (index % 2 ? 2 : 0) / (111195 * Math.cos(a.latitude * Math.PI / 180)) });
  const end = geometry.at(-1);
  const response = { ...route, geometry, distanceMeters: 453,
    steps: [mkStep('depart', a, geometry), mkStep('arrive', end, [end])] };
  const app = await setup({ routeResponse: response });
  try {
    await app.gps(a);
    assert.equal(app.featureRequests.length, 1);
    assert.ok(app.featureRequests[0].points.length <= 80);
    await app.advance(3000); await app.gps(a); await app.advance(3000);
    assert.equal(app.featureRequests.length, 1, 'a short loaded window is not fetched again while the driver stands still');
  } finally { await app.close(); }
});

test('HUD shows distinct direction arrows and delegates signs to one right-hand alert stack', async () => {
  const navigation = compile('../src/navigation.ts', {});
  const { DriverNavigation } = compile('../src/DriverNavigation.tsx', {
    react: { default: React },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View', StyleSheet: { create: value => value } },
    'react-native-svg': { default: 'Svg', Path: 'Path', Circle: 'Circle' },
    './navigation': navigation, './useDriverNavigation': {},
    './ui': { colors: {}, tr: () => value => value, Icon: () => null },
    './design/theme': { useTheme: () => ({ isDark: false, palette: {} }) },
    './RoadFeatureAlerts': { RoadFeatureAlerts: props => React.createElement('RoadFeatureAlerts', props), SpeedLimitSign: props => React.createElement('SpeedLimitSign', props) },
  });
  const paths = [];
  for (const modifier of ['slight right', 'right', 'sharp right']) {
    const response = maneuverRoute('continue', modifier, 450);
    const instruction = navigation.maneuverText(response.steps[1]);
    const nav = { route: response, progress: { instruction, stepIndex: 1, maneuverDistance: 450, along: 0, offRouteMeters: 0 },
      position: { accuracy: 5 }, loading: false, error: '', gpsStatus: '', voiceError: '', currentSpeedLimit: 40, roadFeatures: [{ id: 'speed', kind: 'speed_limit', speedLimit: 40, along: 0 }] };
    let rendered;
    await act(async () => { rendered = create(React.createElement(DriverNavigation, { navigation: nav, top: 10 })); });
    try {
      assert.ok(rendered.root.findAllByType('Text').some(text => text.props.children === instruction));
      paths.push(rendered.root.findByType('Path').props.d);
      assert.equal(rendered.root.findAllByType('SpeedLimitSign').length, 0, 'the left HUD must not duplicate the right-hand sign');
      assert.equal(rendered.root.findByType('RoadFeatureAlerts').props.features[0].speedLimit, 40);
    } finally { await act(async () => rendered.unmount()); }
  }
  assert.equal(new Set(paths).size, 3, 'slight, normal and sharp bends have different arrow geometry');
});

test('distant traffic lights stay silent until their 150 metre approach', async () => {
  const app = await setup({ roadFeatures: [{ id: 'light', kind: 'traffic_light', along: 200 }] });
  try {
    await app.gps(a); await app.speechStarted(); await app.run(() => app.speechOptions?.onDone?.());
    assert.equal(app.value.roadFeatures.length, 0);
    assert.ok(app.speaks.every(text => !text.includes('светофор')));
    await app.serviceFix({ ...a, latitude: a.latitude + .0005 });
    assert.equal(app.value.roadFeatures.length, 1);
    assert.match(app.speaks.at(-1), /светофор/);
    await app.speechStarted(); await app.run(() => app.speechOptions?.onDone?.());
    await app.serviceFix({ ...a, latitude: a.latitude + .0006 });
    assert.equal(app.speaks.filter(text => text.includes('светофор')).length, 1);
  } finally { await app.close(); }
});
