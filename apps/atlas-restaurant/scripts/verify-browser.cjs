/* UI FIXTURE SMOKE ONLY. Does not authenticate with or mutate the real Atlas backend.
 * Start: EXPO_PUBLIC_API_URL=http://localhost:3000/api npx expo start --web --port 8097
 * Run: node scripts/verify-browser.cjs (requires Playwright, or PLAYWRIGHT_MODULE path).
 * Fixtures and browser artifacts never enter the application bundle.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workspace = path.resolve(__dirname, '../../..');
const artifactDir = path.join(workspace, '.local/restaurant-v2-verification');
const baseUrl = process.env.ATLAS_SMOKE_URL || 'http://localhost:8097';
const copy = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const permissions = ['orders.read', 'orders.manage', 'menu.manage', 'restaurant.manage', 'delivery.manage', 'promotions.manage', 'stats.read', 'staff.manage'];
  const owner = { user: { id: 'fixture-owner', name: 'UI fixture owner', phone: '+996700111222' }, memberships: [
    { restaurantId: 'fixture-one', restaurantName: 'Кухня А · UI fixture', role: 'OWNER', permissions },
    { restaurantId: 'fixture-two', restaurantName: 'Кухня Б · UI fixture', role: 'OWNER', permissions },
  ] };
  const manager = { user: { id: 'fixture-manager', name: 'UI fixture manager', phone: '+996700111333' }, memberships: [
    { restaurantId: 'fixture-one', restaurantName: 'Кухня А · UI fixture', role: 'MANAGER', permissions: ['orders.read'] },
  ] };
  const sauce = { id: 'fixture-sauce', name: 'Острый соус', price: 20, imageKey: 'achichuk', priceScope: 'PER_PORTION' };
  const dishes = [
    { id: 'fixture-manty', name: 'Манты с говядиной', description: 'Горячие манты на пару', category: 'Горячее', portion: '5 шт.', weightGrams: 350, price: 280, imageKey: 'manti', available: true, optionIds: [sauce.id], optionGroups: [{ id: 'fixture-group', name: 'Соусы', minSelected: 0, maxSelected: 1, optionIds: [sauce.id] }], defaultOptionIds: [], ingredients: 'Говядина, лук, тесто' },
    { id: 'fixture-lagman', name: 'Лагман', description: 'Ручная лапша с овощами', category: 'Горячее', portion: '1 порция', weightGrams: 400, price: 320, imageKey: 'lagman', available: true, optionIds: [] },
    { id: 'fixture-salad', name: 'Ачичук', description: 'Свежие томаты и лук', category: 'Салаты', portion: '1 порция', weightGrams: 180, price: 180, imageKey: 'achichuk', available: false, optionIds: [] },
  ];
  const catalogs = Object.fromEntries(owner.memberships.map(member => [member.restaurantId, {
    catalog: { id: member.restaurantId, name: member.restaurantName, cuisine: 'Кыргызская кухня', categories: ['Национальная'], address: 'Бишкек, Киевская 100', phone: '+996700111222', latitude: 42.87, longitude: 74.59, imageKey: 'manti', heroImageKey: 'lagman', isOpen: true, etaMin: 30, etaMax: 45, deliveryFee: 100, freeDeliveryThreshold: 1000, minimumOrder: 200, menuCategories: ['Горячее', 'Салаты'], dishes: copy(dishes), options: [copy(sauce)], promotions: [], rating: 4.8, reviewCount: 42, isDemo: false },
    active: true, updatedAt: '2026-10-11T10:00:00.000Z',
  }]));
  const order = (tail, status, extra = {}) => ({
    id: `00000000-0000-4000-8000-000000${tail}`, restaurantId: 'fixture-one', restaurantSnapshot: { id: 'fixture-one', name: owner.memberships[0].restaurantName, address: 'Киевская 100' },
    items: [{ dishId: dishes[0].id, name: dishes[0].name, portion: '5 шт.', imageKey: 'manti', quantity: 2, unitPrice: 280, options: [copy(sauce)], lineTotal: 600 }],
    client: { name: 'Гость · UI fixture', phone: '+996700222333' }, subtotal: 600, deliveryFee: 100, total: 700,
    status, fulfillment: 'DELIVERY', paymentMethod: 'CASH', address: 'Бишкек, Московская 120', comment: 'Без лука. Позвоните у подъезда.', deliveryPoint: { latitude: 42.865, longitude: 74.601 },
    createdAt: '2026-10-11T10:10:00.000Z', updatedAt: '2026-10-11T10:10:00.000Z', isDemo: false,
    history: [{ id: `history-${tail}`, status, createdAt: '2026-10-11T10:10:00.000Z', reason: null }], ...extra,
  });
  const orders = [order('100001', 'PLACED'), order('100002', 'READY'), order('100003', 'READY', { fulfillment: 'PICKUP', deliveryFee: 0, total: 600 }), order('100004', 'COMPLETED')];
  orders.push(order('200001', 'PLACED', { restaurantId: 'fixture-two', restaurantSnapshot: { id: 'fixture-two', name: owner.memberships[1].restaurantName, address: 'Киевская 200' } }));
  return { owner, manager, currentProfile: owner, catalogs, orders, writes: [], requests: [], serial: 0, offline: false };
}

async function intercept(page, state) {
  // Exact local fixture endpoint only. A production API URL will never be intercepted.
  await page.route(/^http:\/\/(?:localhost|127\.0\.0\.1):3000\/api\/restaurant(?:\/|$)/, async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': '*', 'access-control-allow-headers': '*' } });
    if (state.offline) return route.abort('internetdisconnected');
    const parts = url.pathname.slice('/api/restaurant/'.length).split('/');
    const method = request.method();
    const input = method === 'GET' ? null : request.postDataJSON();
    state.requests.push({ method, path: url.pathname });
    const send = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (parts[0] === 'auth' && parts[1] === 'login') {
      if (input.password === 'fixture-invalid') return send({ message: 'Неверный телефон или пароль' }, 401);
      state.currentProfile = input.phone.endsWith('333') ? state.manager : state.owner;
      return send({ ...copy(state.currentProfile), accessToken: 'fixture-access-token', refreshToken: 'fixture-refresh-token', expiresIn: 900 });
    }
    if (parts[0] === 'auth' && parts[1] === 'logout') return send({ ok: true });
    if (parts[0] === 'me') return send(copy(state.currentProfile));
    const id = parts[0];
    if (!state.currentProfile.memberships.some(member => member.restaurantId === id)) return send({ message: 'Нет доступа' }, 403);
    if (method !== 'GET') state.writes.push({ method, parts, input: copy(input) });
    if (parts.length === 1 && method === 'GET') return send(copy(state.catalogs[id]));
    if (parts[1] === 'stats') {
      const scoped = state.orders.filter(order => order.restaurantId === id); const complete = scoped.filter(order => order.status === 'COMPLETED');
      const revenue = complete.reduce((sum, order) => sum + order.total, 0);
      return send({ totalOrders: scoped.length, revenue, averageOrder: complete.length ? Math.round(revenue / complete.length) : 0, completedOrders: complete.length, cancelledOrders: scoped.filter(order => order.status === 'CANCELLED').length, byDay: [{ date: '2026-10-11', orders: scoped.length, revenue }] });
    }
    if (parts[1] === 'orders' && parts.length === 2) return send({ orders: copy(state.orders.filter(order => order.restaurantId === id)) });
    if (parts[1] === 'orders' && parts[2]) {
      const order = state.orders.find(order => order.id === parts[2] && order.restaurantId === id);
      if (!order) return send({ message: 'Заказ не найден' }, 404);
      if (parts[3] === 'dispatch-quote') return send({ price: 240, currency: 'KGS', deliveryPayer: 'RESTAURANT' });
      if (parts[3] === 'dispatch') {
        if (input.method === 'OWN') { order.deliveryMethod = 'OWN'; order.status = 'DELIVERING'; order.courierName = input.courierName; order.courierPhone = input.courierPhone; }
        else { assert.equal(input.expectedPrice, 240); order.deliveryMethod = 'ATLAS_CAR'; order.atlasStatus = 'SEARCHING'; order.atlasOrderId = 'fixture-ride'; order.deliveryPrice = 240; order.atlasDelivery = { id: 'fixture-ride', status: 'SEARCHING', price: 240, driver: null }; }
      } else if (method === 'PATCH') order.status = ({ ACCEPT: 'CONFIRMED', PREPARING: 'PREPARING', READY: 'READY', COMPLETE: 'COMPLETED', CANCEL: 'CANCELLED' })[input.action];
      else return send({ message: 'Неизвестное действие' }, 400);
      order.updatedAt = new Date(Date.UTC(2026, 9, 11, 11, 0, ++state.serial)).toISOString();
      order.history.push({ id: `event-${state.serial}`, status: order.status, createdAt: order.updatedAt, reason: input.reason || (input.method === 'OWN' ? 'OWN_COURIER' : input.method === 'ATLAS_CAR' ? 'ATLAS_DISPATCH:fixture-ride' : null) });
      return send(copy(order));
    }
    if (parts[1] === 'catalog' && method === 'PUT') {
      if (input.updatedAt !== state.catalogs[id].updatedAt) return send({ message: 'Меню изменилось' }, 409);
      state.catalogs[id] = { catalog: copy(input.catalog), active: true, updatedAt: new Date(Date.UTC(2026, 9, 11, 12, 0, ++state.serial)).toISOString() };
      return send(copy(state.catalogs[id]));
    }
    if (parts[1] === 'staff') return send({ staff: [{ id: 'fixture-staff', name: 'Менеджер · UI fixture', phone: '+996700111333', role: 'MANAGER', permissions: ['orders.read'], active: true }] });
    return send({ message: `Fixture route not handled: ${method} ${url.pathname}` }, 404);
  });
}

async function waitForPhotos(page, expectedImage) {
  await page.waitForFunction(expected => {
    const images = [...document.images].filter(image => {
      const rect = image.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
    return (!expected || images.some(image => (image.currentSrc || image.src).includes(expected)))
      && images.every(image => image.complete && image.naturalWidth > 0);
  }, expectedImage, { timeout: 45000 });
}

async function runMediaPreview(page) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const state = fixture(); const errors = [];
  state.catalogs['fixture-one'].catalog.promotions = [{ id: 'fixture-preview-sale', title: 'Скидка · UI fixture', type: 'PERCENT', value: 15, minSubtotal: 0, dishIds: ['fixture-manty'], active: true }];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20000);
  await intercept(page, state);
  await page.setViewportSize({ width: 360, height: 820 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.getByLabel('Телефон', { exact: true }).fill('+996700111222');
  await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: 'Войти', exact: true }).click();
  await page.getByText('Хорошего дня!', { exact: true }).waitFor();
  await waitForPhotos(page, 'lagman');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(artifactDir, 'UI-FIXTURE-dashboard-360.png') });
  const dashboardImage = await page.locator('img').evaluateAll(images => images.filter(image => (image.currentSrc || image.src).includes('lagman')).map(image => ({ loaded: image.complete, naturalWidth: image.naturalWidth, height: image.getBoundingClientRect().height })));
  assert.ok(dashboardImage.some(image => image.loaded && image.naturalWidth > 0 && image.height === 165));
  await page.getByRole('tab', { name: 'Меню', exact: true }).click();
  await page.getByRole('button', { name: 'Как видит клиент: Манты с говядиной', exact: true }).click();
  await page.getByText('238 сом', { exact: true }).first().waitFor();
  await page.getByText('−15%', { exact: true }).waitFor();
  const original = page.getByText('280 сом', { exact: true }).last();
  await original.waitFor();
  assert.ok(await original.evaluate(element => getComputedStyle(element).textDecorationLine.includes('line-through')));
  await page.getByRole('radio', { name: 'Острый соус, 20 сом', exact: true }).click();
  await page.getByText('258 сом', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Увеличить количество', exact: true }).click();
  await page.getByText('516 сом', { exact: true }).waitFor();
  await waitForPhotos(page, 'manti');
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(artifactDir, 'UI-FIXTURE-discount-preview-360.png') });
  assert.equal(state.writes.length, 0, 'Preview must not write orders or catalog');
  assert.deepEqual(errors, []);
  const result = { kind: 'Targeted UI fixture smoke; not live backend E2E', dashboardImage, checks: ['dashboard-photo-loaded-at-360', 'discount-base-280-to-238', 'modifier-remains-20-total-258', 'two-portions-total-516', 'preview-produces-no-writes'], browserErrors: errors };
  fs.writeFileSync(path.join(artifactDir, 'media-preview-result.json'), JSON.stringify(result, null, 2));
  return result;
}

async function run(page, options = {}) {
  fs.mkdirSync(artifactDir, { recursive: true });
  const state = fixture(); const checks = []; const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(90000);
  await intercept(page, state);
  await page.setViewportSize({ width: 360, height: 820 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const capture = async name => {
    await waitForPhotos(page);
    // Let the platform modal transition settle before recording pixels.
    await page.waitForTimeout(350);
    if (options.onCapture) await options.onCapture(page, name);
    await page.screenshot({ path: path.join(artifactDir, `UI-FIXTURE-${name}.png`), fullPage: false });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    assert.equal(overflow, false, `Horizontal overflow in ${name}`);
  };
  const visible = async locator => locator.waitFor({ state: 'visible' });
  const close = () => page.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  const closeOrder = () => page.getByLabel('Закрыть заказ', { exact: true }).last().click();
  const step = async (name, work) => {
    try { await work(); checks.push(name); console.log(`PASS ${name}`); }
    catch (error) { await capture(`FAILED-${name.replace(/[^a-z\d-]/gi, '-')}`).catch(() => undefined); throw new Error(`${name}: ${error.message}`); }
  };
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await step('login-owner-360', async () => {
    const phone = page.getByLabel('Телефон', { exact: true });
    const password = page.getByLabel('Пароль', { exact: true });
    const login = page.getByRole('button', { name: 'Войти', exact: true });
    await visible(phone);
    assert.equal(await login.isDisabled(), true, 'Empty password must not submit');
    await phone.fill('+996700111222');
    await password.fill('fixture-invalid');
    assert.equal(await password.evaluate(input => input.type), 'password');
    await page.getByRole('button', { name: 'Показать пароль', exact: true }).click();
    assert.equal(await password.evaluate(input => input.type), 'text');
    assert.equal(await password.inputValue(), 'fixture-invalid');
    await page.getByRole('button', { name: 'Скрыть пароль', exact: true }).click();
    assert.equal(await password.evaluate(input => input.type), 'password');
    assert.equal(state.requests.length, 0, 'Password visibility must not authenticate');
    await login.click();
    await visible(page.getByText('Неверный телефон или пароль', { exact: true }));
    assert.equal(await phone.inputValue(), '+996700111222');
    assert.equal(await password.inputValue(), 'fixture-invalid');
    // Re-open to record the clean layout after exercising the failed-login state.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await phone.fill('+996700111222');
    await password.fill('fixture-password');
    await page.getByText('Вход в ресторан', { exact: true }).click();
    await page.setViewportSize({ width: 393, height: 857 });
    await capture('login-393');
    await page.setViewportSize({ width: 360, height: 820 });
    await capture('login-360');
    await login.click();
    await visible(page.getByText('Хорошего дня!', { exact: true }));
    await waitForPhotos(page, 'lagman');
    await capture('dashboard-360');
  });
  await step('orders-modifiers-accept-prepare-ready-own', async () => {
    await page.getByRole('tab', { name: 'Заказы', exact: true }).click();
    await capture('orders-360');
    await page.getByRole('button', { name: /Заказ 100001,/ }).click();
    await visible(page.getByText('+ Острый соус', { exact: true }));
    await visible(page.getByText('Оплата наличными', { exact: true }));
    await page.waitForTimeout(350);
    const primaryBox = await page.getByRole('button', { name: 'Принять заказ', exact: true }).boundingBox();
    assert.ok(primaryBox && primaryBox.y + primaryBox.height <= 820, 'Primary order action must remain visible without scrolling');
    await capture('order-detail-360');
    await page.getByRole('button', { name: 'Принять заказ', exact: true }).click();
    await page.getByRole('button', { name: 'Начать готовить', exact: true }).click();
    await page.getByRole('button', { name: 'Заказ готов', exact: true }).click();
    await page.getByText('Свой курьер', { exact: true }).click();
    await page.getByLabel('Имя курьера', { exact: true }).fill('Азамат');
    await page.getByLabel('Телефон курьера', { exact: true }).fill('+996700444555');
    await page.getByRole('button', { name: 'Передать своему курьеру' }).click();
    await visible(page.getByText('Азамат', { exact: true }));
    await page.getByRole('button', { name: 'Завершить заказ', exact: true }).click();
    await visible(page.getByText('Завершён', { exact: true }).first());
    assert.equal(state.orders[0].status, 'COMPLETED');
    assert.equal(state.orders.find(order => order.restaurantId === 'fixture-two').status, 'PLACED');
    await closeOrder();
  });
  await step('atlas-quote-then-confirm-one-dispatch', async () => {
    await page.getByRole('button', { name: /Заказ 100002,/ }).click();
    await page.getByText('Машина Atlas', { exact: true }).click();
    await page.getByRole('button', { name: 'Рассчитать стоимость Atlas' }).click();
    await visible(page.getByRole('button', { name: 'Подтвердить вызов · 240 сом' }));
    assert.equal(state.writes.filter(write => write.parts[3] === 'dispatch' && write.input.method === 'ATLAS_CAR').length, 0);
    await capture('atlas-price-confirmation-360');
    await page.getByRole('button', { name: 'Подтвердить вызов · 240 сом' }).click();
    await visible(page.getByText('Ищем машину', { exact: true }));
    assert.equal(state.writes.filter(write => write.parts[3] === 'dispatch' && write.input.method === 'ATLAS_CAR').length, 1);
    assert.equal(await page.getByRole('button', { name: 'Отменить заказ', exact: true }).count(), 0);
    await closeOrder();
  });
  await step('pickup-completes-without-delivery', async () => {
    await page.getByRole('button', { name: /Заказ 100003,/ }).click();
    assert.equal(await page.getByText('Машина Atlas', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Выдать заказ клиенту' }).click();
    await visible(page.getByText('Завершён', { exact: true }).first());
    assert.equal(state.orders.find(order => order.id.endsWith('100003')).status, 'COMPLETED');
    await closeOrder();
  });
  await step('offline-retains-data-reconnect-recovers-new-orders', async () => {
    state.offline = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await visible(page.getByText('Обновление задерживается', { exact: true }));
    await visible(page.getByRole('button', { name: /Заказ 100002,/ }));
    const missed = copy(state.orders[0]);
    missed.id = '00000000-0000-4000-8000-000000100005'; missed.status = 'PLACED'; missed.deliveryMethod = null;
    missed.createdAt = '2026-10-11T12:00:00.000Z'; missed.updatedAt = missed.createdAt;
    state.orders.push(missed);
    await capture('offline-orders-retained-360');
    state.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await visible(page.getByRole('button', { name: /Заказ 100005,/ }));
    await visible(page.getByRole('button', { name: 'Открыть новые заказы', exact: true }));
    assert.equal(await page.getByText('Обновление задерживается', { exact: true }).count(), 0);
  });
  await step('menu-create-modifier-preview-save', async () => {
    await page.getByRole('tab', { name: 'Меню', exact: true }).click();
    await capture('menu-360');
    await page.getByRole('button', { name: 'Блюдо', exact: true }).click();
    await page.getByLabel('Название блюда', { exact: true }).fill('Суп дня · UI fixture');
    await page.getByLabel('Цена, сом', { exact: true }).fill('250');
    await page.getByLabel('Вес, г', { exact: true }).fill('350');
    await page.getByLabel('Размер порции', { exact: true }).fill('1 порция');
    await page.getByRole('button', { name: 'Модификаторы', exact: true }).click();
    await page.getByRole('button', { name: '+ Соусы', exact: true }).click();
    await page.getByRole('button', { name: 'Добавить вариант', exact: true }).click();
    await page.getByLabel('Название варианта', { exact: true }).fill('Сметана');
    await page.getByLabel('Доплата, сом', { exact: true }).fill('30');
    await page.getByRole('button', { name: 'Как видит клиент', exact: true }).click();
    await visible(page.getByText('Суп дня · UI fixture', { exact: true }));
    await page.getByRole('radio', { name: 'Сметана, 30 сом', exact: true }).click();
    await capture('dish-preview-360');
    await close();
    await page.getByRole('button', { name: 'Добавить в меню', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Редактировать Суп дня · UI fixture', exact: true }));
    const created = state.catalogs['fixture-one'].catalog.dishes.find(dish => dish.name === 'Суп дня · UI fixture');
    assert.equal(created.optionGroups[0].name, 'Соусы'); assert.equal(created.price, 250);
    assert.equal(state.catalogs['fixture-two'].catalog.dishes.some(dish => dish.name === created.name), false);
  });
  await step('promotion-save-and-statistics', async () => {
    await page.getByRole('tab', { name: 'Акции', exact: true }).click();
    await page.getByRole('button', { name: 'Создать акцию', exact: true }).click();
    await page.getByLabel('Название', { exact: true }).fill('Обед · UI fixture');
    await page.getByLabel('Скидка, %', { exact: true }).fill('15');
    await page.getByLabel('Минимальный заказ, сом', { exact: true }).fill('500');
    await capture('promotion-editor-360');
    await page.getByRole('button', { name: 'Сохранить акцию', exact: true }).click();
    await visible(page.getByRole('button', { name: 'Изменить акцию Обед · UI fixture', exact: true }));
    assert.equal(state.catalogs['fixture-one'].catalog.promotions[0].value, 15);
    await page.getByRole('tab', { name: 'Цифры', exact: true }).click();
    await page.getByRole('button', { name: 'Месяц', exact: true }).click();
    await visible(page.getByText('Динамика по дням', { exact: true }));
    await capture('analytics-360');
  });
  await step('restaurant-switch-isolation-and-tablet', async () => {
    await page.getByRole('button', { name: 'Выбрать ресторан', exact: true }).click();
    await page.getByText('Кухня Б · UI fixture', { exact: true }).click();
    await visible(page.getByText('Хорошего дня!', { exact: true }));
    await page.getByRole('tab', { name: 'Заказы', exact: true }).click();
    await visible(page.getByRole('button', { name: /Заказ 200001,/ }));
    assert.equal(await page.getByRole('button', { name: /Заказ 10000/ }).count(), 0);
    await page.setViewportSize({ width: 800, height: 1000 });
    await capture('orders-800');
    await page.getByRole('tab', { name: 'Главная', exact: true }).click();
    await capture('dashboard-800');
    await page.getByRole('tab', { name: 'Ресторан', exact: true }).click();
    await capture('restaurant-800');
  });
  await step('restaurant-photo-crop-controls', async () => {
    await page.setViewportSize({ width: 360, height: 820 });
    await page.getByRole('button', { name: 'О ресторане', exact: true }).click();
    const pendingChooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Заменить фотографию', exact: true }).first().click();
    await (await pendingChooser).setFiles(path.resolve(__dirname, '../assets/food/photography/real/manti.jpg'));
    await visible(page.getByText('Кадрирование', { exact: true }));
    await page.getByRole('button', { name: 'Увеличить фото', exact: true }).click();
    await visible(page.getByText('Масштаб 125%', { exact: true }));
    await page.getByRole('button', { name: 'Сместить кадр: влево', exact: true }).click();
    await capture('restaurant-photo-crop-360');
    // Cancel before upload: only the local restaurant API is mocked by this suite.
    await close();
    await capture('restaurant-profile-360');
    await close();
    assert.equal(state.catalogs['fixture-two'].catalog.imageKey, 'manti');
  });
  await step('manager-read-only-permission-gating', async () => {
    // Web uses in-memory credentials. Reload gives a clean session without touching any real account.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.setViewportSize({ width: 360, height: 820 });
    await page.getByLabel('Телефон', { exact: true }).fill('+996700111333');
    await page.getByLabel('Пароль', { exact: true }).fill('fixture-password');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await visible(page.getByText('Хорошего дня!', { exact: true }));
    for (const tab of ['Меню', 'Акции', 'Цифры']) assert.equal(await page.getByRole('tab', { name: tab, exact: true }).count(), 0, `Manager sees ${tab}`);
    await page.getByRole('tab', { name: 'Заказы', exact: true }).click();
    await page.getByRole('button', { name: /Заказ 100002,/ }).click();
    assert.equal(await page.getByRole('button', { name: /Принять заказ|Отменить заказ|Завершить заказ/ }).count(), 0);
    await capture('manager-read-only-360');
    await closeOrder();
  });
  assert.deepEqual(errors, [], 'Unhandled browser errors');
  const result = { kind: 'UI fixture smoke; not live backend E2E', baseUrl, checks, screenshots: fs.readdirSync(artifactDir).filter(name => name.startsWith('UI-FIXTURE-') && !name.includes('FAILED-') && name.endsWith('.png')), writes: state.writes.length, browserErrors: errors };
  fs.writeFileSync(path.join(artifactDir, 'ui-fixture-result.json'), JSON.stringify(result, null, 2));
  return result;
}
module.exports = { run, runMediaPreview, fixture, intercept, waitForPhotos };
if (require.main === module) {
  const modulePath = process.env.PLAYWRIGHT_MODULE || path.join(artifactDir, 'runner/node_modules/playwright');
  let playwright; try { playwright = require('playwright'); } catch { playwright = require(modulePath); }
  (async () => {
    const browser = await playwright.chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
    try { const page = await browser.newPage(); const result = await (process.env.ATLAS_SMOKE_FOCUS === 'media-preview' ? runMediaPreview(page) : run(page)); console.log(JSON.stringify(result, null, 2)); }
    finally { await browser.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

