const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, process: { env: {} }, require: id => { if (id in dependencies) return dependencies[id]; throw Error(id); } });
  return exports;
}
const logic = load('driverOfferNotification.ts');
const now = Date.now();
const data = { event: 'order:offer', orderId: 'offer-one', recipientId: 'driver-one', offerExpiresAt: new Date(now + 60000).toISOString() };
const intent = logic.parseDriverOfferAction(logic.DRIVER_OFFER_ACCEPT, data);
function setup() {
  let user = { id: 'driver-one', role: 'DRIVER' }, active = null, offers = [{ id: 'offer-one', status: 'SEARCHING', searchExpiresAt: data.offerExpiresAt }];
  const calls = [];
  const deps = { getUser: () => user, getOrder: () => active, loadOffers: async () => offers, now: () => now,
    accept: async offer => { calls.push(['accept', offer.id]); }, skip: async offer => { calls.push(['skip', offer.id]); } };
  return { deps, calls, setUser: value => user = value, setOrder: value => active = value, setOffers: value => offers = value };
}
test('buttons open the app, use separate action identifiers and support interface languages', () => {
  assert.deepEqual(Array.from(logic.driverOfferButtons(), button => button.buttonTitle), ['Взять', 'Пропустить']);
  assert.ok(logic.driverOfferButtons().every(button => button.options.opensAppToForeground));
  assert.deepEqual(Array.from(logic.driverOfferButtons('en'), button => button.buttonTitle), ['Accept', 'Skip']);
  assert.notEqual(logic.driverOfferButtons('ky')[0].buttonTitle, 'Взять');
  for (const invalid of [{ ...data, event: 'chat:message' }, { ...data, recipientId: undefined }, { ...data, orderId: '../other' }, { ...data, offerExpiresAt: 'invalid' }]) assert.equal(logic.parseDriverOfferAction(logic.DRIVER_OFFER_ACCEPT, invalid), null);
  assert.equal(logic.parseDriverOfferAction('default', data), null);
});
test('take and skip fetch the authoritative available offer before calling the selected action', async () => {
  for (const action of ['accept', 'skip']) {
    const h = setup();
    assert.equal(await logic.performDriverOfferAction({ ...intent, action }, h.deps), 'done');
    assert.deepEqual(h.calls, [[action, 'offer-one']]);
  }
});
test('expired, withdrawn and other-account notifications never mutate an order', async () => {
  const h = setup();
  assert.equal(await logic.performDriverOfferAction({ ...intent, expiresAt: now - 1 }, h.deps), 'expired');
  h.setOffers([]); assert.equal(await logic.performDriverOfferAction(intent, h.deps), 'expired');
  h.setUser({ id: 'other', role: 'DRIVER' }); assert.equal(await logic.performDriverOfferAction(intent, h.deps), 'ignored');
  h.setUser({ id: 'driver-one', role: 'CLIENT' }); assert.equal(await logic.performDriverOfferAction(intent, h.deps), 'ignored');
  assert.deepEqual(h.calls, []);
});
test('logout or a new assignment during an offers request fences delayed notification actions', async () => {
  const h = setup();
  h.deps.loadOffers = async () => { h.setUser(null); return [{ id: 'offer-one', status: 'SEARCHING' }]; };
  assert.equal(await logic.performDriverOfferAction(intent, h.deps), 'ignored');
  const other = setup();
  other.deps.loadOffers = async () => { other.setOrder({ id: 'different', status: 'ASSIGNED' }); return [{ id: 'offer-one', status: 'SEARCHING' }]; };
  await assert.rejects(logic.performDriverOfferAction(intent, other.deps), /активный заказ/);
  assert.deepEqual(h.calls, []); assert.deepEqual(other.calls, []);
});
test('an already accepted order is restored without another mutation or obsolete expiry error', async () => {
  const h = setup(); h.setOrder({ id: 'offer-one', status: 'ASSIGNED' });
  assert.equal(await logic.performDriverOfferAction({ ...intent, expiresAt: now - 1 }, h.deps), 'done');
  assert.deepEqual(h.calls, []);
});

