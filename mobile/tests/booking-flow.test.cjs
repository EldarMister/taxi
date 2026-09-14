const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
const point = (address, latitude = 42.87) => ({ address, latitude, longitude: 74.57 });
const tariffs = [{ id: 'eco' }, { id: 'comfort' }];
async function setup(t) {
  let current, renderer, now = 1000000, next = 0;
  const timeouts = new Map(), intervals = new Map(), calls = [], appListeners = new Set();
  const exports = {};
  class TestDate extends Date { static now() { return now; } }
  vm.runInNewContext(compile('useRideQuotes.ts'), {
    exports, Date: TestDate,
    setTimeout: callback => { const id = ++next; timeouts.set(id, callback); return id; }, clearTimeout: id => timeouts.delete(id),
    setInterval: callback => { const id = ++next; intervals.set(id, callback); return id; }, clearInterval: id => intervals.delete(id),
    require: id => {
      if (id === 'react') return React;
      if (id === 'react-native') return { AppState: { currentState: 'active', addEventListener: (_event, listener) => {
        appListeners.add(listener); return { remove: () => appListeners.delete(listener) };
      } } };
      if (id === './types') return { normalizePoint: p => p };
      if (id === './api') return { messageOf: e => e.message, api: { post: (url, body) => new Promise((resolve, reject) => calls.push({ url, body, resolve, reject })) } };
      throw Error(id);
    },
  });
  const args = { pickup: point('A'), dropoff: point('B', 42.9), tariffs, tariffId: 'eco', enabled: true, accountId: 'client-a' };
  function Probe() { current = exports.useRideQuotes(args.pickup, args.dropoff, args.tariffs, args.tariffId, args.enabled, args.accountId); return null; }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(timeouts.size, 0); assert.equal(intervals.size, 0); assert.equal(appListeners.size, 0); });
  return {
    calls, get value() { return current; },
    change: async values => { Object.assign(args, values); await act(async () => renderer.update(React.createElement(Probe))); },
    flush: async () => act(async () => { const all = [...timeouts.values()]; timeouts.clear(); all.forEach(callback => callback()); }),
    resolve: async (index, price = 150) => act(async () => calls[index].resolve({ id: `quote-${index}`, price, expiresAt: new Date(now + 300000).toISOString() })),
    reject: async index => act(async () => calls[index].reject(new Error('Нет соединения'))),
    advance: async seconds => act(async () => { now += seconds * 1000; intervals.forEach(callback => callback()); }),
    appState: async state => act(async () => { appListeners.forEach(listener => listener(state)); }),
    refresh: async () => act(async () => current.refresh()),
  };
}
test('selecting addresses automatically loads real prices for each tariff; switching tariff reuses its quote', async t => {
  const h = await setup(t);
  assert.equal(h.value.calculating, true);
  await h.flush(); assert.equal(h.calls.length, 2);
  await h.resolve(0, 150); await h.resolve(1, 180);
  assert.equal(h.value.quote.price, 150);
  await h.change({ tariffId: 'comfort' });
  assert.equal(h.value.quote.price, 180); assert.equal(h.calls.length, 2);
});

test('an admin tariff rate update replaces old route quotes even when tariff IDs stay the same', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0, 150); await h.resolve(1, 180);
  await h.change({ tariffs: [{ id: 'eco', basePrice: 50, pricePerKm: 25, pricePerMinute: 0, minimumPrice: 50 }, { id: 'comfort' }] });
  assert.equal(h.value.quote, null);
  assert.equal(h.value.calculating, true);
  await h.flush(); assert.equal(h.calls.length, 4);
  await h.resolve(2, 175); await h.resolve(3, 180);
  assert.equal(h.value.quote.price, 175);
});
test('a route edit immediately removes its price and late responses cannot replace the new route', async t => {
  const h = await setup(t); await h.flush();
  await h.change({ dropoff: point('C', 42.95) });
  assert.equal(h.value.quote, null); await h.flush();
  await h.resolve(2, 210); await h.resolve(3, 250);
  await h.resolve(0, 150); await h.resolve(1, 180);
  assert.equal(h.value.quote.price, 210);
  await h.change({ pickup: null }); assert.equal(h.value.quote, null); assert.equal(h.value.calculating, false);
});
test('quotes refresh before expiry without hiding a still valid price', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0); await h.resolve(1);
  await h.advance(269); await h.flush(); assert.equal(h.calls.length, 2);
  await h.advance(1); await h.flush(); assert.equal(h.calls.length, 4);
  assert.equal(h.value.quote.price, 150); assert.equal(h.value.calculating, false); assert.equal(h.value.quoteError, '');
  await h.advance(31); assert.equal(h.value.quote, null); assert.equal(h.value.calculating, true); assert.equal(h.value.quoteError, '');
  await h.resolve(2, 160); await h.resolve(3, 190);
  assert.equal(h.value.quote.price, 160);
  await h.advance(270); await h.flush(); assert.equal(h.calls.length, 6);
});

