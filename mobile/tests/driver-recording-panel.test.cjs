const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/DriverTrackingDiagnostics.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
async function mount(t, options = {}) {
  const timers = new Set(), alerts = [], events = [];
  let state = { recording: false, points: 0, fileName: null, error: null }, result = options.result ?? 'content://saved';
  const diagnostics = () => ({ recording: { ...state }, raw: null, processed: null, ageMs: null, trackingSessionId: null,
    sequence: 0, transportStatus: 'idle', lastDropReason: '', diagnosticMode: 'off' });
  const exports = {};
  const native = { View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', Modal: 'Modal',
    Alert: { alert: (...args) => alerts.push(args) }, StyleSheet: { create: styles => styles, absoluteFill: {} } };
  vm.runInNewContext(code, { exports, process: { env: { EXPO_PUBLIC_TRACKING_DIAGNOSTICS: options.disabled ? undefined : '1' } },
    setInterval: callback => { timers.add(callback); return callback; }, clearInterval: callback => timers.delete(callback),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === './design/theme') return { useTheme: () => ({ palette: { surface: 'white', ink: 'black', muted: '#555', accent: 'blue', accentText: 'white' } }) };
      if (id === './native/driverTracking') return { getDriverTrackingDiagnostics: diagnostics,
        startDriverGpsRecording: () => { state = { recording: true, points: 0, fileName: 'atlas-gps-test.jsonl', error: null }; return true; },
        stopDriverGpsRecording: () => { state.recording = false; return []; }, stopDriverGpsDiagnostic() {}, freezeDriverGps() {}, replayDriverGps() {} };
      if (id === './native/trackingRecorder') return { getTrackingRecording: () => ({ ...state }),
        recordTrackingEvent: (type, data) => { events.push({ type, data }); },
        exportTrackingRecording: async () => { if (result === 'error') throw Error('folder unavailable'); return result; } };
      throw Error(id);
    } });
  const navigation = { active: false, progress: null, followDriver: true, gpsStatus: null, offRouteCount: 0, routeVersion: 0 };
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.DriverTrackingDiagnostics, { navigation, top: 80 })); });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(timers.size, 0); });
  const button = id => renderer.root.findByProps({ testID: id });
  return { renderer, button, alerts, events, get state() { return state; }, setResult: value => { result = value; },
    async press(id) { await act(async () => button(id).props.onPress()); },
    async tick() { await act(async () => { state.points++; for (const timer of timers) timer(); }); },
    async update(patch) { Object.assign(navigation, patch); await act(async () => renderer.update(React.createElement(exports.DriverTrackingDiagnostics, { navigation, top: 80 }))); } };
}
test('recording is accessible before a trip, continues with its window closed and can be saved after completion', async t => {
  const h = await mount(t);
  await h.press('driver-recording-open');
  assert.equal(h.renderer.root.findByType('Modal').props.visible, true);
  await h.press('driver-recording-toggle');
  assert.equal(h.state.recording, true);
  assert.equal(h.button('driver-recording-save').props.disabled, true);
  await act(async () => h.renderer.root.findByType('Modal').props.onRequestClose());
  assert.equal(h.state.recording, true, 'closing diagnostics keeps the real drive recording active');
  await h.update({ active: true, progress: { stepIndex: 2 } });
  await h.tick();
  assert.equal(h.events[0].data.progress.stepIndex, 2);
  await h.update({ active: false, progress: null });
  await h.press('driver-recording-open');
  await h.press('driver-recording-toggle');
  assert.equal(h.state.recording, false);
  assert.equal(h.button('driver-recording-save').props.disabled, false);
  await h.press('driver-recording-save');
  assert.equal(h.alerts.at(-1)[0], 'Файл сохранён');
});
test('export cancellation and failure leave the latest recording available for retry', async t => {
  const h = await mount(t);
  await h.press('driver-recording-toggle');
  await h.press('driver-recording-toggle');
  h.setResult(null);
  await h.press('driver-recording-save');
  assert.equal(h.alerts.length, 0);
  h.setResult('error');
  await h.press('driver-recording-save');
  assert.equal(h.alerts.at(-1)[0], 'Не удалось сохранить файл');
  assert.equal(h.state.fileName, 'atlas-gps-test.jsonl');
  assert.equal(h.button('driver-recording-save').props.disabled, false);
});
test('ordinary releases do not show the recording panel', async t => {
  const h = await mount(t, { disabled: true });
  assert.equal(h.renderer.toJSON(), null);
});

test('recording captures route geometry and maneuvers once per revision for road-test diagnosis', async t => {
  const h = await mount(t);
  const geometry = [{ latitude: 42, longitude: 74 }, { latitude: 42.001, longitude: 74 }];
  const route = { geometry, steps: [{ geometry, distanceMeters: 111,
    maneuver: { type: 'turn', modifier: 'uturn', location: geometry[1], bearingBefore: 0, bearingAfter: 180 } }] };
  await h.update({ active: true, route, routeVersion: 1 });
  await h.tick();
  assert.equal(h.events.length, 0, 'route diagnostics require an active recording');
  await h.press('driver-recording-toggle');
  await h.tick();
  await h.tick();
  assert.equal(h.events.filter(event => event.type === 'route').length, 1);
  assert.equal(h.events.find(event => event.type === 'route').data.steps[0].maneuver.modifier, 'uturn');
  await h.update({ route: { ...route }, routeVersion: 2 });
  await h.tick();
  assert.deepEqual(h.events.filter(event => event.type === 'route').map(event => event.data.routeVersion), [1, 2]);
});
