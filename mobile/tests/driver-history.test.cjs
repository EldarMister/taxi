const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

function loadTypeScript(file, resolve = () => ({}), globals = {}) {
  const output = {};
  const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { exports: output, require: resolve, ...globals });
  return output;
}

const history = loadTypeScript('../src/driverHistory.ts');
const plain = value => JSON.parse(JSON.stringify(value));
const point = address => ({ address, latitude: 42.87, longitude: 74.59 });
const order = (id, createdAt, extra = {}) => ({
  id, createdAt, status: 'COMPLETED', price: 100, commissionAmount: -10, paymentMethod: 'CASH',
  pickup: point(`Начало ${id}`), dropoff: point(`Конец ${id}`), geometry: [], distanceMeters: 2000, durationSeconds: 600,
  ...extra,
});

test('driver history uses Bishkek midnight and creation time even on devices in another timezone', () => {
  assert.equal(history.historyDay('2026-10-04T17:59:59.999Z'), '2026-10-04');
  assert.equal(history.historyDay('2026-10-04T18:00:00.000Z'), '2026-10-05');
  assert.equal(history.historyDay('2026-10-05T00:30:00+14:00'), '2026-10-04');
  assert.equal(history.historyBoundary('2026-10-05'), '2026-10-04T18:00:00.000Z');
  const range = history.historyRange('today', '2026-10-05');
  const orders = [
    order('previous', '2026-10-04T17:59:59.999Z', { completedAt: '2026-10-04T19:00:00Z' }),
    order('first', range.from),
    order('last', '2026-10-05T17:59:59.999Z'),
    order('next', range.to),
  ];
  assert.deepEqual(plain(history.ordersInHistoryRange(orders, range).map(value => value.id)), ['first', 'last']);
});

test('today and the last seven days include the selected date across year boundaries', () => {
  assert.deepEqual(plain(history.historyRange('today', '2027-01-02')), {
    from: '2027-01-01T18:00:00.000Z', to: '2027-01-02T18:00:00.000Z',
  });
  assert.deepEqual(plain(history.historyRange('week', '2027-01-02')), {
    from: '2026-12-26T18:00:00.000Z', to: '2027-01-02T18:00:00.000Z',
  });
  assert.equal(history.shiftHistoryDay('2027-01-01', -1), '2026-12-31');
});

test('month selection covers every day and excludes next month, including leap February', () => {
  assert.deepEqual(plain(history.historyRange('month', '2028-02-15')), {
    from: '2028-01-31T18:00:00.000Z', to: '2028-02-29T18:00:00.000Z',
  });
  assert.deepEqual(plain(history.historyRange('month', '2027-02-28')), {
    from: '2027-01-31T18:00:00.000Z', to: '2027-02-28T18:00:00.000Z',
  });
  assert.deepEqual(plain(history.historyRange('month', '2026-12-31')), {
    from: '2026-11-30T18:00:00.000Z', to: '2026-12-31T18:00:00.000Z',
  });
});

test('income counts completed fares once and keeps the posted commission sign and actual payment method', () => {
  const orders = [
    order('cash', '2026-10-05T10:00:00Z', { price: 225.1, commissionAmount: -22.5 }),
    order('card', '2026-10-05T11:00:00Z', { price: 199.3, commissionAmount: -19.9, paymentMethod: 'CARD' }),
    order('legacy-cash', '2026-10-05T12:00:00Z', { price: 100, paymentMethod: undefined, commissionAmount: undefined }),
    order('reversal', '2026-10-05T13:00:00Z', { price: 0, commissionAmount: 5 }),
    ...['CANCELLED', 'IN_PROGRESS', 'NO_DRIVER', 'SEARCHING'].map((status, index) =>
      order(`unpaid-${index}`, '2026-10-05T14:00:00Z', { status, price: 9999, commissionAmount: -999 })),
  ];
  const total = history.historyTotals(orders);
  assert.equal(total.count, 4);
  assert.ok(Math.abs(total.income - 524.4) < 1e-9);
  assert.ok(Math.abs(total.cash - 325.1) < 1e-9);
  assert.equal(total.card, 199.3);
  assert.ok(Math.abs(total.commission - (-37.4)) < 1e-9);
  assert.equal(total.bonus, 0);
  assert.equal(total.distanceMeters, 8000);
  assert.deepEqual(plain(history.historyTotals([])), { income: 0, card: 0, cash: 0, bonus: 0, commission: 0, distanceMeters: 0, count: 0 });
});

