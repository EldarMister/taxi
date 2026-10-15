const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/accountIdentity.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsForTest });
const { needsClientName, needsDriverRegistration } = exportsForTest;

// Run App's real sync and profile-update functions with controlled response
// ordering. This catches the GET/PATCH race rather than just testing a counter.
function syncHarness(initialUser, options = {}) {
  const app = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
  const updater = app.slice(app.indexOf('  const updateUser = '), app.indexOf('  const refreshRegistrationAttention'));
  const sync = app.slice(app.indexOf('  async function sync()'), app.indexOf('  async function bootstrap()'));
  const appliedOrders = [], offerChanges = [], errors = [], requests = [];
  let resolveProfile;
  const pendingProfile = new Promise(resolve => { resolveProfile = resolve; });
  const userRef = { current: initialUser }, profileRevisionRef = { current: 0 };
  const orderRef = { current: options.order || null };
  const exports = {};
  const context = {
    exports, userRef, orderRef, profileRevisionRef, syncRef: { current: false }, syncAgain: { current: false },
    ...exportsForTest,
    withSelectedLanguage: value => value, driverSounds: { setUser() {} }, setUser() {}, setRegistrationAttention() {},
    refreshOffers() {}, rejectMismatchedRole: async () => false,
    api: { request: async endpoint => {
      requests.push(endpoint);
      if (endpoint === '/users/me') return pendingProfile;
      if (endpoint === '/orders/active') return options.active || null;
      if (options.order && endpoint === `/orders/${options.order.id}`) return { ...options.order, status: 'COMPLETED' };
      throw Error(`Unexpected request ${endpoint}`);
    } },
    isDismissedOrderUpdate: () => false, dismissedOrderIds: { current: new Set() },
    isActive: order => !!order && ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status),
    applyOrder: order => { orderRef.current = order; appliedOrders.push(order); },
    setOffers: offers => offerChanges.push(offers), setError: error => errors.push(error), messageOf: String,
    ApiError: class extends Error {}, writeLastOrderId: async () => {},
  };
  vm.runInNewContext(ts.transpileModule(`${updater}\n${sync}\nexports.sync = sync; exports.updateUser = updateUser;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { ...exports, userRef, profileRevisionRef, appliedOrders, offerChanges, errors, requests, resolveProfile };
}

test('new and restored unfinished clients must complete their name, existing names stay intact', () => {
  const client = { id: 'client-id', role: 'CLIENT', name: '', firstName: '', lastName: '' };
  assert.equal(needsClientName(client, 'client'), true);
  assert.equal(needsClientName(JSON.parse(JSON.stringify(client)), 'client'), true);
  assert.equal(needsClientName({ ...client, name: ' \n ' }, 'client'), true);
  assert.equal(needsClientName({ ...client, name: 'Элдар Райымов', firstName: 'Элдар', lastName: 'Райымов' }, 'client'), false);
  assert.equal(needsClientName({ ...client, name: 'Legacy Full Name' }, 'client'), false, 'migration must not guess the split of existing names');
  assert.equal(needsClientName({ ...client, role: 'DRIVER' }, 'driver'), false);
  assert.equal(needsClientName(client, 'driver'), false);
});

test('a new DRIVER identity completes performer registration without becoming CLIENT', () => {
  const driver = { id: 'driver-id', role: 'DRIVER', name: '', driverProfile: null };
  assert.equal(needsDriverRegistration(driver, 'driver', 'home'), true);
  assert.equal(needsDriverRegistration({ ...driver, driverProfile: {} }, 'driver', 'home'), false);
  assert.equal(needsDriverRegistration({ ...driver, driverProfile: {} }, 'driver', 'registration'), true);
  assert.equal(needsDriverRegistration({ ...driver, role: 'CLIENT' }, 'driver', 'registration'), false);
  assert.equal(needsDriverRegistration(driver, 'client', 'home'), false);
});

test('App applies persisted name gate before permission and trip screens and fences stale save responses', () => {
  const app = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
  const nameGate = app.indexOf('if (needsClientName(user, appVariant))');
  const permissionGate = app.indexOf('if (permissionStep === "loading")', nameGate);
  assert.ok(nameGate > app.indexOf('if (!user) return <AuthScreen'));
  assert.ok(permissionGate > nameGate);
  assert.match(app.slice(nameGate, permissionGate), /api\.patch<User>\('\/users\/me', \{ firstName, lastName \}\)/);
  assert.match(app.slice(nameGate, permissionGate), /userRef\.current\?\.id === accountId && profile\.id === accountId/);
  assert.match(app.slice(nameGate, permissionGate), /onBack=[\s\S]*logout\(\)/);
  const rejection = app.slice(app.indexOf('async function rejectMismatchedRole'), app.indexOf('async function refreshOffers'));
  assert.match(rejection, /if \(isRoleAllowed\(profile\.role\)\) return false/);
  assert.doesNotMatch(rejection, /profile\.role === 'CLIENT'/);
  assert.match(app, /onUser=\{profile => \{ if \(userRef\.current\?\.id === profile\.id\) updateUser\(profile\); \}\}/, 'a late profile save cannot restore a signed-out account');
});

test('a delayed profile GET cannot reopen name registration after saving, while order reconciliation continues', async () => {
  const oldProfile = { id: 'client-id', role: 'CLIENT', name: '', firstName: '', lastName: '' };
  const h = syncHarness(oldProfile, { order: { id: 'trip-id', status: 'ASSIGNED' } });
  const pending = h.sync();
  const savedProfile = { ...oldProfile, name: 'Элдар Райымов', firstName: 'Элдар', lastName: 'Райымов' };
  h.updateUser(savedProfile); // PATCH has completed before the older GET.
  h.resolveProfile(oldProfile);
  await pending;
  assert.equal(h.userRef.current, savedProfile);
  assert.equal(needsClientName(h.userRef.current, 'client'), false);
  assert.equal(h.appliedOrders.at(-1).status, 'COMPLETED');
  assert.ok(h.requests.includes('/orders/trip-id'));
  assert.deepEqual(h.errors, []);
});

test('a normal current profile response still updates structured names', async () => {
  const oldProfile = { id: 'client-id', role: 'CLIENT', name: '' };
  const h = syncHarness(oldProfile);
  const pending = h.sync();
  const response = { ...oldProfile, name: 'Элдар Райымов', firstName: 'Элдар', lastName: 'Райымов' };
  h.resolveProfile(response);
  await pending;
  assert.equal(h.userRef.current, response);
  assert.equal(h.profileRevisionRef.current, 1);
});

test('when an obsolete profile read is skipped, offers follow the live driver availability', async () => {
  const oldProfile = { id: 'driver-id', role: 'DRIVER', name: 'Водитель', driverProfile: { online: false } };
  const h = syncHarness(oldProfile);
  const pending = h.sync();
  const onlineProfile = { ...oldProfile, driverProfile: { online: true } };
  h.updateUser(onlineProfile);
  h.resolveProfile(oldProfile);
  await pending;
  assert.equal(h.userRef.current, onlineProfile);
  assert.equal(h.offerChanges.length, 0, 'old offline flag must not clear live offers');
});

test('a response for a different account cannot replace the live profile', async () => {
  const initial = { id: 'client-id', role: 'CLIENT', name: 'Текущее имя' };
  const h = syncHarness(initial);
  const pending = h.sync();
  h.resolveProfile({ ...initial, id: 'other-account', name: 'Чужое имя' });
  await pending;
  assert.equal(h.userRef.current, initial);
  assert.equal(h.profileRevisionRef.current, 0);
});

test('signing out while a profile read is pending cannot restore the account', async () => {
  const initial = { id: 'client-id', role: 'CLIENT', name: 'Элдар Райымов' };
  const h = syncHarness(initial);
  const pending = h.sync();
  h.updateUser(null);
  h.resolveProfile(initial);
  await pending;
  assert.equal(h.userRef.current, null);
  assert.equal(h.appliedOrders.length, 0);
});
