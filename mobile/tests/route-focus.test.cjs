const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/native/routeFocus.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api });
const { initialRouteFocus, stepRouteFocus, clearRouteFocusCallout, reconcileRouteFocus,
  canLocatePickup, compactPickupForZoom } = api;
const pickup = Object.freeze({ latitude: 42.8746, longitude: 74.5698, address: 'Чуй, 100' });
const dropoff = Object.freeze({ latitude: 42.8812, longitude: 74.5764, address: 'Ленина, 39' });
const points = Object.freeze({ pickup, dropoff });

test('booking control focuses pickup, destination and the complete route in order', () => {
  let result = stepRouteFocus(initialRouteFocus(), points);
  assert.equal(result.action.type, 'focus-point');
  assert.equal(result.action.field, 'pickup');
  assert.equal(result.action.point, pickup);
  assert.equal(result.state.callout, 'pickup');
  assert.equal(result.state.next, 'dropoff');
  result = stepRouteFocus(result.state, points);
  assert.equal(result.action.field, 'dropoff');
  assert.equal(result.action.point, dropoff);
  assert.equal(result.state.callout, 'dropoff');
  assert.equal(result.state.next, 'route');
  result = stepRouteFocus(result.state, points);
  assert.equal(result.action.type, 'fit-route');
  assert.equal(result.state.callout, null);
  assert.equal(result.state.next, 'pickup');
  assert.equal(stepRouteFocus(result.state, points).action.field, 'pickup');
});

test('panning dismisses a focused callout and preserves the next cycle action', () => {
  const focused = stepRouteFocus(initialRouteFocus(), points).state;
  const dismissed = clearRouteFocusCallout(focused);
  assert.equal(dismissed.callout, null);
  assert.equal(dismissed.next, 'dropoff');
  assert.equal(focused.callout, 'pickup');
  assert.equal(clearRouteFocusCallout(dismissed), dismissed);
  assert.equal(stepRouteFocus(dismissed, points).action.field, 'dropoff');
});

test('camera focus always uses the latest point and leaves endpoints intact', () => {
  const nextDropoff = Object.freeze({ ...dropoff, latitude: dropoff.latitude + .001 });
  const focused = stepRouteFocus(initialRouteFocus(), points).state;
  const result = stepRouteFocus(focused, { pickup, dropoff: nextDropoff });
  assert.equal(result.action.point, nextDropoff);
  assert.equal(points.pickup, pickup);
  assert.equal(points.dropoff, dropoff);
  assert.equal(dropoff.latitude, 42.8812);
});

test('removed endpoints cannot preserve absent callouts or a whole-route action', () => {
  const focused = stepRouteFocus(stepRouteFocus(initialRouteFocus(), points).state, points).state;
  const reconciled = reconcileRouteFocus(focused, { pickup });
  assert.equal(reconciled.callout, null);
  assert.equal(reconciled.next, 'pickup');
  assert.equal(stepRouteFocus(reconciled, { pickup }).action.field, 'pickup');
  const none = stepRouteFocus(focused, {});
  assert.equal(none.action, null);
  assert.equal(none.state.callout, null);
  assert.equal(none.state.next, 'pickup');
});

test('invalid points are skipped while legitimate zero coordinates remain focusable', () => {
  for (const invalid of [{ latitude: NaN, longitude: 74 }, { latitude: 91, longitude: 74 },
    { latitude: 42, longitude: Infinity }, { latitude: 42, longitude: -181 }]) {
    const result = stepRouteFocus(initialRouteFocus(), { pickup: invalid, dropoff });
    assert.equal(result.action.field, 'dropoff');
    assert.equal(result.state.next, 'dropoff');
  }
  const zero = { latitude: 0, longitude: 0 };
  assert.equal(stepRouteFocus(initialRouteFocus(), { pickup: zero }).action.point, zero);
});

test('GPS is available only for selecting pickup before a destination and without an overlay', () => {
  assert.equal(canLocatePickup({ field: 'pickup' }), true);
  assert.equal(canLocatePickup({ field: 'pickup', dropoff: null }), true);
  assert.equal(canLocatePickup({ field: 'pickup', dropoff }), false);
  assert.equal(canLocatePickup({ field: 'dropoff' }), false);
  assert.equal(canLocatePickup({ field: null }), false);
  assert.equal(canLocatePickup({ field: 'pickup', blocked: true }), false);
  assert.equal(canLocatePickup({ field: 'pickup', dropoff: { latitude: NaN, longitude: 74 } }), true);
});

test('zoom switches the pickup layout with hysteresis during a pinch', () => {
  assert.equal(compactPickupForZoom(false, 14.5), true);
  assert.equal(compactPickupForZoom(false, 14.7), false);
  assert.equal(compactPickupForZoom(true, 14.7), true);
  assert.equal(compactPickupForZoom(true, 15), false);
  assert.equal(compactPickupForZoom(false, 16), false);
  assert.equal(compactPickupForZoom(true, NaN), true);
  assert.equal(compactPickupForZoom(false, NaN), false);
});
