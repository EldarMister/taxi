const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const point = latitude => ({ latitude, longitude: 74.57, address: 'Ленина 39', category: 'building' });
async function setup(t) {
  let renderer, value, pickupEta, availability, id = 0, now = 100000;
  const timers = new Map(), intervals = new Map(), listeners = new Set(), calls = [];
  const args = { pickup: point(42.87), dropoff: null, tariffId: 'eco', enabled: true, accountId: 'one' };
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/useMapEstimate.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, AbortController, Date: class extends Date { static now() { return now; } },
    setTimeout: callback => { timers.set(++id, callback); return id; }, clearTimeout: key => timers.delete(key),
    setInterval: callback => { intervals.set(++id, callback); return id; }, clearInterval: key => intervals.delete(key),
    require: name => {
      if (name === 'react') return React;
      if (name === 'react-native') return { AppState: { currentState: 'active', addEventListener: (_, callback) => { listeners.add(callback); return { remove: () => listeners.delete(callback) }; } } };
      if (name === './types') return { normalizePoint: ({ latitude, longitude, address }) => ({ latitude, longitude, address }) };
      if (name === './api') return { api: { post: (url, body, { signal }) => new Promise((resolve, reject) => calls.push({ url, body, signal, resolve, reject })) } };
      throw Error(name);
    },
  });
  function Probe() { value = exports.useMapEstimate(args.pickup, args.dropoff, args.tariffId, args.enabled, args.accountId); pickupEta = exports.usePickupEta(value, args.pickup, args.tariffId, args.etaEnabled !== false, args.accountId); availability = exports.usePickupAvailability(value, args.pickup, args.tariffId, args.etaEnabled !== false, args.accountId); return null; }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(timers.size + intervals.size + listeners.size, 0); });
  return {
    calls, get value() { return value; }, get pickupEta() { return pickupEta; }, get availability() { return availability; },
    change: async patch => { Object.assign(args, patch); await act(async () => renderer.update(React.createElement(Probe))); },
    flush: async () => act(async () => { for (const [key, callback] of [...timers]) { timers.delete(key); callback(); } }),
    resolve: async (index, eta = 7, available = true) => act(async () => calls[index].resolve({ hasAvailableDrivers: available, pickupEtaMinutes: eta, trip: null })),
    resolveLegacy: async index => act(async () => calls[index].resolve({ pickupEtaMinutes: null, trip: null })),
    fail: async index => act(async () => calls[index].reject(Error('Offline'))),
    refresh: async () => act(async () => { intervals.forEach(callback => callback()); }),
    state: async state => act(async () => { listeners.forEach(callback => callback(state)); }),
    advance: async milliseconds => { now += milliseconds; await act(async () => renderer.update(React.createElement(Probe))); },
  };
}
test('map previews debounce movement and send only normalized coordinates/address to the estimate endpoint', async t => {
  const h = await setup(t);
  await h.change({ pickup: point(42.88) }); await h.change({ pickup: point(42.89) });
  assert.equal(h.calls.length, 0); await h.flush();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].url, '/orders/map-estimate');
  assert.equal(h.calls[0].body.pickup.latitude, 42.89);
  assert.equal(h.calls[0].body.pickup.category, undefined);
  assert.equal(h.calls[0].body.dropoff, undefined);
  await h.resolve(0); assert.equal(h.value.pickupEtaMinutes, 7);
});
test('a moved pin immediately hides its old estimate and late responses cannot restore it', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0);
  await h.refresh(); await h.change({ pickup: point(42.9), dropoff: point(42.92) });
  assert.equal(h.value, null); assert.equal(h.calls[1].signal.aborted, true);
  await h.resolve(1, 20); assert.equal(h.value, null);
  await h.flush(); assert.equal(h.calls[2].body.dropoff.latitude, 42.92);
  await h.resolve(2, 3); assert.equal(h.value.pickupEtaMinutes, 3);
});
test('pending geocoding, account changes and backgrounding fence and cancel map estimates', async t => {
  const h = await setup(t); await h.flush();
  await h.change({ enabled: false }); assert.equal(h.calls[0].signal.aborted, true);
  await h.resolve(0); assert.equal(h.value, null); await h.refresh(); assert.equal(h.calls.length, 1);
  await h.change({ enabled: true }); await h.flush();
  await h.change({ accountId: 'two' }); await h.resolve(1); assert.equal(h.value, null);
  await h.flush(); await h.state('background'); assert.equal(h.calls[2].signal.aborted, true);
  await h.refresh(); assert.equal(h.calls.length, 3);
  await h.state('active'); await h.flush(); await h.resolve(3, 5); assert.equal(h.value.pickupEtaMinutes, 5);
});
test('a tariff change recalculates and unavailable estimates never substitute a fixed ETA', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0);
  await h.change({ tariffId: 'comfort' }); assert.equal(h.value, null); await h.flush();
  assert.equal(h.calls[1].body.tariffId, 'comfort'); await h.resolve(1, null);
  assert.equal(h.value.pickupEtaMinutes, null);
  await h.refresh(); await h.fail(2); assert.equal(h.value, null);
});

test('editing destination keeps pickup time at its unchanged point, but a different pickup/account invalidates it', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0, 6);
  assert.equal(h.pickupEta, 6);
  await h.change({ dropoff: point(42.92), enabled: false });
  assert.equal(h.value, null); assert.equal(h.pickupEta, 6);
  await h.change({ pickup: point(42.88) }); assert.equal(h.pickupEta, undefined);
  await h.change({ pickup: point(42.87), accountId: 'two' }); assert.equal(h.pickupEta, undefined);
});

test('no-car pickup state survives destination edits and stale pickup times expire', async t => {
  const h = await setup(t); await h.flush(); await h.resolve(0, null, false);
  assert.equal(h.pickupEta, null);
  await h.change({ enabled: false, dropoff: point(42.92) }); assert.equal(h.pickupEta, null);
  await h.advance(30001); assert.equal(h.pickupEta, undefined);
  await h.change({ etaEnabled: false }); assert.equal(h.pickupEta, undefined);
});

test('unknown ETA or a legacy API cannot claim no cars, while explicit no-car availability is retained during destination edits', async t => {
  const h = await setup(t); await h.flush(); await h.resolveLegacy(0);
  assert.equal(h.availability, 'unknown');
  await h.refresh(); await h.resolve(1, null, true); assert.equal(h.availability, 'available');
  await h.refresh(); await h.resolve(2, null, false); assert.equal(h.availability, 'unavailable');
  await h.change({ enabled: false, dropoff: point(42.92) }); assert.equal(h.availability, 'unavailable');
  await h.advance(30001); assert.equal(h.availability, 'unknown');
  await h.change({ accountId: 'two' }); assert.equal(h.availability, 'unknown');
});