test('returning from background refreshes expired prices automatically; background does not poll', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0); await h.resolve(1);
  await h.appState('background'); await h.advance(600); await h.flush(); assert.equal(h.calls.length, 2);
  await h.appState('active'); assert.equal(h.value.quote, null); assert.equal(h.value.calculating, true);
  await h.flush(); assert.equal(h.calls.length, 4);
  await h.resolve(2, 165); await h.resolve(3, 195); assert.equal(h.value.quote.price, 165);
});

test('failed automatic refresh keeps valid prices and retries after a delay, never in a loop', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0); await h.resolve(1);
  await h.advance(270); await h.flush(); await h.reject(2); await h.reject(3);
  assert.equal(h.value.quote.price, 150); assert.equal(h.value.quoteError, '');
  await h.advance(29); await h.flush(); assert.equal(h.calls.length, 4);
  await h.advance(1); await h.flush(); assert.equal(h.calls.length, 6); assert.equal(h.value.quote, null);
  await h.reject(4); await h.reject(5); assert.equal(h.value.quoteError, 'Нет соединения');
  await h.advance(29); await h.flush(); assert.equal(h.calls.length, 6);
  await h.advance(1); await h.flush(); await h.resolve(6, 170); await h.resolve(7);
  assert.equal(h.value.quote.price, 170); assert.equal(h.value.quoteError, '');
});

test('automatic refresh cannot overwrite a changed route or continue after a trip starts', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0); await h.resolve(1);
  await h.advance(270); await h.flush();
  await h.change({ dropoff: point('C', 42.95) }); await h.flush();
  await h.resolve(4, 210); await h.resolve(5); await h.resolve(2, 160); await h.resolve(3);
  assert.equal(h.value.quote.price, 210);
  await h.change({ enabled: false }); await h.advance(600); await h.flush();
  assert.equal(h.value.quote, null); assert.equal(h.calls.length, 6);
});
test('one failed tariff does not discard successful prices and retry recovers', async t => {
  const h = await setup(t); await h.flush(); await h.reject(0); await h.resolve(1, 190);
  assert.equal(h.value.calculating, false); assert.equal(h.value.quote, null); assert.equal(h.value.quoteError, 'Нет соединения');
  await h.change({ tariffId: 'comfort' }); assert.equal(h.value.quote.price, 190);
  await h.change({ tariffId: 'eco' }); await h.refresh(); await h.flush(); await h.resolve(2, 160); await h.resolve(3, 200);
  assert.equal(h.value.quote.price, 160);
});
test('account changes and an active trip fence unfinished quote requests', async t => {
  const h = await setup(t); await h.flush(); await h.change({ accountId: 'client-b' }); await h.flush();
  await h.resolve(0); await h.resolve(1); assert.equal(h.value.quote, null);
  await h.resolve(2, 220); await h.resolve(3); assert.equal(h.value.quote.price, 220);
  await h.change({ enabled: false }); assert.equal(h.value.quote, null); assert.equal(h.value.calculating, false);
});
test('only entrance and comment are sent; removed ride options stay removed', () => {
  const exports = {};
  vm.runInNewContext(compile('BookingPanel.tsx'), { exports, require: id => {
    if (['react', 'react/jsx-runtime'].includes(id)) return require(id);
    if (id === 'react-native') return { StyleSheet: { create: s => s } };
    if (id === './ui') return { colors: {} };
    return {};
  } });
  assert.equal(exports.rideComment(exports.emptyRideDetails), '');
  const result = exports.rideComment({ entrance: ' 2 ', comment: 'У ворот', pet: true });
  assert.equal(result, 'Подъезд: 2\nУ ворот');
});
