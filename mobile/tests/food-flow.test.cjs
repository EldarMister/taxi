const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const mainDish = { id: 'philadelphia', name: 'Филадельфия', category: 'Роллы', description: '', portion: '8 шт.', weightGrams: 250, price: 520, imageKey: 'philadelphia', available: true, optionIds: ['soy', 'ginger'] };
const otherDish = { ...mainDish, id: 'burger', name: 'Бургер', price: 300, optionIds: [] };
const restaurant = {
  id: 'sushi-roll', name: 'Sushi Roll', rating: 4.7, reviewCount: 320, cuisine: 'Суши · Роллы', categories: ['Суши'],
  etaMin: 30, etaMax: 45, deliveryFee: 0, minimumOrder: 0, address: 'ул. Ленина 12', phone: null,
  imageKey: 'sushi-roll', heroImageKey: 'sushi-hero', menuCategories: ['Роллы'], dishes: [mainDish],
  options: [{ id: 'soy', name: 'Соевый соус', price: 0, imageKey: 'soy' }, { id: 'ginger', name: 'Имбирь', price: 10, imageKey: 'ginger' }], isDemo: true,
};
const otherRestaurant = { ...restaurant, id: 'kfc', name: 'KFC', dishes: [otherDish] };
const catalog = { restaurants: [restaurant, otherRestaurant], paymentMethods: [{ id: 'CASH', name: 'Наличные', available: true }], isDemo: true };
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
const screenNames = ['ServiceHomeScreen', 'RestaurantsScreen', 'FavoritesScreen', 'RestaurantScreen', 'DishScreen', 'CartScreen', 'CheckoutScreen', 'FoodOrderScreen', 'FoodHistoryScreen'];

function order(id = 'server-order-1', fields = {}) {
  return {
    id, status: 'PLACED', createdAt: '2026-09-08T08:00:00Z', updatedAt: '2026-09-08T08:00:00Z', completedAt: null,
    restaurant, items: [{ ...mainDish, dishId: mainDish.id, quantity: 1, unitPrice: 520, options: [], lineTotal: 520 }],
    subtotal: 520, deliveryFee: 0, total: 520, currency: 'KGS', fulfillment: 'DELIVERY', address: 'ул. Ленина 12', comment: '', paymentMethod: 'CASH', isDemo: true,
    ...fields,
  };
}

