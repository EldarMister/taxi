const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, imports = {}) {
  const filename = path.resolve(__dirname, relative);
  const source = fs.readFileSync(filename, 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(js, { exports, require: name => name in imports ? imports[name] : require(name), console, setTimeout, clearTimeout }, { filename });
  return exports;
}
const model = load('../src/features/orders/model.ts');
const { OrderCommandCoordinator } = load('../src/features/orders/commands.ts', { './model': model });
const record = (id = 'order-a', restaurantId = 'restaurant-a', extra = {}) => ({
  id, restaurantId, status: 'PLACED', fulfillment: 'DELIVERY', paymentMethod: 'CASH',
  items: [{ dishId: 'dish-a', name: 'Манты', quantity: 2, options: [], lineTotal: 500 }],
  createdAt: '2026-10-11T10:00:00Z', updatedAt: '2026-10-11T10:00:00Z',
  client: { name: 'Анна', phone: '+996700111222' }, total: 600, address: 'Киевская, 10', ...extra,
});
const plain = value => JSON.parse(JSON.stringify(value));
const networkError = () => new Error('Connection lost');

test('all 10 baskets stay independent when a restaurant accepts its portion', async () => {
  const group = Array.from({ length: 10 }, (_, index) => record(`order-${index}`, `restaurant-${index}`));
  const writes = [];
  const coordinator = new OrderCommandCoordinator('restaurant-3', {
    load: async () => group,
    send: async (id, command) => { writes.push(id); group.find(order => order.id === id).status = model.actionStatus[command.action]; },
  });
  const result = await coordinator.execute('order-3', { kind: 'action', action: 'ACCEPT' });
  assert.deepEqual(plain(result.map(order => order.id)), ['order-3']);
  assert.equal(group[3].status, 'CONFIRMED');
  assert.ok(group.filter((_, index) => index !== 3).every(order => order.status === 'PLACED'));
  await assert.rejects(coordinator.execute('order-8', { kind: 'action', action: 'ACCEPT' }), /недоступен/);
  assert.deepEqual(writes, ['order-3']);
});

test('visible status actions agree with backend transitions for delivery and pickup', () => {
  class DomainError extends Error {}
  const { assertFoodTransition } = load('../../../server/src/food-domain.ts', {
    '@nestjs/common': { BadRequestException: DomainError, ForbiddenException: DomainError },
    './food-catalog': {}, './food-promotions': {},
  });
  for (const fulfillment of ['DELIVERY', 'PICKUP']) {
    for (const status of Object.keys(model.statusLabels)) {
      const order = record('a', 'restaurant-a', { status, fulfillment });
      const expected = Object.entries(model.actionStatus).filter(([, next]) => {
        if (status === next) return false;
        try { assertFoodTransition('ADMIN', status, next, fulfillment); return true; } catch { return false; }
      }).map(([action]) => action).sort();
      assert.deepEqual(plain(model.allowedActions(order).sort()), expected, `${fulfillment}/${status}`);
    }
  }
});

test('active Atlas delivery owns completion and cancellation; pickup never dispatches', () => {
  for (const atlasStatus of ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS']) {
    const order = record('a', 'restaurant-a', { status: 'READY', atlasStatus, deliveryMethod: 'ATLAS_CAR' });
    assert.equal(model.canDispatch(order), false);
    assert.equal(model.allowedActions(order).includes('CANCEL'), false);
    assert.equal(model.allowedActions({ ...order, status: 'DELIVERING' }).includes('COMPLETE'), false);
  }
  assert.equal(model.canDispatch(record('a', 'restaurant-a', { status: 'READY', fulfillment: 'PICKUP' })), false);
  assert.equal(model.allowedActions(record('a', 'restaurant-a', { status: 'READY', fulfillment: 'PICKUP' })).includes('COMPLETE'), true);
  assert.equal(model.canDispatch(record('a', 'restaurant-a', { status: 'READY', atlasDelivery: { id: 'ride', status: 'NO_DRIVER', price: 100 } })), true);
});

test('a rapid duplicate status tap sends one mutation and both callers receive its result', async () => {
  let order = record();
  let sends = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const coordinator = new OrderCommandCoordinator('restaurant-a', {
    load: async () => [order], send: async () => { sends++; await held; order = { ...order, status: 'CONFIRMED' }; },
  });
  const first = coordinator.execute(order.id, { kind: 'action', action: 'ACCEPT' });
  const second = coordinator.execute(order.id, { kind: 'action', action: 'ACCEPT' });
  assert.equal(first, second);
  release();
  await Promise.all([first, second]);
  assert.equal(sends, 1);
});

test('one order command does not lock another restaurant order', async () => {
  const orders = [record('one'), record('two')];
  const sends = [];
  const coordinator = new OrderCommandCoordinator('restaurant-a', {
    load: async () => orders,
    send: async id => { sends.push(id); orders.find(order => order.id === id).status = 'CONFIRMED'; },
  });
  await Promise.all(orders.map(order => coordinator.execute(order.id, { kind: 'action', action: 'ACCEPT' })));
  assert.deepEqual(sends.sort(), ['one', 'two']);
});

test('Atlas double tap produces one creation with the confirmed expectedPrice', async () => {
  let order = record('a', 'restaurant-a', { status: 'READY' });
  let sends = 0;
  const coordinator = new OrderCommandCoordinator('restaurant-a', {
    load: async () => [order],
    send: async (_, command) => {
      sends++; assert.equal(command.input.expectedPrice, 240);
      order = { ...order, deliveryMethod: 'ATLAS_CAR', atlasStatus: 'SEARCHING', atlasDelivery: { id: 'ride-1', status: 'SEARCHING', price: 240 } };
    },
  });
  const command = { kind: 'dispatch', input: { method: 'ATLAS_CAR', expectedPrice: 240 } };
  await Promise.all([coordinator.execute('a', command), coordinator.execute('a', command)]);
  await coordinator.execute('a', command);
  assert.equal(sends, 1);
});

test('lost Atlas success response reconciles to the created ride without another POST', async () => {
  let order = record('a', 'restaurant-a', { status: 'READY' });
  let sends = 0;
  const coordinator = new OrderCommandCoordinator('restaurant-a', {
    load: async () => [order], send: async () => {
      sends++; order = { ...order, deliveryMethod: 'ATLAS_CAR', atlasStatus: 'SEARCHING', atlasDelivery: { id: 'ride-1', status: 'SEARCHING', price: 240 } };
      throw networkError();
    },
  });
  await coordinator.execute('a', { kind: 'dispatch', input: { method: 'ATLAS_CAR', expectedPrice: 240 } });
  assert.equal(sends, 1); assert.equal(coordinator.isUncertain('a'), false);
});

test('uncertain dispatch stays blocked offline and reconciles before allowing another attempt', async () => {
  let online = true;
  let order = record('a', 'restaurant-a', { status: 'READY' });
  let sends = 0;
  const coordinator = new OrderCommandCoordinator('restaurant-a', {
    load: async () => { if (!online) throw networkError(); return [order]; },
    send: async () => {
      sends++;
      if (sends === 1) { online = false; throw networkError(); }
      order = { ...order, status: 'DELIVERING', deliveryMethod: 'OWN' };
    },
  });
  const command = { kind: 'dispatch', input: { method: 'OWN', courierName: 'Илья' } };
  await assert.rejects(coordinator.execute('a', command), /проверить результат/);
  assert.equal(coordinator.isUncertain('a'), true);
  await assert.rejects(coordinator.execute('a', command), /проверить результат/);
  assert.equal(sends, 1);
  online = true;
  await coordinator.execute('a', command);
  assert.equal(sends, 2); assert.equal(order.status, 'DELIVERING');
});

test('a stale READY screen cannot create delivery after the server cancelled its order', async () => {
  let sends = 0;
  const coordinator = new OrderCommandCoordinator('restaurant-a', {
    load: async () => [record('a', 'restaurant-a', { status: 'CANCELLED' })], send: async () => { sends++; },
  });
  await assert.rejects(coordinator.execute('a', { kind: 'dispatch', input: { method: 'ATLAS_CAR', expectedPrice: 240 } }), /больше не готов/);
  assert.equal(sends, 0);
});

test('Atlas dispatch requires a real confirmed price', async () => {
  let sends = 0;
  const coordinator = new OrderCommandCoordinator('restaurant-a', { load: async () => [record('a', 'restaurant-a', { status: 'READY' })], send: async () => { sends++; } });
  for (const expectedPrice of [undefined, NaN, -1, 0, 1.5]) {
    await assert.rejects(coordinator.execute('a', { kind: 'dispatch', input: { method: 'ATLAS_CAR', expectedPrice } }), /рассчитайте/);
  }
  assert.equal(sends, 0);
});

test('new-order tracking preserves known IDs across reconnection and scopes the event stream', () => {
  const tracker = new model.OrderTracker('restaurant-a');
  const first = tracker.receive([record('old'), record('foreign', 'restaurant-b')]);
  assert.equal(first.initial, true); assert.deepEqual(plain(first.unseen), ['old']);
  assert.deepEqual(plain(tracker.receive([record('old')]).unseen), []);
  const recovered = tracker.receive([record('new'), record('during-outage', 'restaurant-a', { status: 'PREPARING' }), record('foreign-2', 'restaurant-b')]);
  assert.deepEqual(plain(recovered.unseen), ['new', 'during-outage']);
  assert.equal(recovered.initial, false);
  assert.deepEqual(plain(tracker.receive([record('old'), record('new')]).unseen), []);
});

test('coordinates are validated without interpreting missing fields as zero', () => {
  for (const [lat, lng] of [['', '74'], ['42', ''], ['-91', '74'], ['42', '181'], ['NaN', '74']]) assert.throws(() => model.fallbackCoordinates(lat, lng));
  assert.deepEqual(plain(model.fallbackCoordinates('42,87', '74.57')), { deliveryLat: 42.87, deliveryLng: 74.57 });
  assert.equal(model.destination(record('a', 'restaurant-a', { deliveryPoint: { latitude: 500, longitude: 74 } })), null);
});

test('order search and history filters preserve real status and item snapshots', () => {
  const orders = [record('a'), record('b', 'restaurant-a', { status: 'COMPLETED' }), record('c', 'restaurant-a', { status: 'CANCELLED' })];
  assert.deepEqual(plain(model.filterOrders(orders, 'active', 'манты').map(order => order.id)), ['a']);
  assert.deepEqual(plain(model.filterOrders(orders, 'history', 'Анна').map(order => order.id)), ['b', 'c']);
  assert.equal(model.filterOrders(orders, 'active', 'Неизвестный клиент').length, 0);
});