test('the actual app queues cold taps until bootstrap finishes and consumes them once when ready', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8');
  const syntax = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(syntax) === 'useEffect' && node.arguments[0]?.getText(syntax).includes('performDriverOfferAction')) effect = node.arguments[0].getText(syntax);
    ts.forEachChild(node, visit);
  }
  visit(syntax); assert.ok(effect);
  const calls = [], pages = [], tasks = [];
  const context = { pendingDriverNotification: intent, booting: true, bootError: '', user: null, busy: false, busyRef: { current: false }, appVariant: 'driver',
    setPendingDriverNotification: value => context.pendingDriverNotification = value, setPage: value => pages.push(value),
    run: callback => tasks.push(callback()), performDriverOfferAction: async value => { calls.push(value); return 'done'; },
    userRef: { current: { id: 'driver-one', role: 'DRIVER' } }, orderRef: { current: null }, api: {}, acceptOffer() {}, skipOffer() {}, sync: async () => {},
  };
  vm.runInNewContext(ts.transpileModule(`globalThis.tick = ${effect}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  context.tick(); assert.equal(context.pendingDriverNotification, intent); assert.equal(calls.length, 0);
  context.booting = false; context.tick(); assert.equal(calls.length, 0, 'sign-in still has not restored a user');
  context.user = context.userRef.current; context.busyRef.current = true; context.tick(); assert.equal(calls.length, 0);
  context.busyRef.current = false; context.tick(); await Promise.all(tasks); context.tick();
  assert.equal(calls.length, 1); assert.equal(context.pendingDriverNotification, null); assert.deepEqual(pages, ['home']);
});

function nativeSetup(last) {
  let listener, removed = false; const categories = [];
  const native = { setNotificationHandler() {}, setNotificationCategoryAsync: async (...args) => categories.push(args),
    setNotificationChannelAsync: async () => {}, AndroidImportance: {}, AndroidAudioUsage: {}, AndroidAudioContentType: {},
    getLastNotificationResponseAsync: () => last, clearLastNotificationResponseAsync: async () => {},
    addNotificationResponseReceivedListener: callback => { listener = callback; return { remove: () => removed = true }; } };
  const exports = load('native/push.ts', {
    'expo-device': {}, 'expo-constants': {}, 'expo-notifications': native, 'expo-secure-store': {},
    'react-native': { Platform: { OS: 'android' } }, './driverSounds': {},
    '../driverOfferNotification': logic, '../auth/languageStore': { selectedLanguage: () => 'ru' },
  });
  return { ...exports, categories, emit: value => listener(value), isRemoved: () => removed };
}
const response = (id = 'notice-one') => ({ actionIdentifier: logic.DRIVER_OFFER_ACCEPT, notification: { request: { identifier: id, content: { data } } } });
test('native action categories register and duplicate cold-start / live callbacks dispatch once', async () => {
  const h = nativeSetup(Promise.resolve(response()));
  await h.configureNotificationChannels(); assert.equal(h.categories[0][0], logic.DRIVER_OFFER_CATEGORY);
  const calls = []; const stop = h.onNotificationOpened((...args) => calls.push(args));
  await new Promise(setImmediate); h.emit(response()); h.emit(response());
  assert.equal(calls.length, 1); assert.equal(calls[0][2], logic.DRIVER_OFFER_ACCEPT);
  stop(); assert.equal(h.isRemoved(), true);
});
test('a late initial response cannot overwrite a newer live tap, or outlive an unmounted subscription', async () => {
  let resolve; const h = nativeSetup(new Promise(done => resolve = done)); const calls = [];
  const stop = h.onNotificationOpened((...args) => calls.push(args));
  h.emit(response('newer')); resolve(response('older')); await new Promise(setImmediate);
  assert.equal(calls.length, 1);
  stop(); h.emit(response('after-unmount')); assert.equal(calls.length, 1);
});