async function setup(t, options = {}) {
  const requests = [], posts = [], alerts = [], writes = [], intervals = new Map(), timeouts = new Map(), backListeners = new Set(), appListeners = new Set();
  let keyboardDismisses = 0;
  const values = new Map(Object.entries(options.saved ?? {}).map(([key, state]) => [key, clone(state)]));
  let activeOrder = options.activeOrder ?? null, history = options.history ?? [], nextId = 0, renderer, unmounted = false, nextWriteGate;
  const native = {
    View: 'View',
    Alert: { alert: (...args) => alerts.push(args) },
    AppState: { currentState: 'active', addEventListener: (_event, listener) => { appListeners.add(listener); return { remove: () => appListeners.delete(listener) }; } },
    BackHandler: { addEventListener: (_event, listener) => { backListeners.add(listener); return { remove: () => backListeners.delete(listener) }; } },
    Keyboard: { dismiss: () => { keyboardDismisses++; } },
  };
  const api = {
    request: url => {
      requests.push(url);
      const custom = options.request?.(url);
      if (custom !== undefined) return Promise.resolve(custom);
      if (url === '/content/banners') return Promise.resolve({ banners: clone(options.banners ?? []) });
      if (url === '/food/catalog') return Promise.resolve(clone(catalog));
      if (url === '/food/orders/active') return Promise.resolve(clone(activeOrder));
      if (url === '/food/orders/history') return Promise.resolve(clone(history));
      const found = history.find(item => url === `/food/orders/${item.id}`) ?? (activeOrder && url === `/food/orders/${activeOrder.id}` ? activeOrder : null);
      if (found) return Promise.resolve(clone(found));
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    },
    post: (url, body) => { const pending = deferred(); posts.push({ url, body: clone(body), ...pending }); return pending.promise; },
  };
  const screens = Object.fromEntries(screenNames.map(name => [name, props => React.createElement(name, props)]));
  const modules = {};
  function load(file) {
    if (modules[file]) return modules[file];
    const exports = {};
    modules[file] = exports;
    vm.runInNewContext(compile(file), {
      exports,
      setInterval: callback => { const id = ++nextId; intervals.set(id, callback); return id; },
      clearInterval: id => intervals.delete(id),
      setTimeout: callback => { const id = ++nextId; timeouts.set(id, callback); return id; },
      clearTimeout: id => timeouts.delete(id),
      require: id => {
        if (id === 'react' || id === 'react/jsx-runtime') return require(id);
        if (id === 'react-native') return native;
        if (id === 'expo-status-bar') return { StatusBar: 'StatusBar' };
        if (id === '../design/theme') return { useTheme: () => ({ isDark: !!options.dark, palette: { background: options.dark ? '#050505' : '#F4F8FD' } }) };
        if (id === '../api') return { api, ApiError, messageOf: error => error.message, requestId: () => `request-${++nextId}` };
        if (id === '../ui') return { tr: () => text => text };
        if (id === './cart') return load('cart.ts');
        if (id === './storage') return {
          readFoodState: async userId => clone(values.get(userId) ?? null),
          writeFoodState: async (userId, state) => {
            const snapshot = clone(state);
            writes.push({ userId, state: snapshot });
            const gate = nextWriteGate;
            nextWriteGate = undefined;
            if (gate) await gate.promise;
            values.set(userId, snapshot);
          },
        };
        if (id === './ScreenTransition') return { ScreenTransition: props => React.createElement('ScreenTransition', props, props.children) };
        if (id === './i18n') return { FoodLanguageProvider: props => props.children };
        if (['./HomeScreen', './CatalogScreens', './FavoritesScreen', './CheckoutScreens', './OrderScreens'].includes(id)) return screens;
        throw new Error(`Unexpected dependency ${id}`);
      },
    });
    return exports;
  }
  const { FoodExperience } = load('FoodExperience.tsx');
  const props = { userId: 'client-a', active: true, entry: { screen: 'home', key: 1 }, defaultAddress: 'ул. Ленина 12', onTaxi: () => {}, onMenu: () => {}, ...options.props };
  await act(async () => { renderer = create(React.createElement(FoodExperience, props)); });
  async function unmount() { if (!unmounted) { await act(async () => renderer.unmount()); unmounted = true; } }
  t.after(async () => { await unmount(); assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0); assert.equal(backListeners.size, 0); assert.equal(appListeners.size, 0); });
  const h = {
    requests, posts, alerts, writes, values,
    get keyboardDismisses() { return keyboardDismisses; },
    get renderer() { return renderer; },
    get screen() { return screenNames.find(name => renderer.root.findAllByType(name).length); },
    get view() { return renderer.root.findByType(h.screen).props; },
    get transition() { return renderer.root.findByType('ScreenTransition').props; },
    press: async (callback, ...args) => act(async () => { h.view[callback](...args); }),
    alertButton: async label => act(async () => { const alert = alerts.at(-1); assert.ok(alert, 'expected a confirmation'); const button = alert[2].find(item => item.text === label); assert.ok(button, label); button.onPress?.(); }),
    resolvePost: async (index, result) => act(async () => { activeOrder = result.status === 'COMPLETED' || result.status === 'CANCELLED' ? null : result; posts[index].resolve(result); }),
    rejectPost: async (index, error = new Error('Соединение потеряно')) => act(async () => posts[index].reject(error)),
    change: async changes => { Object.assign(props, changes); await act(async () => renderer.update(React.createElement(FoodExperience, props))); },
    hardwareBack: async () => act(async () => { [...backListeners].reverse().some(listener => listener()); }),
    background: async () => act(async () => { native.AppState.currentState = 'background'; for (const listener of appListeners) listener('background'); }),
    runTimeouts: async () => act(async () => { const callbacks = [...timeouts.values()]; timeouts.clear(); for (const callback of callbacks) callback(); }),
    pauseNextWrite: () => { nextWriteGate = deferred(); return nextWriteGate; },
    unmount,
  };
  return h;
}

