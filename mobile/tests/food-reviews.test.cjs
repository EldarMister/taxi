const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const colors = { ink: '#111', muted: '#777', blue: '#087FFF', canvas: '#f7f7f5', surface: '#fff', white: '#fff', elevated: '#eee', line: '#ddd' };
const native = Object.fromEntries(['View', 'Text', 'Pressable', 'ScrollView', 'ActivityIndicator'].map(name => [name, name]));
native.StyleSheet = { create: value => value, hairlineWidth: 1 };
const component = name => ({ children, ...props }) => React.createElement(name, props, children);
function load(file) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return native;
    if (id === '@expo/vector-icons' || id === '../ui') return { Ionicons: 'Icon', Icon: 'Icon' };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) };
    if (id === '../BottomPanel') return { BottomPanel: component('BottomPanel') };
    if (id === '../design/theme') return { useTheme: () => ({ palette: colors }) };
    if (id === '../design/tokens') return { palette: colors, radii: {} };
    if (id === '../design/typography') return { fonts: {} };
    if (id === '../design/motion') return { Reveal: component('Reveal') };
    if (id === './components') return { FoodButton: component('FoodButton'), FoodHeader: component('FoodHeader'), foodColors: colors, money: amount => `${amount} сом` };
    if (id === './i18n') return { useFoodT: () => value => value, useFoodLanguage: () => 'ru' };
    if (id === './foodTheme') return { useFoodColors: () => colors, useFoodStyles: value => value };
    if (id === './FoodPhoto') return { FoodPhoto: 'FoodPhoto' };
    if (id === './restaurantReviews') return load('restaurantReviews.ts');
    throw new Error(`Unexpected dependency ${id} in ${file}`);
  } });
  return exports;
}
const { sortRestaurantReviews } = load('restaurantReviews.ts');
const { RestaurantReviewsSheet } = load('RestaurantReviewsSheet.tsx');
const feedback = [
  { id: 'older', authorName: 'Алия', rating: 5, text: 'Спасибо за обед', createdAt: '2026-09-01T10:00:00Z' },
  { id: 'newer', authorName: 'Бек', rating: 2, text: 'Долго ждал', createdAt: '2026-10-02T10:00:00Z' },
  { id: 'blank', authorName: 'Э', rating: 4, text: ' ', createdAt: '2026-10-03' },
];
const ids = rows => Array.from(rows, item => item.id);
const merchant = { id: 'sushi', name: 'Суши', rating: 4.7, reviewCount: 320 };
const allText = renderer => {
  const read = value => Array.isArray(value) ? value.map(read).join('') : value == null ? '' : String(value);
  return renderer.root.findAllByType('Text').map(node => read(node.props.children)).join(' | ');
};

test('sort real reviews without mutating server order and hide empty text feedback', () => {
  assert.deepEqual(ids(sortRestaurantReviews(feedback, 'default')), ['older', 'newer']);
  assert.deepEqual(ids(sortRestaurantReviews(feedback, 'newest')), ['newer', 'older']);
  assert.deepEqual(ids(sortRestaurantReviews(feedback, 'highest')), ['older', 'newer']);
  assert.deepEqual(ids(sortRestaurantReviews(feedback, 'lowest')), ['newer', 'older']);
  assert.deepEqual(ids(feedback), ['older', 'newer', 'blank']);
  assert.deepEqual(ids(sortRestaurantReviews(undefined, 'default')), []);
});

test('reviews panel preserves aggregate rating and shows honest empty state without generated feedback', async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(RestaurantReviewsSheet, { restaurant: merchant, onClose() {} })); });
  const text = allText(renderer);
  assert.match(text, /4.7/); assert.match(text, /320 оценок/);
  assert.ok(renderer.root.findByProps({ testID: 'restaurant-reviews-empty' }));
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star').length, 0);
  assert.match(text, /Отзывов пока нет/);
  await act(async () => renderer.unmount());
});

test('reviews sort picker selects blue checkmark and reorders real customer texts', async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(RestaurantReviewsSheet, { restaurant: { ...merchant, reviews: feedback }, onClose() {} })); });
  await act(async () => renderer.root.findByProps({ testID: 'review-sort-button' }).props.onPress());
  const check = renderer.root.findAllByType('Icon').find(node => node.props.name === 'checkmark');
  assert.equal(check.props.color, '#087FFF');
  const radios = renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'radio');
  await act(async () => radios[1].props.onPress());
  const rows = renderer.root.findAllByType('View').filter(node => /^restaurant-review-/.test(node.props.testID || ''));
  assert.deepEqual(rows.map(node => node.props.testID), ['restaurant-review-newer', 'restaurant-review-older']);
  assert.equal(renderer.root.findAllByProps({ testID: 'review-sort-options' }).length, 0);
  await act(async () => renderer.unmount());
});

test('simultaneous restaurant orders can be switched without losing individual order details', async () => {
  const { FoodOrderScreen } = load('OrderScreens.tsx');
  const order = { id: 'order-a', status: 'PLACED', fulfillment: 'DELIVERY', createdAt: '2026-10-04T10:00:00Z', restaurant: { name: 'Суши', id: 'sushi', etaMin: 20, etaMax: 30 }, items: [], subtotal: 100, deliveryFee: 0, total: 100, address: 'Бишкек', comment: '' };
  const second = { ...order, id: 'order-b', status: 'PREPARING', restaurant: { ...order.restaurant, id: 'burger', name: 'Бургер' }, total: 300 };
  let selected;
  let renderer;
  await act(async () => { renderer = create(React.createElement(FoodOrderScreen, { order, relatedOrders: [order, second], onSelectOrder: value => { selected = value; }, onBack() {}, onRetry() {}, error: '' })); });
  assert.equal(renderer.root.findByProps({ testID: 'food-order-tab-order-a' }).props.accessibilityState.selected, true);
  await act(async () => renderer.root.findByProps({ testID: 'food-order-tab-order-b' }).props.onPress());
  assert.equal(selected, second);
  assert.match(allText(renderer), /100 сом/);
  await act(async () => renderer.update(React.createElement(FoodOrderScreen, { order: second, relatedOrders: [order, second], onSelectOrder: value => { selected = value; }, onBack() {}, onRetry() {}, error: '' })));
  assert.equal(renderer.root.findByProps({ testID: 'food-order-tab-order-b' }).props.accessibilityState.selected, true);
  assert.match(allText(renderer), /300 сом/);
  await act(async () => renderer.unmount());
});
