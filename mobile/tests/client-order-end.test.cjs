const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

// Execute App's real terminal action with state/storage boundaries isolated.
function appDone(order, busy = false) {
  const source = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
  const start = source.indexOf('const done = (expectedOrderId?');
  assert.ok(start > 0);
  const callback = source.slice(start, source.indexOf('const rate =', start));
  const output = {}, changes = {};
  let task;
  const context = {
    exports: output, orderRef: { current: order }, busyRef: { current: busy }, driver: false,
    dismissedOrderIds: { current: new Set() }, orderKey: { current: { quoteId: 'expired-quote', key: 'old-key' } },
    run: action => { task = action(); },
    writeLastOrderId: async value => { changes.lastOrderId = value; },
    applyOrder: value => { context.orderRef.current = value; changes.order = value; },
    clearQuotes: () => { changes.quotes = 'cleared'; }, clearDeliveryQuotes: () => { changes.deliveryQuotes = 'cleared'; },
    sync: async () => { changes.refreshed = true; },
    emptyRideDetails: {}, emptyDeliveryDetails: {},
  };
  for (const name of ['Page', 'Service', 'MapField', 'MapFocus', 'AddressField', 'Pickup', 'Dropoff', 'Recenter', 'Coming', 'RideDetails', 'DeliveryDetails']) {
    context[`set${name}`] = value => { changes[name] = typeof value === 'function' ? value(1) : value; };
  }
  context.markManualPickup = value => { changes.manualPickup = value; };
  const code = ts.transpileModule(`${callback}\nexports.done = done;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, context);
  return { context, changes, done: output.done, finish: () => task };
}

const pickup = { address: 'Улица Ленина, 10', latitude: 41.195, longitude: 72.179 };
const dropoff = { address: 'Школа № 8', latitude: 41.196, longitude: 72.181 };

test('retry restores the actual cancelled route and clears old quotes and booking keys', async () => {
  for (const status of ['CANCELLED', 'NO_DRIVER', 'COMPLETED']) for (const kind of ['RIDE', 'DELIVERY_CAR', 'DELIVERY_TRUCK']) {
    const order = { id: `${kind}-${status}`, status, kind, pickup, dropoff };
    const h = appDone(order);
    h.done(order.id);
    await h.finish();
    assert.equal(h.changes.order, null);
    assert.equal(h.changes.Pickup, pickup);
    assert.equal(h.changes.Dropoff, dropoff);
    assert.equal(h.changes.manualPickup, true, 'live GPS cannot replace the restored pickup');
    assert.equal(h.changes.Service, kind === 'RIDE' ? 'taxi' : 'delivery');
    assert.equal(h.changes.Page, 'home');
    assert.equal(h.changes.quotes, 'cleared');
    assert.equal(h.changes.deliveryQuotes, 'cleared');
    assert.equal(h.context.orderKey.current, null, 'new order must receive a fresh quote/idempotency key');
    assert.equal(h.context.dismissedOrderIds.current.has(order.id), true, 'late updates cannot restore the dismissed modal');
    assert.equal(h.changes.lastOrderId, null);
  }
});

test('close clears both addresses while a stale or busy terminal action does nothing', async () => {
  const order = { id: 'cancelled', status: 'CANCELLED', kind: 'RIDE', pickup, dropoff };
  const reset = appDone(order);
  reset.done(order.id, true);
  await reset.finish();
  assert.equal(reset.changes.Pickup, null);
  assert.equal(reset.changes.Dropoff, null);
  assert.equal(reset.changes.manualPickup, false);
  for (const [busy, expectedId] of [[true, order.id], [false, 'older-order']]) {
    const h = appDone(order, busy);
    h.done(expectedId, true);
    await h.finish();
    assert.deepEqual(h.changes, {});
    assert.equal(h.context.orderRef.current, order);
  }
});