async function checkout(h, { quantity = 1, optionIds = [] } = {}) {
  await h.press('onFood');
  await h.press('onRestaurant', restaurant);
  await h.press('onDish', mainDish);
  await h.press('onAdd', mainDish, quantity, optionIds);
  assert.equal(h.screen, 'CartScreen');
  await h.press('onCheckout');
  assert.equal(h.screen, 'CheckoutScreen');
}

test('food experience follows the selected dark theme on its background and status bar', async t => {
  const h = await setup(t, { dark: true });
  assert.equal(h.renderer.root.findByType('View').props.style.backgroundColor, '#050505');
  assert.equal(h.renderer.root.findByType('StatusBar').props.style, 'light');
});

test('home shows at most three configured active banners and removes them after a live content update', async t => {
  let banners = [
    { id: 'hidden', active: false, sortOrder: 0 },
    { id: 'third', active: true, sortOrder: 3 },
    { id: 'first', active: true, sortOrder: 1 },
    { id: 'fourth', active: true, sortOrder: 4 },
    { id: 'second', active: true, sortOrder: 2 },
  ];
  const h = await setup(t, { request: url => url === '/content/banners' ? { banners } : undefined });
  assert.deepEqual(clone(h.view.banners.map(banner => banner.id)), ['first', 'second', 'third']);
  banners = [];
  await h.change({ contentRevision: 1 });
  assert.deepEqual(clone(h.view.banners), []);
});

test('configured banners open their actual restaurant, food catalog, or taxi service', async t => {
  let taxi = 0;
  const h = await setup(t, { props: { onTaxi: () => { taxi++; } } });
  await h.press('onBanner', { actionType: 'TAXI' });
  assert.equal(taxi, 1);
  await h.press('onBanner', { actionType: 'RESTAURANT', restaurantId: 'kfc' });
  assert.equal(h.screen, 'RestaurantScreen'); assert.equal(h.view.restaurant.id, 'kfc');
  await h.change({ entry: { screen: 'home', key: 2 } });
  await h.press('onBanner', { actionType: 'FOOD' });
  assert.equal(h.screen, 'RestaurantsScreen');
});

test('food favorites list saved restaurants and dishes and return to the list after opening either', async t => {
  const saved = { restaurantId: null, lines: [], favorites: ['sushi-roll'], favoriteDishes: ['kfc:burger'], address: 'ул. Ленина 12' };
  const h = await setup(t, { saved: { 'client-a': saved } });
  await h.press('onFood');
  assert.equal(h.view.favoriteCount, 2);
  await h.press('onFavorites');
  assert.equal(h.screen, 'FavoritesScreen');
  assert.deepEqual(clone(h.view.restaurants.map(item => item.id)), ['sushi-roll']);
  assert.deepEqual(clone(h.view.dishes.map(item => `${item.restaurant.id}:${item.dish.id}`)), ['kfc:burger']);
  await h.press('onRestaurant', restaurant);
  assert.equal(h.screen, 'RestaurantScreen');
  await h.press('onBack');
  assert.equal(h.screen, 'FavoritesScreen');
  await h.press('onDish', otherRestaurant, otherDish);
  assert.equal(h.screen, 'DishScreen');
  await h.hardwareBack();
  assert.equal(h.screen, 'FavoritesScreen');
  await h.press('onBack');
  assert.equal(h.screen, 'RestaurantsScreen');
});