test('distance sums completed trips in the selected range and ignores invalid distances', () => {
  const trips = [
    order('previous', '2026-10-04T17:59:59Z', { distanceMeters: 50000 }),
    order('first', '2026-10-04T18:00:00Z', { distanceMeters: 1250 }),
    order('second', '2026-10-05T10:00:00Z', { distanceMeters: 2450 }),
    order('cancelled', '2026-10-05T10:00:00Z', { status: 'CANCELLED', distanceMeters: 9999 }),
    ...[undefined, NaN, Infinity, -100].map((distanceMeters, index) => order(`invalid-${index}`, '2026-10-05T10:00:00Z', { distanceMeters })),
    order('next', '2026-10-05T18:00:00Z', { distanceMeters: 50000 }),
  ];
  const selected = history.ordersInHistoryRange(trips, history.historyRange('today', '2026-10-05'));
  assert.equal(history.historyTotals(selected).distanceMeters, 3700);
  assert.equal(history.historyDistanceLabel(3700, 'ru'), 'Пройдено · 3,7 км');
  assert.equal(history.historyDistanceLabel(3700, 'en'), 'Distance travelled · 3.7 km');
  assert.equal(history.historyDistanceLabel(0, 'ru'), 'Пройдено · 0 км');
});

test('day view shows seven daily bars ending on the selected date with exclusive Bishkek boundaries', () => {
  const range = history.historyChartRange('today', '2026-10-05');
  const buckets = history.historyBuckets([
    order('older', '2026-09-28T17:59:59.999Z', { price: 10000 }),
    order('previous', '2026-10-04T17:59:59.999Z', { price: 15 }),
    order('selected', '2026-10-04T18:00:00Z', { price: 40 }),
    order('cancelled', '2026-10-04T19:00:00Z', { status: 'CANCELLED', price: 500 }),
    order('second', '2026-10-04T21:00:00Z', { price: 15 }),
    order('last', '2026-10-05T17:59:59.999Z', { price: 30 }),
    order('next', '2026-10-05T18:00:00Z', { price: 25 }),
    order('outside', range.to, { price: 10000 }),
  ], 'today', '2026-10-05');
  assert.equal(buckets.length, 7);
  assert.equal(buckets[0].key, '2026-09-29');
  assert.equal(buckets[6].key, '2026-10-05');
  assert.deepEqual(plain(buckets.map(value => value.amount)), [0, 0, 0, 0, 0, 15, 85]);
  assert.deepEqual(plain(range), plain(history.historyRange('week', '2026-10-05')));
  for (let index = 0; index < buckets.length; index++) {
    assert.equal(Date.parse(buckets[index].to) - Date.parse(buckets[index].from), 24 * 3600000);
    if (index) assert.equal(buckets[index - 1].to, buckets[index].from);
  }
  assert.equal(buckets[0].from, range.from);
  assert.equal(buckets.at(-1).to, range.to);
});

