const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

const source = fs.readFileSync(require.resolve('../App.tsx'), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
(function visit(node) { nodes.push(node); ts.forEachChild(node, visit); })(ast);
const variable = name => nodes.find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === name).initializer;
const effect = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect'
  && node.arguments[0].getText(ast).includes('presentedOffers.current')).arguments[0];
const socketOffer = nodes.find(node => ts.isCallExpression(node) && node.expression.getText(ast) === 'socket.on'
  && node.arguments[0].getText(ast) === '"order:offer"').arguments[1];
const refresh = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'refreshOffers');
const dismissed = nodes.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isDismissedOrderUpdate');

function setup(status = null) {
  const saved = [], pages = [];
  const user = { id: 'driver-one', role: 'DRIVER', driverProfile: { online: true } };
  const current = status ? { id: 'old-trip', status, driver: user } : null;
  const context = {
    user, driver: true, userRef: { current: user }, order: current, orderRef: { current }, offers: [], clock: Date.now(), Date,
    presentedOffers: { current: { ids: new Set() } }, dismissedOrderIds: { current: new Set() },
    offersRevision: { current: 0 }, offersSyncing: { current: false }, offersAgain: { current: false },
    isActive: order => !!order && ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status),
    useCallback: callback => callback, driverSounds: { order() {} }, setComing() {},
    setOrder: order => { context.order = order; },
    setOffers: value => { context.offers = typeof value === 'function' ? value(context.offers) : value; },
    writeLastOrderId: async value => { saved.push(value); },
    setPage: value => { context.page = value; pages.push(value); }, page: 'history', drawer: true, chat: true,
    incoming: { text: 'old message' }, historyDetailId: 'old-trip', registrationDeepLink: {}, error: 'old error',
    api: { request: async () => context.response },
  };
  for (const key of ['Drawer', 'Chat', 'Incoming', 'HistoryDetailId', 'RegistrationDeepLink', 'Error']) {
    const state = key[0].toLowerCase() + key.slice(1);
    context[`set${key}`] = value => { context[state] = value; };
  }
  vm.createContext(context);
  const code = `${dismissed.getText(ast)}\nconst applyOrder = ${variable('applyOrder').getText(ast)};
    ${refresh.getText(ast)}
    globalThis.socketOffer = ${socketOffer.getText(ast)};
    globalThis.present = ${effect.getText(ast)};
    globalThis.select = () => { const offer = ${variable('offer').getText(ast)}; globalThis.offer = offer; return offer; };
    globalThis.applyOrder = applyOrder; globalThis.refreshOffers = refreshOffers;`;
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const receive = id => ({ id, status: 'SEARCHING', searchExpiresAt: new Date(Date.now() + 30_000).toISOString() });
  const present = () => { context.select(); context.present(); };
  return { context, saved, pages, receive, present };
}

test('socket and polled offers replace completed/cancelled panels, close overlays and open home', async () => {
  for (const transport of ['socket', 'poll']) for (const status of [null, 'COMPLETED', 'CANCELLED', 'NO_DRIVER']) {
    const h = setup(status), c = h.context;
    const offer = h.receive('next-trip');
    if (transport === 'socket') c.socketOffer(offer);
    else { c.response = [offer]; await c.refreshOffers(); }
    h.present();
    assert.equal(c.offer.id, 'next-trip');
    assert.equal(c.orderRef.current, null);
    assert.equal(c.page, 'home');
    assert.equal(c.drawer, false); assert.equal(c.chat, false);
    assert.equal(c.incoming, null); assert.equal(c.historyDetailId, null);
    assert.equal(c.registrationDeepLink, null); assert.equal(c.error, '');
    if (status) {
      assert.ok(c.dismissedOrderIds.current.has('old-trip'));
      assert.equal(h.saved.at(-1), null);
      c.applyOrder({ id: 'old-trip', status: 'COMPLETED', driver: c.user, driverRating: 5 });
      assert.equal(c.orderRef.current, null, 'late trip/rating response cannot reopen the old completion panel');
    }
  }
});

test('duplicate polls do not reset the screen; a new offer does', async () => {
  const h = setup(), c = h.context;
  c.response = [h.receive('one')]; await c.refreshOffers(); h.present();
  c.page = 'profile'; c.drawer = true;
  c.response = [{ ...c.response[0] }]; await c.refreshOffers(); h.present();
  assert.equal(c.page, 'profile'); assert.equal(c.drawer, true);
  c.response = [h.receive('two')]; await c.refreshOffers(); h.present();
  assert.equal(c.page, 'home'); assert.equal(c.drawer, false);
  assert.deepEqual(h.pages, ['home', 'home']);
});

test('active trips, expired offers, offline drivers and clients are not interrupted', () => {
  for (const status of ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS']) {
    const h = setup(status); h.context.offers = [h.receive('new')]; h.present();
    assert.equal(h.context.offer, undefined); assert.equal(h.context.orderRef.current.status, status);
    assert.equal(h.pages.length, 0);
  }
  for (const mode of ['expired', 'invalid', 'offline', 'client', 'expired-since-render', 'assignment-since-render']) {
    const h = setup('COMPLETED'), c = h.context;
    c.offers = [h.receive('new')];
    if (mode === 'expired') c.offers[0].searchExpiresAt = new Date(Date.now() - 1).toISOString();
    if (mode === 'invalid') c.offers[0].searchExpiresAt = 'invalid';
    if (mode === 'offline') c.user.driverProfile.online = false;
    if (mode === 'client') { c.driver = false; c.user.role = 'CLIENT'; }
    c.select();
    if (mode === 'expired-since-render') c.offer.searchExpiresAt = new Date(Date.now() - 1).toISOString();
    if (mode === 'assignment-since-render') c.orderRef.current = { id: 'assigned', status: 'ASSIGNED' };
    c.present();
    assert.equal(c.page, 'history'); assert.equal(c.drawer, true);
    assert.equal(h.pages.length, 0);
    assert.equal(c.dismissedOrderIds.current.size, 0);
  }
});

test('presentation is scoped to the current signed-in driver', () => {
  const h = setup(), c = h.context;
  c.socketOffer(h.receive('one')); h.present();
  c.page = 'profile'; c.user = { ...c.user, id: 'driver-two' }; c.userRef.current = c.user;
  h.present();
  assert.equal(c.presentedOffers.current.userId, 'driver-two');
  assert.equal(c.page, 'home');
});

test('accepting from a notification before the offers list loads also retires the previous completion', () => {
  const h = setup('COMPLETED'), c = h.context;
  c.applyOrder({ id: 'accepted-trip', status: 'ASSIGNED', driver: c.user });
  assert.ok(c.dismissedOrderIds.current.has('old-trip'));
  c.applyOrder({ id: 'old-trip', status: 'COMPLETED', driver: c.user, driverRating: 5 });
  assert.equal(c.orderRef.current.id, 'accepted-trip');
  assert.equal(c.orderRef.current.status, 'ASSIGNED');
  assert.equal(c.page, 'home'); assert.equal(c.drawer, false); assert.equal(c.chat, false);
});