test('food history reports a missing route in plain language and successfully retries', async t => {
  let unavailable = true;
  const h = await setup(t, { request: url => url === '/food/orders/history' && unavailable ? Promise.reject(new ApiError(404, 'Cannot GET /api/food/orders/history')) : undefined });
  await h.press('onOrders');
  assert.equal(h.screen, 'FoodHistoryScreen');
  assert.match(h.view.error, /временно недоступна/);
  assert.doesNotMatch(h.view.error, /Cannot|\/api\//);
  unavailable = false;
  await h.press('onRetry');
  assert.equal(h.view.error, ''); assert.equal(h.view.loading, false);
});

test('a live food order event refreshes the open order from authoritative server state', async t => {
  let current = order('live-order');
  const h = await setup(t, { request: url => url === '/food/orders/active' ? current : undefined });
  await h.press('onOrders');
  assert.equal(h.view.order.status, 'PLACED');
  current = order('live-order', { status: 'PREPARING', updatedAt: '2026-09-08T08:02:00Z' });
  await h.change({ orderRevision: 1 });
  assert.equal(h.view.order.status, 'PREPARING');
});

test('an order update arriving during a request queues a fresh read instead of losing the event', async t => {
  let current = order('queued-order');
  let pause;
  const h = await setup(t, { request: url => url === '/food/orders/active' ? pause?.promise ?? current : undefined });
  await h.press('onOrders');
  pause = deferred();
  await h.change({ orderRevision: 1 });
  current = order('queued-order', { status: 'READY', updatedAt: '2026-09-08T08:20:00Z' });
  await h.change({ orderRevision: 2 });
  const waiting = pause; pause = undefined;
  await act(async () => waiting.resolve(order('queued-order')));
  assert.equal(h.view.order.status, 'READY');
});

test('a live food order event refreshes history while preserving the current screen', async t => {
  let history = [order('history-order')];
  const h = await setup(t, { request: url => url === '/food/orders/history' ? history : undefined });
  await h.press('onOrders');
  history = [order('history-order', { status: 'COMPLETED', updatedAt: '2026-09-08T08:50:00Z' })];
  await h.change({ orderRevision: 1 });
  assert.equal(h.screen, 'FoodHistoryScreen');
  assert.equal(h.view.orders[0].status, 'COMPLETED');
});

test('catalog changes refresh an open restaurant and recalculate existing cart prices', async t => {
  let currentCatalog = clone(catalog);
  const h = await setup(t, { request: url => url === '/food/catalog' ? currentCatalog : undefined });
  await h.press('onFood'); await h.press('onRestaurant', restaurant); await h.press('onAdd', mainDish);
  assert.equal(h.view.cartTotal, 520);
  currentCatalog = clone(catalog); currentCatalog.restaurants[0].dishes[0].price = 570;
  await h.change({ contentRevision: 1 });
  assert.equal(h.screen, 'RestaurantScreen');
  assert.equal(h.view.restaurant.dishes[0].price, 570);
  assert.equal(h.view.cartTotal, 570);
});

test('submit waits for the actual server response, blocks double taps/back and only then clears the cart', async t => {
  const h = await setup(t);
  await checkout(h, { quantity: 2, optionIds: ['soy'] });
  await h.press('onSubmit');
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].url, '/food/orders');
  assert.equal(h.screen, 'CheckoutScreen');
  assert.equal(h.view.busy, true);
  assert.equal(h.view.lines[0].quantity, 2);
  assert.equal(h.writes.at(-1).state.pending.requestId, h.posts[0].body.requestId, 'request ID must be persisted before dispatch');
  await h.press('onSubmit');
  await h.hardwareBack();
  assert.equal(h.posts.length, 1);
  assert.equal(h.screen, 'CheckoutScreen');
  const accepted = order('actual-server-id', { total: 1040 });
  await h.resolvePost(0, accepted);
  assert.equal(h.screen, 'FoodOrderScreen');
  assert.equal(h.view.order.id, 'actual-server-id');
  assert.equal(h.view.order.total, 1040);
  assert.deepEqual(h.values.get('client-a').lines, []);
  assert.equal(h.values.get('client-a').pending, undefined);
});