test('weekly chart covers exactly the seven selected days without leaking surrounding fares', () => {
  const range = history.historyRange('week', '2026-10-05');
  const orders = Array.from({ length: 7 }, (_, index) => order(`day-${index}`,
    history.historyBoundary(history.shiftHistoryDay('2026-09-29', index)), { price: index + 1 }));
  orders.push(order('before', '2026-09-28T17:59:59.999Z', { price: 999 }), order('after', range.to, { price: 999 }));
  const buckets = history.historyBuckets(orders, 'week', '2026-10-05');
  assert.equal(buckets.length, 7);
  assert.deepEqual(plain(buckets.map(value => value.amount)), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(buckets[0].from, range.from);
  assert.equal(buckets.at(-1).to, range.to);
});

test('monthly chart has a selectable daily bucket for every day including leap February', () => {
  for (const [day, days] of [['2027-02-15', 28], ['2028-02-15', 29], ['2026-04-15', 30], ['2026-12-15', 31]]) {
    const range = history.historyRange('month', day);
    const first = `${day.slice(0, 7)}-01`;
    const orders = Array.from({ length: days }, (_, index) => order(`day-${index}`,
      history.historyBoundary(history.shiftHistoryDay(first, index)), { price: index + 1 }));
    orders.push(order('next-month', range.to, { price: 9999 }));
    const buckets = history.historyBuckets(orders, 'month', day);
    assert.equal(buckets.length, days);
    assert.equal(buckets[0].from, range.from);
    assert.equal(buckets.at(-1).to, range.to);
    assert.equal(buckets.at(-1).lastDay, `${day.slice(0, 7)}-${days}`);
    assert.equal(buckets.reduce((sum, value) => sum + value.amount, 0), days * (days + 1) / 2);
    for (let index = 0; index < buckets.length; index++) {
      assert.ok(Date.parse(buckets[index].to) > Date.parse(buckets[index].from));
      if (index) assert.equal(buckets[index - 1].to, buckets[index].from);
    }
  }
});

test('chart navigation crosses years, clamps month ends and never advances beyond today', () => {
  assert.equal(history.shiftHistoryPeriod('today', '2027-01-02', -1, '2027-01-02'), '2026-12-26');
  assert.equal(history.shiftHistoryPeriod('week', '2026-12-26', 1, '2027-01-02'), '2027-01-02');
  assert.equal(history.shiftHistoryPeriod('week', '2027-01-01', 1, '2027-01-02'), '2027-01-02');
  assert.equal(history.shiftHistoryPeriod('month', '2028-03-31', -1, '2028-04-01'), '2028-02-29');
  assert.equal(history.shiftHistoryPeriod('month', '2027-03-31', -1, '2027-04-01'), '2027-02-28');
  assert.equal(history.shiftHistoryPeriod('month', '2026-12-31', 1, '2027-01-10'), '2027-01-10');
});

test('period labels and Russian order counts reflect selected data rather than reference examples', () => {
  assert.equal(history.historyPeriodLabel('today', '2026-10-05', 'ru'), '5 октября');
  assert.equal(history.historyPeriodLabel('week', '2026-10-05', 'ru'), '29 сентября – 5 октября');
  assert.equal(history.historyPeriodLabel('month', '2026-10-05', 'ru'), 'октябрь 2026 г.');
  assert.deepEqual([0, 1, 2, 4, 5, 11, 21, 22, 111].map(count => history.historyOrderCount(count, 'ru')),
    ['0 заказов', '1 заказ', '2 заказа', '4 заказа', '5 заказов', '11 заказов', '21 заказ', '22 заказа', '111 заказов']);
});

test('date and month labels retain the selected calendar date on a device in Pacific/Kiritimati', () => {
  const script = `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const vm = require('node:vm');
    const ts = require('typescript');
    const output = {};
    const source = fs.readFileSync(${JSON.stringify(path.join(__dirname, '../src/driverHistory.ts'))}, 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports: output, require: () => ({}) });
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'Pacific/Kiritimati');
    assert.equal(output.historyDateLabel('2026-10-31', 'ru'), '31 октября');
    assert.equal(output.historyPeriodLabel('month', '2026-10-31', 'ru'), 'октябрь 2026 г.');
    assert.equal(output.historyPeriodLabel('week', '2026-12-31', 'ru'), '25 декабря – 31 декабря');
    assert.equal(output.historyPeriodLabel('month', '2026-12-31', 'en'), 'December 2026');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, TZ: 'Pacific/Kiritimati' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});

const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class HistoryTestDate extends Date {
  constructor(...values) { super(...(values.length ? values : ['2026-10-20T06:00:00.000Z'])); }
  static now() { return Date.parse('2026-10-20T06:00:00.000Z'); }
}
const driver = { id: 'driver', role: 'DRIVER', language: 'ru' };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const textChildren = node => node.children.map(child => typeof child === 'string' ? child : textChildren(child)).join('');
const screenText = renderer => renderer.root.findAllByType('Text').map(textChildren).join(' ');
const pressable = (renderer, label) => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
const chartColumn = (renderer, label) => renderer.root.findAllByType('Pressable').find(node => node.props.testID?.startsWith('history-bar-') && node.props.accessibilityLabel === label);
const incomeText = renderer => textChildren(renderer.root.findByProps({ testID: 'history-income' }));
const visibleOrders = renderer => renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityLabel?.startsWith('Детали поездки:'));
const rangeOf = url => {
  const params = new URL(url, 'https://taxi.test').searchParams;
  return { period: params.get('period'), from: params.get('from'), to: params.get('to') };
};

function setupScreen(request, platform = 'android', width = 432, dark = false) {
  let isDark = dark;
  const requests = [], errors = [], pickers = [], backs = [];
  const helpers = loadTypeScript('../src/driverHistory.ts', undefined, { Date: HistoryTestDate });
  const resolve = id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return {
      ActivityIndicator: 'ActivityIndicator', View: 'View', Text: 'Text', Pressable: 'Pressable', RefreshControl: 'RefreshControl', ScrollView: 'ScrollView',
      Modal: props => props.visible ? React.createElement('Modal', props, props.children) : null,
      Platform: { OS: platform }, useWindowDimensions: () => ({ width, height: 900 }),
      StyleSheet: { create: styles => styles, hairlineWidth: 0.5, absoluteFillObject: {} },
    };
    if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) };
    if (id === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (id === '@react-native-community/datetimepicker') return {
      __esModule: true, default: 'DateTimePicker', DateTimePickerAndroid: { open: value => pickers.push(value) },
    };
    if (id === 'react-native-svg') return { __esModule: true, default: 'Svg', Path: 'Path', Rect: 'Rect' };
    if (id === './api') return { api: { request: url => { requests.push(url); return request(url); } }, messageOf: error => error.message };
    if (id === './driverHistory') return helpers;
    if (id === './DriverTripHistoryDetail') return loadTypeScript('../src/DriverTripHistoryDetail.tsx', resolve, { Date: HistoryTestDate });
    if (id === './native/HistoryRouteMap') return { HistoryRouteMap: 'HistoryRouteMap' };
    if (id === './design/theme') return { useTheme: () => ({ isDark, palette: isDark ? { background: '#050505', surface: '#111111', ink: '#F4F4F7', muted: '#A3A5B1', line: '#33343D' } : { background: '#F4F8FD', surface: '#FFFFFF', ink: '#191C2B', muted: '#52566B', line: '#E6E6EF' } }) };
    if (id === './ui') return {
      Icon: 'Icon', money: amount => `${Number(amount.toFixed(1))} сом`, shortAddress: value => value, tr: () => value => value,
      km: value => `${value / 1000} км`, mins: value => `${Math.ceil(value / 60)} мин`,
      s: { divider: {}, spread: {}, muted: {}, h3: {}, row: {}, body: {} },
      Route: props => React.createElement('Route', props, React.createElement('Text', null, `${props.order.pickup.address} → ${props.order.dropoff.address}`)),
    };
    throw new Error(`Unmocked driver history dependency: ${id}`);
  };
  const output = loadTypeScript('../src/DriverTripHistory.tsx', resolve, { Date: HistoryTestDate });
  const props = { user: driver, onError: error => errors.push(error), onBack: () => backs.push(true) };
  return { component: output.DriverTripHistory, props, helpers, requests, errors, pickers, backs, setDark: value => { isDark = value; } };
}

const screenOrders = [
  order('today', '2026-10-20T10:00:00Z', { price: 300, commissionAmount: -30, paymentMethod: 'CARD', comment: 'Подъезд 2', rating: 5 }),
  order('yesterday', '2026-10-19T10:00:00Z', { price: 100 }),
  order('early-month', '2026-10-02T10:00:00Z', { price: 200, commissionAmount: -20, paymentMethod: 'CARD' }),
  order('previous-month', '2026-09-15T10:00:00Z', { price: 400, commissionAmount: -40 }),
];

test('driver period buttons and Android calendar update income, payment chips, chart and orders from the same real range', async () => {
  const h = setupScreen(async () => screenOrders);
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  assert.equal(incomeText(renderer), '300 сом');
  assert.match(screenText(renderer), /20 октября · 1 заказ/);
  assert.match(screenText(renderer), /Пройдено · 2 км/);
  assert.doesNotMatch(screenText(renderer), /Картой ·|Бонусы ·/);
  assert.match(screenText(renderer), /Наличными · 0 сом/);
  assert.match(screenText(renderer), /Комиссия сервиса · −30 сом/);
  assert.deepEqual(visibleOrders(renderer).map(node => node.props.accessibilityLabel), ['Детали поездки: Начало today — Конец today']);
  assert.deepEqual(rangeOf(h.requests[0]), { period: 'today', ...plain(h.helpers.historyChartRange('today', '2026-10-20')) });

  await act(async () => pressable(renderer, 'Неделя').props.onPress());
  assert.equal(pressable(renderer, 'Неделя').props.accessibilityState.selected, true);
  assert.equal(pressable(renderer, 'Сегодня').props.accessibilityState.selected, false);
  assert.equal(incomeText(renderer), '400 сом');
  assert.match(screenText(renderer), /14 октября – 20 октября · 2 заказа/);
  assert.match(screenText(renderer), /Пройдено · 4 км/);
  assert.match(screenText(renderer), /Наличными · 100 сом/);
  assert.match(screenText(renderer), /Комиссия сервиса · −40 сом/);
  assert.equal(visibleOrders(renderer).length, 2);
  assert.deepEqual(rangeOf(h.requests.at(-1)), { period: 'week', ...plain(h.helpers.historyRange('week', '2026-10-20')) });

  await act(async () => pressable(renderer, 'Месяц').props.onPress());
  assert.equal(incomeText(renderer), '600 сом');
  assert.match(screenText(renderer), /октябрь 2026 г\. · 3 заказа/);
  assert.match(screenText(renderer), /Пройдено · 6 км/);
  assert.doesNotMatch(screenText(renderer), /Картой ·|Бонусы ·/);
  assert.match(screenText(renderer), /Комиссия сервиса · −60 сом/);
  assert.equal(visibleOrders(renderer).length, 3);
  assert.deepEqual(rangeOf(h.requests.at(-1)), { period: 'month', ...plain(h.helpers.historyRange('month', '2026-10-20')) });

  await act(async () => pressable(renderer, 'Выберите дату').props.onPress());
  assert.equal(h.pickers.length, 1);
  assert.equal(h.pickers[0].mode, 'date');
  await act(async () => h.pickers[0].onChange({ type: 'dismissed' }));
  assert.equal(h.requests.length, 3);
  await act(async () => h.pickers[0].onChange({ type: 'set' }, new Date(2026, 8, 15, 12)));
  assert.equal(incomeText(renderer), '400 сом');
  assert.match(screenText(renderer), /сентябрь 2026 г\. · 1 заказ/);
  assert.equal(visibleOrders(renderer)[0].props.accessibilityLabel, 'Детали поездки: Начало previous-month — Конец previous-month');
  assert.deepEqual(rangeOf(h.requests.at(-1)), { period: 'month', ...plain(h.helpers.historyRange('month', '2026-09-15')) });
  await act(async () => pressable(renderer, 'Назад').props.onPress());
  assert.equal(h.backs.length, 1);
  assert.deepEqual(h.errors, []);
  await act(async () => renderer.unmount());
});

test('older history API falls back to its supported query, filters selected periods, and reads signed fees from the ledger', async () => {
  const fixtures = screenOrders.map(value => ({ ...value, commissionAmount: undefined }));
  const h = setupScreen(async url => {
    if (url.includes('&from=')) throw Object.assign(new Error('property from should not exist\nproperty to should not exist'), { status: 400 });
    if (url === '/driver/balance') return { operations: [
      { orderId: 'today', kind: 'COMMISSION', amount: -30 },
      { orderId: 'yesterday', kind: 'COMMISSION', amount: -10 },
      { orderId: 'early-month', kind: 'COMMISSION', amount: -20 },
      { orderId: 'today', kind: 'TOPUP', amount: 9999 },
    ] };
    assert.equal(url, '/orders/history?period=all');
    return fixtures;
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  assert.equal(incomeText(renderer), '300 сом');
  assert.match(screenText(renderer), /Комиссия сервиса · −30 сом/);
  assert.equal(visibleOrders(renderer).length, 1);
  await act(async () => pressable(renderer, 'Месяц').props.onPress());
  assert.equal(incomeText(renderer), '600 сом');
  assert.match(screenText(renderer), /Комиссия сервиса · −60 сом/);
  assert.equal(h.requests.filter(url => url.includes('&from=')).length, 1, 'remember the legacy contract for subsequent selections');
  assert.deepEqual(h.errors, []);
  await act(async () => renderer.unmount());
});

test('unsupported history pagination is visible and unavailable ledger fees are not invented as zero', async () => {
  const h = setupScreen(async url => {
    if (url.includes('&from=')) throw Object.assign(new Error('property from should not exist'), { status: 400 });
    if (url === '/driver/balance') return { operations: [] };
    return Array.from({ length: 100 }, (_, i) => order(`recent-${i}`, '2026-10-20T06:00:00Z', { price: 1, commissionAmount: undefined }));
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  assert.match(screenText(renderer), /последние 100 поездок/);
  assert.match(screenText(renderer), /Комиссия сервиса · —/);
  assert.deepEqual(h.errors, []);
  await act(async () => renderer.unmount());
});

test('authentication and unrelated validation errors never trigger legacy history retries', async () => {
  for (const status of [401, 403, 500, 400]) {
    const h = setupScreen(async () => { throw Object.assign(new Error('Other API failure'), { status }); });
    let renderer;
    await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.errors, ['Other API failure']);
    await act(async () => renderer.unmount());
  }
});

test('an old driver history response cannot overwrite a newly selected period', async () => {
  const old = deferred(), latest = deferred();
  let count = 0;
  const h = setupScreen(() => ++count === 1 ? old.promise : latest.promise);
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  await act(async () => pressable(renderer, 'Неделя').props.onPress());
  await act(async () => latest.resolve([screenOrders[0], screenOrders[1]]));
  assert.equal(incomeText(renderer), '400 сом');
  await act(async () => old.resolve([order('stale', '2026-10-20T09:00:00Z', { price: 9999 })]));
  assert.equal(incomeText(renderer), '400 сом');
  assert.equal(visibleOrders(renderer).length, 2);
  assert.doesNotMatch(screenText(renderer), /stale|9999/);
  assert.deepEqual(h.errors, []);
  await act(async () => renderer.unmount());
});

test('tapping a daily bar selects it in blue and filters income, distance, fees and trips to that day', async () => {
  const fixtures = [order('morning', '2026-10-20T03:00:00Z', { price: 300 }), order('noon', '2026-10-20T06:00:00Z', { price: 100 }), screenOrders[1]];
  const h = setupScreen(async () => fixtures);
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  const selected = chartColumn(renderer, '20 октября: 400 сом');
  const previous = chartColumn(renderer, '19 октября: 100 сом');
  const bar = column => column.findAllByType('View').find(node => typeof node.props.style?.height === 'number' && node.props.style?.backgroundColor);
  assert.equal(selected.props.accessibilityState.selected, true);
  assert.equal(previous.props.accessibilityState.selected, false);
  assert.ok(Math.abs(bar(selected).props.style.height / bar(previous).props.style.height - 4) < 1e-9);
  assert.notEqual(bar(selected).props.style.backgroundColor, bar(previous).props.style.backgroundColor);
  await act(async () => previous.props.onPress());
  assert.equal(incomeText(renderer), '100 сом');
  assert.match(screenText(renderer), /19 октября · 1 заказ/);
  assert.match(screenText(renderer), /Пройдено · 2 км/);
  assert.match(screenText(renderer), /Комиссия сервиса · −10 сом/);
  assert.equal(chartColumn(renderer, '19 октября: 100 сом').props.accessibilityState.selected, true);
  assert.equal(chartColumn(renderer, '20 октября: 400 сом').props.accessibilityState.selected, false);
  assert.equal(visibleOrders(renderer).length, 1);
  assert.match(visibleOrders(renderer)[0].props.accessibilityLabel, /yesterday/);
  assert.equal(h.requests.length, 1);
  await act(async () => renderer.unmount());
});

test('week and month can inspect one day and return to the full period; future days are disabled', async () => {
  const fixtures = screenOrders.map(value => ({ ...value, price: value.id === 'yesterday' ? 1000 : value.id === 'early-month' ? 2000 : value.price }));
  const h = setupScreen(async () => fixtures);
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  await act(async () => pressable(renderer, 'Неделя').props.onPress());
  assert.equal(chartColumn(renderer, '20 октября: 300 сом').props.accessibilityState.selected, false);
  assert.equal(chartColumn(renderer, '19 октября: 1000 сом').props.accessibilityState.selected, false);
  await act(async () => chartColumn(renderer, '19 октября: 1000 сом').props.onPress());
  assert.equal(incomeText(renderer), '1000 сом');
  assert.equal(chartColumn(renderer, '19 октября: 1000 сом').props.accessibilityState.selected, true);
  await act(async () => pressable(renderer, 'Весь период').props.onPress());
  assert.equal(incomeText(renderer), '1300 сом');
  await act(async () => pressable(renderer, 'Месяц').props.onPress());
  const futureBucket = chartColumn(renderer, '24 октября: 0 сом');
  assert.equal(futureBucket.props.disabled, true);
  assert.equal(chartColumn(renderer, '20 октября: 300 сом').props.accessibilityState.selected, false);
  await act(async () => chartColumn(renderer, '2 октября: 2000 сом').props.onPress());
  assert.equal(incomeText(renderer), '2000 сом');
  assert.equal(chartColumn(renderer, '2 октября: 2000 сом').props.accessibilityState.selected, true);
  assert.equal(visibleOrders(renderer).length, 1);
  await act(async () => pressable(renderer, 'Весь период').props.onPress());
  assert.equal(h.requests.length, 3);
  assert.match(screenText(renderer), /октябрь 2026 г\. · 3 заказа/);
  await act(async () => renderer.unmount());
});

test('tapping left-side days reveals earlier neighbours; arrows fetch earlier and later date ranges', async () => {
  const h = setupScreen(async url => {
    const range = rangeOf(url);
    const start = h.helpers.historyDay(range.from), end = h.helpers.historyDay(range.to);
    const fixtures = [];
    for (let day = start; day < end; day = h.helpers.shiftHistoryDay(day, 1)) {
      fixtures.push(order(day, h.helpers.historyBoundary(day), { price: Number(day.slice(8)) }));
    }
    return fixtures;
  });
  let r;
  await act(async () => { r = create(React.createElement(h.component, h.props)); });
  assert.equal(pressable(r, 'Следующие дни').props.disabled, true);
  await act(async () => chartColumn(r, '14 октября: 14 сом').props.onPress());
  assert.equal(incomeText(r), '14 сом');
  assert.equal(chartColumn(r, '14 октября: 14 сом').props.accessibilityState.selected, true);
  assert.ok(chartColumn(r, '11 октября: 11 сом'), 'earlier days are now visible to the left of the selected day');
  assert.ok(chartColumn(r, '17 октября: 17 сом'));
  assert.deepEqual(rangeOf(h.requests.at(-1)), { period: 'today', ...plain(h.helpers.historyChartRange('today', '2026-10-17')) });
  await act(async () => chartColumn(r, '17 октября: 17 сом').props.onPress());
  assert.equal(incomeText(r), '17 сом');
  assert.ok(chartColumn(r, '20 октября: 20 сом'), 'later days appear when a right-side day is tapped');
  await act(async () => pressable(r, 'Предыдущие дни').props.onPress());
  assert.equal(incomeText(r), '13 сом');
  assert.equal(chartColumn(r, '13 октября: 13 сом').props.accessibilityState.selected, true);
  assert.equal(pressable(r, 'Следующие дни').props.disabled, false);
  await act(async () => pressable(r, 'Следующие дни').props.onPress());
  assert.equal(incomeText(r), '20 сом');
  assert.equal(pressable(r, 'Следующие дни').props.disabled, true);
  await act(async () => pressable(r, 'Месяц').props.onPress());
  await act(async () => pressable(r, 'Предыдущие дни').props.onPress());
  assert.match(screenText(r), /сентябрь 2026 г/);
  assert.deepEqual(rangeOf(h.requests.at(-1)), { period: 'month', ...plain(h.helpers.historyRange('month', '2026-09-20')) });
  await act(async () => pressable(r, 'Следующие дни').props.onPress());
  assert.match(screenText(r), /октябрь 2026 г/);
  await act(async () => r.unmount());
});

test('quick chart navigation ignores stale responses and details preserve the selected historical day on Android back', async () => {
  const initial = deferred(), previous = deferred();
  const h = setupScreen(url => rangeOf(url).to === h.helpers.historyBoundary('2026-10-21') ? initial.promise : previous.promise);
  let r;
  await act(async () => { r = create(React.createElement(h.component, h.props)); });
  await act(async () => pressable(r, 'Предыдущие дни').props.onPress());
  await act(async () => previous.resolve([order('past', '2026-10-13T06:00:00Z', { price: 135, passenger: { name: 'Асан', phone: '+996555123456' }, tariff: { name: 'Комфорт' }, completedAt: '2026-10-13T06:25:00Z', actualDurationSeconds: 1500, rating: 4, driverRating: 5, waiting: { billedMinutes: 2, charge: 20 } })]));
  assert.equal(incomeText(r), '135 сом');
  await act(async () => initial.resolve(screenOrders));
  assert.equal(incomeText(r), '135 сом');
  assert.equal(chartColumn(r, '13 октября: 135 сом').props.accessibilityState.selected, true);
  const calls = h.requests.length;
  await act(async () => visibleOrders(r)[0].props.onPress());
  const detail = r.root.findByProps({ testID: 'driver-history-detail' });
  const text = detail.findAllByType('Text').map(textChildren).join(' ');
  assert.match(text, /Номер заказа past/);
  assert.match(text, /Время заказа 13 октября 2026 г\..*12:00/);
  assert.match(text, /Время завершения 13 октября 2026 г\..*12:25/);
  assert.match(text, /Время в пути 25 мин/);
  assert.match(text, /Асан.*\+996555123456/);
  assert.match(text, /Тариф Комфорт/);
  assert.match(text, /Ожидание 2 мин.*Платное ожидание 20 сом/);
  assert.match(text, /Оценка пассажира 4 \/ 5.*Ваша оценка 5 \/ 5/);
  await act(async () => r.root.findByType('Modal').props.onRequestClose());
  assert.equal(r.root.findAllByProps({ testID: 'driver-history-detail' }).length, 0);
  assert.equal(incomeText(r), '135 сом');
  assert.equal(h.requests.length, calls);
  assert.equal(h.backs.length, 0);
  await act(async () => r.unmount());
});

test('cancelled and unassigned trips open details showing no payment and ongoing trips do not claim income', async () => {
  const fixtures = [screenOrders[0],
    order('cancelled', '2026-10-20T11:00:00Z', { status: 'CANCELLED', price: 900 }),
    order('no-driver', '2026-10-20T12:00:00Z', { status: 'NO_DRIVER', price: 900 }),
    order('ongoing', '2026-10-20T13:00:00Z', { status: 'IN_PROGRESS', price: 900 }),
  ];
  const h = setupScreen(async () => fixtures);
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  assert.equal(incomeText(renderer), '300 сом');
  assert.match(screenText(renderer), /20 октября · 1 заказ/);
  const rowFor = id => visibleOrders(renderer).find(row => row.props.accessibilityLabel.includes(`Начало ${id} —`));
  const labelsIn = node => node.findAllByType('Text').map(textChildren).join(' ');
  for (const [id, status] of [['cancelled', 'Отменён'], ['no-driver', 'Нет водителя']]) {
    const row = rowFor(id);
    assert.match(labelsIn(row), /0 сом/);
    assert.ok(labelsIn(row).includes(status));
    assert.doesNotMatch(labelsIn(row), /900 сом/);
    await act(async () => row.props.onPress());
    const detail = renderer.root.findByProps({ testID: 'driver-history-detail' });
    assert.match(labelsIn(detail), /Предварительная стоимость.*900 сом.*Оплата не проводилась.*Итого.*0 сом/);
    assert.equal(renderer.root.findByType('Route').props.fullAddresses, true);
    await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  }
  assert.match(labelsIn(rowFor('ongoing')), /—.*В пути/);
  assert.doesNotMatch(labelsIn(rowFor('ongoing')), /900 сом/);
  await act(async () => rowFor('today').props.onPress());
  assert.match(labelsIn(renderer.root.findByProps({ testID: 'driver-history-detail' })), /Картой.*Комиссия сервиса.*−30 сом.*Итого.*300 сом/);
  await act(async () => renderer.unmount());
});

test('compact driver rows open a full screen detail with route and back preserves history selection', async () => {
  const h = setupScreen(async () => screenOrders, 'android', 320);
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  const scroll = renderer.root.findAllByType('ScrollView').find(node => !node.props.horizontal);
  assert.notEqual(scroll.props.scrollEnabled, false);
  assert.ok(scroll.props.contentContainerStyle.paddingBottom > 34);
  const surface = scroll.props.style.backgroundColor;
  assert.ok([1, 3, 5].every(start => parseInt(surface.slice(start, start + 2), 16) >= 240), 'history retains a light surface');
  assert.equal(renderer.root.findByType('StatusBar').props.style, 'dark');
  assert.ok(!scroll.findAllByType('Pressable').some(node => node.props.accessibilityLabel === 'Назад'));
  assert.equal(renderer.root.findAllByType('Route').length, 0);
  await act(async () => visibleOrders(renderer)[0].props.onPress());
  assert.equal(renderer.root.findByType('Modal').props.presentationStyle, 'fullScreen');
  assert.equal(renderer.root.findByType('Route').props.order.id, 'today');
  assert.equal(renderer.root.findByType('Route').props.fullAddresses, true);
  assert.match(screenText(renderer), /Начало today → Конец today/);
  assert.match(screenText(renderer), /Подъезд 2/);
  const detail = renderer.root.findByProps({ testID: 'driver-history-detail' });
  const detailScroll = renderer.root.findByProps({ testID: 'driver-history-detail-scroll' });
  assert.ok(detailScroll.props.contentContainerStyle[1].paddingBottom > 34);
  await act(async () => renderer.root.findByType('HistoryRouteMap').props.onInteractionChange(true));
  assert.equal(detailScroll.props.scrollEnabled, false);
  await act(async () => renderer.root.findByType('HistoryRouteMap').props.onInteractionChange(false));
  assert.equal(detailScroll.props.scrollEnabled, true);
  await act(async () => detail.findByType('Pressable').props.onPress());
  assert.equal(renderer.root.findAllByType('Route').length, 0);
  assert.equal(chartColumn(renderer, '20 октября: 300 сом').props.accessibilityState.selected, true);
  assert.equal(incomeText(renderer), '300 сом');
  assert.equal(h.requests.length, 1);
  assert.equal(h.backs.length, 0);
  await act(async () => renderer.unmount());
});

test('iOS calendar applies only the confirmed date and keeps the current selected period', async () => {
  const h = setupScreen(async () => screenOrders, 'ios');
  let renderer;
  await act(async () => { renderer = create(React.createElement(h.component, h.props)); });
  await act(async () => pressable(renderer, 'Выберите дату').props.onPress());
  assert.equal(renderer.root.findByType('Modal').props.visible, true);
  assert.equal(renderer.root.findByType('DateTimePicker').props.themeVariant, 'light');
  await act(async () => renderer.root.findByType('DateTimePicker').props.onChange({}, new Date(2026, 8, 15, 12)));
  assert.equal(h.requests.length, 1);
  const done = renderer.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => textChildren(text) === 'Готово'));
  await act(async () => done.props.onPress());
  assert.equal(renderer.root.findAllByType('Modal').length, 0);
  assert.equal(pressable(renderer, 'Сегодня').props.accessibilityState.selected, true);
  assert.equal(incomeText(renderer), '400 сом');
  assert.match(screenText(renderer), /15 сентября · 1 заказ/);
  assert.deepEqual(rangeOf(h.requests.at(-1)), { period: 'today', ...plain(h.helpers.historyChartRange('today', '2026-09-15')) });
  await act(async () => renderer.unmount());
});

test('history follows dark theme including rows, icons, info and calendar, without refetching on theme changes', async () => {
  const h = setupScreen(async () => screenOrders, 'ios', 320, true);
  let r;
  await act(async () => { r = create(React.createElement(h.component, h.props)); });
  assert.equal(r.root.findByType('StatusBar').props.style, 'light');
  assert.equal(r.root.findAllByType('ScrollView').find(node => !node.props.horizontal).props.style.backgroundColor, '#111111');
  const colorsOf = node => node.findAllByType('Text').map(text => Object.assign({}, ...[text.props.style].flat().filter(Boolean)).color);
  assert.ok(colorsOf(visibleOrders(r)[0]).includes('#F4F4F7'));
  assert.ok(colorsOf(visibleOrders(r)[0]).includes('#A3A5B1'));
  assert.equal(r.root.findByType('Rect').props.stroke, '#F4F4F7');
  await act(async () => pressable(r, 'Информация о доходе').props.onPress());
  const info = r.root.findByType('Modal');
  assert.ok(info.findAllByType('View').some(node => Object.assign({}, ...[node.props.style].flat().filter(Boolean)).backgroundColor === '#24242B'));
  await act(async () => pressable(r, 'Закрыть').props.onPress());
  await act(async () => pressable(r, 'Выберите дату').props.onPress());
  assert.equal(r.root.findByType('DateTimePicker').props.themeVariant, 'dark');
  await act(async () => pressable(r, 'Закрыть').props.onPress());
  h.setDark(false);
  await act(async () => r.update(React.createElement(h.component, h.props)));
  assert.equal(r.root.findByType('StatusBar').props.style, 'dark');
  assert.equal(r.root.findAllByType('ScrollView').find(node => !node.props.horizontal).props.style.backgroundColor, '#FDFDFF');
  assert.equal(h.requests.length, 1);
  assert.equal(incomeText(r), '300 сом');
  await act(async () => r.unmount());
});

test('selected day stays selected even when empty; tapping an empty day shows zero and no trips', async () => {
  for (const fixtures of [[], [order('first', '2026-10-20T00:00:00Z'), order('second', '2026-10-20T06:00:00Z')]]) {
    const h = setupScreen(async () => fixtures);
    let r;
    await act(async () => { r = create(React.createElement(h.component, h.props)); });
    const selected = r.root.findAllByType('Pressable').filter(node => node.props.testID?.startsWith('history-bar-') && node.props.accessibilityState.selected);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].props.accessibilityLabel, `20 октября: ${fixtures.length ? 200 : 0} сом`);
    await act(async () => chartColumn(r, '19 октября: 0 сом').props.onPress());
    assert.equal(incomeText(r), '0 сом');
    assert.match(screenText(r), /19 октября · 0 заказов/);
    assert.match(screenText(r), /Поездок пока нет/);
    assert.equal(visibleOrders(r).length, 0);
    await act(async () => r.unmount());
  }
});
