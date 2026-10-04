const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../App.tsx'), 'utf8');
const syntax = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const functions = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['sync', 'refreshOffers'].includes(node.name?.text)) functions.push(node.getText(syntax));
  ts.forEachChild(node, visit);
}
visit(syntax);
assert.equal(functions.length, 2);
const code = ts.transpileModule(functions.join('\n') + '\nglobalThis.actions = { sync, refreshOffers };', {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const driver = { id: 'driver', role: 'DRIVER', driverProfile: { online: true } };
function setup(request) {
  const offers = [], orders = [], errors = [];
  const context = {
    userRef: { current: driver }, orderRef: { current: null },
    syncRef: { current: false }, syncAgain: { current: false }, offersSyncing: { current: false },
    offersAgain: { current: false }, offersRevision: { current: 0 }, dismissedOrderIds: { current: new Set() },
    api: { request }, isActive: order => !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status),
    isDismissedOrderUpdate: (order, dismissed) => order && dismissed.has(order.id),
    setOffers: value => offers.push(value), applyOrder: value => { orders.push(value); context.orderRef.current = value; },
    updateUser: value => { context.userRef.current = value; }, rejectMismatchedRole: async () => false,
    writeLastOrderId: async () => {}, ApiError: class extends Error {}, messageOf: error => String(error), setError: error => errors.push(error),
  };
  vm.runInNewContext(code, context);
  return { ...context.actions, context, offers, orders, errors };
}

test('new offers appear before a slow profile request finishes', async () => {
  const profile = deferred();
  const h = setup(path => path === '/users/me' ? profile.promise : Promise.resolve(path === '/driver/offers'
    ? [{ id: 'offer', status: 'SEARCHING' }] : null));
  const pending = h.sync(); await turn();
  assert.equal(h.offers[0][0].id, 'offer');
  assert.equal(h.context.syncRef.current, true);
  profile.resolve(driver); await pending;
});

test('trip updates appear before a slow profile request finishes', async () => {
  const profile = deferred();
  const h = setup(path => path === '/users/me' ? profile.promise : Promise.resolve(path === '/driver/offers'
    ? [] : { id: 'trip', status: 'ASSIGNED' }));
  const pending = h.sync(); await turn();
  assert.equal(h.orders[0].id, 'trip');
  assert.equal(h.context.syncRef.current, true);
  profile.resolve(driver); await pending;
});

test('a push arriving during synchronization causes one follow-up instead of being lost', async () => {
  const profile = deferred(); let profiles = 0;
  const h = setup(path => path === '/users/me' ? (++profiles === 1 ? profile.promise : Promise.resolve(driver))
    : Promise.resolve(path === '/driver/offers' ? [] : null));
  const pending = h.sync(); await turn();
  await h.sync(); await h.sync();
  profile.resolve(driver); await pending; await turn();
  assert.equal(profiles, 2);
  assert.equal(h.context.syncRef.current, false);
});

test('an old offers response cannot overwrite a socket withdrawal, and refresh is coalesced', async () => {
  const old = deferred(); let requests = 0;
  const h = setup(() => ++requests === 1 ? old.promise : Promise.resolve([{ id: 'current' }]));
  const pending = h.refreshOffers();
  h.context.offersRevision.current++;
  await h.refreshOffers(); await h.refreshOffers();
  old.resolve([{ id: 'withdrawn' }]); await pending; await turn();
  assert.equal(requests, 2);
  assert.deepEqual(h.offers, [[{ id: 'current' }]]);
});

test('late notifications cannot restore offers or orders into a different account', async () => {
  const result = deferred();
  const h = setup(path => path === '/users/me' ? Promise.resolve(driver) : result.promise);
  const pending = h.sync();
  h.context.userRef.current = { ...driver, id: 'other' };
  result.resolve([{ id: 'old-account' }]); await pending; await turn();
  assert.equal(h.offers.length, 0);
  assert.equal(h.orders.length, 0);
});