test('a failed submission retains the cart and retry uses exactly the original request key', async t => {
  const h = await setup(t);
  await checkout(h, { quantity: 2, optionIds: ['ginger'] });
  await h.press('onDetails', { ...h.view.details, comment: 'Позвоните у ворот' });
  await h.press('onSubmit');
  await h.rejectPost(0);
  assert.equal(h.screen, 'CheckoutScreen');
  assert.equal(h.view.busy, false);
  assert.equal(h.view.error, 'Соединение потеряно');
  assert.equal(h.view.lines[0].quantity, 2);
  await h.press('onSubmit');
  assert.equal(h.posts.length, 2);
  assert.deepEqual(h.posts[1].body, h.posts[0].body);
  await h.resolvePost(1, order());
  assert.equal(h.screen, 'FoodOrderScreen');
});

test('saved cart, address and favorites restore before navigation and survive quantity changes', async t => {
  const saved = { restaurantId: 'sushi-roll', lines: [{ dishId: 'philadelphia', quantity: 3, optionIds: ['ginger'] }], favorites: ['sushi-roll'], favoriteDishes: ['sushi-roll:philadelphia'], address: 'ул. Советская 24' };
  const h = await setup(t, { saved: { 'client-a': saved } });
  await h.press('onFood');
  assert.equal(h.view.cartCount, 3);
  assert.equal(h.view.cartRestaurantName, 'Sushi Roll');
  await h.press('onRestaurant', restaurant);
  assert.equal(h.view.cartCount, 3);
  assert.equal(h.view.favorite, true);
  await h.press('onCart');
  assert.deepEqual(clone(h.view.lines), saved.lines);
  await h.press('onQuantity', 'philadelphia:ginger', 4);
  assert.equal(h.values.get('client-a').lines[0].quantity, 4);
  await h.press('onCheckout');
  assert.equal(h.view.details.address, 'ул. Советская 24');
});

test('checkout typing is debounced and persists only the latest address and comment', async t => {
  const h = await setup(t);
  await checkout(h);
  const writesBeforeTyping = h.writes.length;
  await h.press('onDetails', { ...h.view.details, comment: 'Домофон' });
  await h.press('onDetails', { ...h.view.details, comment: 'Домофон 42', address: 'ул. Манаса 42' });
  assert.equal(h.writes.length, writesBeforeTyping, 'typing must not write to SecureStore for every character');
  await h.runTimeouts();
  assert.equal(h.writes.length, writesBeforeTyping + 1);
  assert.equal(h.values.get('client-a').address, 'ул. Манаса 42');
  assert.equal(h.values.get('client-a').checkout.comment, 'Домофон 42');
});

test('backgrounding flushes pending checkout input and cancels its delayed write', async t => {
  const h = await setup(t);
  await checkout(h);
  await h.press('onDetails', { ...h.view.details, comment: 'Оставьте у двери' });
  const writesBeforeBackground = h.writes.length;
  await h.background();
  assert.equal(h.writes.length, writesBeforeBackground + 1);
  assert.equal(h.values.get('client-a').checkout.comment, 'Оставьте у двери');
  await h.runTimeouts();
  assert.equal(h.writes.length, writesBeforeBackground + 1, 'a flushed debounce must not run again');
});

test('unmounting flushes the latest pending checkout input', async t => {
  const h = await setup(t);
  await checkout(h);
  await h.press('onDetails', { ...h.view.details, address: 'ул. Токтогула 88', comment: 'Позвонить заранее' });
  await h.unmount();
  assert.equal(h.values.get('client-a').address, 'ул. Токтогула 88');
  assert.equal(h.values.get('client-a').checkout.comment, 'Позвонить заранее');
});

test('changing accounts flushes the old session without copying its checkout into the new one', async t => {
  const h = await setup(t);
  await checkout(h);
  await h.press('onDetails', { ...h.view.details, address: 'Старый адрес', comment: 'Старая сессия' });
  await h.change({ userId: 'client-b', defaultAddress: 'Новый адрес' });
  assert.equal(h.values.get('client-a').checkout.comment, 'Старая сессия');
  assert.equal(h.values.get('client-b').address, 'Новый адрес');
  assert.equal(h.values.get('client-b').checkout.comment, '');
});

