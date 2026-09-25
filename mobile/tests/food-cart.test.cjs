const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: id => {
      if (Object.hasOwn(dependencies, id)) return dependencies[id];
      throw new Error(`Unexpected dependency ${id}`);
    },
  });
  return exports;
}

const plain = value => JSON.parse(JSON.stringify(value));
const { addCartLine, cartLineKey, cartSummary, changeCartQuantity } = load('cart.ts');

function menu() {
  const philadelphia = { id: 'philadelphia', name: 'Филадельфия', price: 520, available: true, optionIds: ['soy', 'ginger', 'wasabi'] };
  const california = { id: 'california', name: 'Калифорния', price: 460, available: true, optionIds: ['soy', 'ginger'] };
  return {
    id: 'sushi-roll', deliveryFee: 100, minimumOrder: 0, dishes: [philadelphia, california],
    options: [
      { id: 'soy', name: 'Соевый соус', price: 0 },
      { id: 'ginger', name: 'Имбирь', price: 15 },
      { id: 'wasabi', name: 'Васаби', price: 10 },
    ],
  };
}

test('adding the same dish and selected options merges quantities regardless of option order', () => {
  const dish = menu().dishes[0];
  const originalOptions = ['ginger', 'soy', 'ginger'];
  const first = addCartLine([], dish, 2, originalOptions);
  const second = addCartLine(first, dish, 3, ['soy', 'ginger']);
  assert.deepEqual(plain(second), [{ dishId: dish.id, quantity: 5, optionIds: ['ginger', 'soy'] }]);
  assert.deepEqual(originalOptions, ['ginger', 'soy', 'ginger'], 'input selection must not be mutated');
  assert.equal(first[0].quantity, 2, 'previous cart state must remain immutable');
});

test('different option selections remain separate cart lines and changing one does not alter the other', () => {
  const dish = menu().dishes[0];
  const first = addCartLine([], dish, 1, ['soy']);
  const second = addCartLine(first, dish, 2, ['ginger']);
  assert.equal(second.length, 2);
  const changed = changeCartQuantity(second, cartLineKey(second[0]), 4);
  assert.deepEqual(plain(changed).map(line => line.quantity), [4, 2]);
  assert.deepEqual(plain(second).map(line => line.quantity), [1, 2]);
});

test('a cart never invents omitted options and discards options that this dish does not offer', () => {
  const restaurant = menu();
  const noExtras = addCartLine([], restaurant.dishes[0], 2, []);
  assert.deepEqual(plain(noExtras[0].optionIds), []);
  const summary = cartSummary(restaurant, noExtras);
  assert.deepEqual(plain(summary.items[0].options), []);
  assert.equal(summary.subtotal, 1040);
  const unsupported = addCartLine([], restaurant.dishes[1], 1, ['soy', 'wasabi', 'unknown']);
  assert.deepEqual(plain(unsupported[0].optionIds), ['soy']);
});

test('adding unavailable dishes or invalid quantities leaves the cart unchanged', () => {
  const dish = menu().dishes[0];
  const original = [{ dishId: dish.id, quantity: 2, optionIds: [] }];
  assert.equal(addCartLine(original, { ...dish, available: false }, 1, []), original);
  for (const quantity of [0, -1, 1.5, NaN, Infinity, '2']) {
    assert.equal(addCartLine(original, dish, quantity, []), original, `quantity ${quantity}`);
  }
});

test('new and merged quantities cap at 20; setting zero removes only the selected line', () => {
  const [firstDish, secondDish] = menu().dishes;
  let lines = addCartLine([], firstDish, 100, []);
  assert.equal(lines[0].quantity, 20);
  lines = addCartLine(lines, firstDish, 2, []);
  assert.equal(lines[0].quantity, 20);
  lines = addCartLine(lines, secondDish, 1, []);
  const firstKey = cartLineKey(lines[0]);
  assert.equal(changeCartQuantity(lines, firstKey, 25)[0].quantity, 20);
  assert.equal(changeCartQuantity(lines, firstKey, 1.5), lines);
  assert.deepEqual(plain(changeCartQuantity(lines, firstKey, 0)), [plain(lines[1])]);
  assert.deepEqual(plain(changeCartQuantity(lines, firstKey, -1)), [plain(lines[1])]);
  assert.deepEqual(plain(changeCartQuantity(lines, 'missing-dish:', 3)), plain(lines));
});

test('selected add-on prices apply to every unit and delivery is charged once or omitted for pickup', () => {
  const restaurant = menu();
  const lines = [
    { dishId: 'philadelphia', quantity: 2, optionIds: ['soy', 'ginger'] },
    { dishId: 'california', quantity: 1, optionIds: [] },
  ];
  const delivery = cartSummary(restaurant, lines);
  assert.equal(delivery.items[0].unitPrice, 535);
  assert.equal(delivery.items[0].total, 1070);
  assert.equal(delivery.count, 3);
  assert.equal(delivery.subtotal, 1530);
  assert.equal(delivery.deliveryFee, 100);
  assert.equal(delivery.total, 1630);
  assert.equal(delivery.invalid, false);
  const pickup = cartSummary(restaurant, lines, 'PICKUP');
  assert.equal(pickup.subtotal, 1530);
  assert.equal(pickup.deliveryFee, 0);
  assert.equal(pickup.total, 1530);
});