test('food navigation declares forward and back transitions explicitly', async t => {
  const h = await setup(t);
  const initialDismisses = h.keyboardDismisses;
  await h.press('onFood');
  assert.equal(h.transition.routeKey, 'restaurants');
  assert.equal(h.transition.direction, 'forward');
  assert.equal(h.keyboardDismisses, initialDismisses + 1);
  await h.press('onRestaurant', restaurant);
  assert.equal(h.transition.routeKey, 'restaurant:sushi-roll');
  assert.equal(h.transition.direction, 'forward');
  assert.equal(h.keyboardDismisses, initialDismisses + 2, 'a focused cached search input must release the keyboard');
  await h.press('onBack');
  assert.equal(h.transition.routeKey, 'restaurants');
  assert.equal(h.transition.direction, 'back');
  assert.equal(h.keyboardDismisses, initialDismisses + 3);
});

test('the shared cart opens from the restaurant catalog and returns to its actual origin', async t => {
  const saved = { restaurantId: 'sushi-roll', lines: [{ dishId: 'philadelphia', quantity: 2, optionIds: [] }], favorites: [], favoriteDishes: [], address: 'ул. Ленина 12' };
  const h = await setup(t, { saved: { 'client-a': saved } });
  await h.press('onFood');
  assert.equal(h.screen, 'RestaurantsScreen');
  assert.equal(h.view.cartCount, 2);
  assert.equal(h.view.cartRestaurantName, 'Sushi Roll');
  await h.press('onCart');
  assert.equal(h.screen, 'CartScreen');
  await h.press('onBack');
  assert.equal(h.screen, 'RestaurantsScreen');
  await h.press('onRestaurant', restaurant);
  await h.press('onCart');
  await h.press('onBack');
  assert.equal(h.screen, 'RestaurantScreen');
  assert.equal(h.view.restaurant.id, 'sushi-roll');
});

test('changing restaurants requires confirmation; cancel retains the old cart and replace keeps only new dishes', async t => {
  const h = await setup(t);
  await h.press('onFood'); await h.press('onRestaurant', restaurant); await h.press('onAdd', mainDish);
  await h.press('onBack'); await h.press('onRestaurant', otherRestaurant); await h.press('onAdd', otherDish);
  assert.equal(h.alerts.length, 1);
  assert.equal(h.values.get('client-a').restaurantId, 'sushi-roll');
  await h.alertButton('Оставить');
  assert.equal(h.values.get('client-a').lines[0].dishId, 'philadelphia');
  await h.press('onAdd', otherDish); await h.alertButton('Заменить');
  await h.press('onCart');
  assert.equal(h.view.restaurant.id, 'kfc');
  assert.deepEqual(clone(h.view.lines), [{ dishId: 'burger', quantity: 1, optionIds: [] }]);
});

test('cart quantity controls remove zero lines, cap quantities and clear only after confirmation', async t => {
  const h = await setup(t);
  await checkout(h);
  await h.press('onBack');
  await h.press('onQuantity', 'philadelphia:', 100);
  assert.equal(h.view.lines[0].quantity, 20);
  await h.press('onQuantity', 'philadelphia:', 0);
  assert.deepEqual(clone(h.view.lines), []);
  await h.press('onBack'); await h.press('onAdd', mainDish); await h.press('onCart');
  await h.press('onClear'); await h.alertButton('Оставить');
  assert.equal(h.view.lines.length, 1);
  await h.press('onClear'); await h.alertButton('Очистить');
  assert.deepEqual(clone(h.view.lines), []);
  assert.equal(h.values.get('client-a').restaurantId, null);
});

test('removing an option never silently drops dishes when matching lines would exceed the quantity limit', async t => {
  const saved = { restaurantId: 'sushi-roll', lines: [{ dishId: 'philadelphia', quantity: 20, optionIds: ['soy'] }, { dishId: 'philadelphia', quantity: 20, optionIds: [] }], favorites: [], favoriteDishes: [], address: 'ул. Ленина 12' };
  const h = await setup(t, { saved: { 'client-a': saved } });
  await h.press('onFood'); await h.press('onRestaurant', restaurant); await h.press('onCart');
  await h.press('onRemoveOption', 'soy');
  assert.equal(h.view.lines.reduce((sum, line) => sum + line.quantity, 0), 40);
  assert.equal(h.values.get('client-a').lines.reduce((sum, line) => sum + line.quantity, 0), 40);
});

test('the restored active order opens from home; history order navigation returns to its origin', async t => {
  const active = order('active-order');
  const completed = order('completed-order', { status: 'COMPLETED' });
  const h = await setup(t, { activeOrder: active, history: [completed] });
  assert.equal(h.view.hasOrder, true);
  await h.press('onOrders');
  assert.equal(h.screen, 'FoodOrderScreen');
  assert.equal(h.view.order.id, 'active-order');
  await h.press('onBack'); assert.equal(h.screen, 'ServiceHomeScreen');
  await h.change({ entry: { screen: 'history', key: 2 } });
  assert.equal(h.screen, 'FoodHistoryScreen');
  await h.press('onOrder', completed); assert.equal(h.view.order.id, 'completed-order');
  await h.hardwareBack(); assert.equal(h.screen, 'FoodHistoryScreen');
});

test('unmounting while persisting a submission prevents dispatch with a later login session', async t => {
  const h = await setup(t);
  await checkout(h);
  const write = h.pauseNextWrite();
  await h.press('onSubmit');
  assert.equal(h.posts.length, 0);
  await h.unmount();
  await act(async () => write.resolve());
  assert.equal(h.posts.length, 0, 'an unmounted checkout must not initiate a new request after logout');
});

test('changing accounts while persisting a submission never dispatches it in the next session', async t => {
  const h = await setup(t);
  await checkout(h);
  const write = h.pauseNextWrite();
  await h.press('onSubmit');
  assert.equal(h.posts.length, 0);
  await h.change({ userId: 'client-b', defaultAddress: 'Новый адрес' });
  await act(async () => write.resolve());
  assert.equal(h.posts.length, 0, 'an order prepared by the old account must not dispatch after an account switch');
});

test('retrying after restart keeps delivery-only fulfillment, comment and request key', async t => {
  const first = await setup(t);
  await checkout(first);
  await first.press('onDetails', { ...first.view.details, fulfillment: 'PICKUP', comment: 'Буду через полчаса' });
  await first.press('onSubmit');
  await first.rejectPost(0);
  const saved = clone(first.values.get('client-a'));
  const original = first.posts[0].body;
  await first.unmount();
  const next = await setup(t, { saved: { 'client-a': saved } });
  await next.press('onFood'); await next.press('onRestaurant', restaurant); await next.press('onCart'); await next.press('onCheckout');
  assert.equal(next.view.details.fulfillment, 'DELIVERY');
  assert.equal(next.view.details.comment, 'Буду через полчаса');
  await next.press('onSubmit');
  assert.deepEqual(next.posts[0].body, original, 'lost-response retries must keep the same submitted body and request ID after restart');
  await next.resolvePost(0, order());
});

test('a delayed refresh for an older history selection cannot replace the currently selected order', async t => {
  const oldOrder = order('old-order', { status: 'COMPLETED' });
  const nextOrder = order('next-order', { status: 'COMPLETED' });
  const response = deferred();
  const h = await setup(t, { history: [oldOrder, nextOrder], props: { entry: { screen: 'history', key: 1 } }, request: url => url === '/food/orders/old-order' ? response.promise : undefined });
  await h.press('onOrder', oldOrder);
  assert.ok(h.requests.includes('/food/orders/old-order'));
  await h.press('onBack');
  await h.press('onOrder', nextOrder);
  assert.equal(h.view.order.id, 'next-order');
  await act(async () => response.resolve({ ...oldOrder, updatedAt: '2026-09-08T09:00:00Z' }));
  assert.equal(h.view.order.id, 'next-order');
});