test('empty carts do not attract a delivery fee and free-delivery restaurants retain the item total', () => {
  const restaurant = menu();
  const empty = cartSummary(restaurant, []);
  assert.equal(empty.count, 0);
  assert.equal(empty.total, 0);
  assert.equal(empty.deliveryFee, 0);
  assert.equal(empty.invalid, false);
  const free = cartSummary({ ...restaurant, deliveryFee: 0 }, [{ dishId: 'philadelphia', quantity: 1, optionIds: [] }]);
  assert.equal(free.total, 520);
});

test('a configured free-delivery threshold changes the cart total at the same subtotal as the server', () => {
  const restaurant = { ...menu(), freeDeliveryThreshold: 1000 };
  const below = cartSummary(restaurant, [{ dishId: 'california', quantity: 2, optionIds: [] }]);
  assert.equal(below.subtotal, 920);
  assert.equal(below.deliveryFee, 100);
  const free = cartSummary(restaurant, [{ dishId: 'philadelphia', quantity: 2, optionIds: [] }]);
  assert.equal(free.subtotal, 1040);
  assert.equal(free.deliveryFee, 0);
  assert.equal(free.total, 1040);
});

test('stale dishes, unavailable dishes, malformed quantities and unsupported options mark a cart invalid', () => {
  const restaurant = menu();
  const valid = { dishId: 'philadelphia', quantity: 1, optionIds: [] };
  const removed = cartSummary(restaurant, [valid, { ...valid, dishId: 'removed-dish' }]);
  assert.equal(removed.invalid, true);
  assert.equal(removed.items.length, 1);
  assert.equal(cartSummary(undefined, [valid]).invalid, true);
  assert.equal(cartSummary({ ...restaurant, dishes: restaurant.dishes.map(dish => ({ ...dish, available: false })) }, [valid]).invalid, true);
  for (const quantity of [0, -1, 21, 1.5, NaN]) {
    assert.equal(cartSummary(restaurant, [{ ...valid, quantity }]).invalid, true);
  }
  assert.equal(cartSummary(restaurant, [{ ...valid, optionIds: ['unsupported'] }]).invalid, true);
});

test('a selected option removed from the current catalog cannot silently become a valid cheaper cart', () => {
  const restaurant = menu();
  restaurant.options = restaurant.options.filter(option => option.id !== 'ginger');
  assert.equal(cartSummary(restaurant, [{ dishId: 'philadelphia', quantity: 1, optionIds: ['ginger'] }]).invalid, true);
});

function storageHarness() {
  const values = new Map();
  const calls = [];
  const storage = load('storage.ts', {
    'expo-secure-store': {
      getItemAsync: async key => { calls.push(['get', key]); return values.get(key) ?? null; },
      setItemAsync: async (key, value) => { calls.push(['set', key]); values.set(key, value); },
    },
  });
  return { ...storage, values, calls, setRaw: raw => values.set('taxi.food.v1.client-a', raw) };
}

test('stored food carts tolerate absent, malformed or invalid top-level data', async () => {
  const storage = storageHarness();
  assert.equal(await storage.readFoodState('client-a'), null);
  for (const raw of ['{', 'null', 'false', '[]', '{}', '{"lines":[],"favorites":[]}']) {
    storage.setRaw(raw);
    assert.equal(await storage.readFoodState('client-a'), null, raw);
  }
});

test('restoring food state retains valid selections while rejecting corrupt lines and invalid optional fields', async () => {
  const storage = storageHarness();
  const validLine = { dishId: 'philadelphia', quantity: 2, optionIds: [] };
  storage.setRaw(JSON.stringify({
    restaurantId: 'sushi-roll',
    lines: [
      validLine,
      { ...validLine, quantity: 21 },
      { ...validLine, quantity: 1.5 },
      { ...validLine, quantity: 0 },
      { ...validLine, quantity: '2' },
      { ...validLine, dishId: 42 },
      { ...validLine, optionIds: ['soy', 7] },
      { ...validLine, optionIds: null },
    ],
    favorites: ['sushi-roll', null, 7], favoriteDishes: ['philadelphia', false],
    address: 7, checkout: { fulfillment: 'unknown', paymentMethod: 'CASH', comment: '' }, pending: { signature: 'saved-signature', requestId: null },
  }));
  assert.deepEqual(plain(await storage.readFoodState('client-a')), {
    restaurantId: 'sushi-roll', lines: [validLine], favorites: ['sushi-roll'],
    favoriteDishes: ['philadelphia'], address: '',
  });
});

test('food state and retry request IDs survive a save/read cycle without leaking to another account', async () => {
  const storage = storageHarness();
  const state = {
    restaurantId: 'sushi-roll', lines: [{ dishId: 'philadelphia', quantity: 2, optionIds: ['soy'] }],
    favorites: ['sushi-roll'], favoriteDishes: ['philadelphia'], address: 'ул. Ленина 12',
    checkout: { fulfillment: 'PICKUP', comment: 'Буду через полчаса', paymentMethod: 'CASH' },
    pending: { signature: 'cart-signature', requestId: 'request-123' },
  };
  const save = storage.writeFoodState('client-a', state);
  const restored = storage.readFoodState('client-a');
  await save;
  assert.deepEqual(plain(await restored), { ...state, checkout: { ...state.checkout, fulfillment: 'DELIVERY' } });
  assert.equal(await storage.readFoodState('client-b'), null);
  assert.equal(storage.calls[0][0], 'set', 'read must wait for the pending write');
});
