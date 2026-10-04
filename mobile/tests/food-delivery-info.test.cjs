const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function load(file, dependencies = {}) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id in dependencies) return dependencies[id];
    if (id === './dishOptions') return load('dishOptions.ts');
      if (id === './promotions') return load('promotions.ts');
    throw new Error(`Unexpected dependency ${id} in ${file}`);
  } });
  return exports;
}

const { cartSummary } = load('cart.ts');
const { DeliveryInfoSheet } = load('DeliveryInfoSheet.tsx', {
  'react-native': { Text: 'Text', View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 } },
  '@expo/vector-icons': { Ionicons: 'Icon' },
  '../BottomPanel': { BottomPanel: ({ children, ...props }) => React.createElement('BottomPanel', props, children) },
  '../design/theme': { useTheme: () => ({ palette: { surface: '#fff', elevated: '#eee', line: '#ddd', ink: '#111', muted: '#777' } }) },
  '../design/typography': { fonts: {} },
  './components': { money: amount => `${amount} сом` },
  './cart': { cartSummary },
  './i18n': { useFoodT: () => value => value },
});
const dish = { id: 'set', name: 'Сет', price: 600, available: true, optionIds: [] };
const restaurant = { id: 'sushi', name: 'Суши', dishes: [dish], options: [], deliveryFee: 99, freeDeliveryThreshold: 2467, minimumOrder: 900 };
const lines = quantity => [{ dishId: dish.id, optionIds: [], quantity }];
const props = { restaurant, deliveryAddress: 'Бишкек', onClose() {} };
const text = renderer => renderer.root.findAllByType('Text').map(node => node.props.children).join(' | ');

test('reference conditions panel shows paid fee then strikes original price when its own basket becomes free', async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(DeliveryInfoSheet, { ...props, lines: lines(4) })); });
  assert.match(text(renderer), /Текущие условия/);
  assert.equal(renderer.root.findByProps({ testID: 'delivery-current-fee' }).props.children, '99 сом');
  assert.equal(renderer.root.findAllByProps({ testID: 'delivery-original-fee' }).length, 0);
  assert.doesNotMatch(text(renderer), /Адрес доставки|Минимальный заказ|Время доставки|Понятно/);
  assert.match(text(renderer), /размера корзины, расстояния до ресторана/);
  await act(async () => renderer.update(React.createElement(DeliveryInfoSheet, { ...props, lines: lines(5) })));
  assert.equal(renderer.root.findByProps({ testID: 'delivery-current-fee' }).props.children, '0 сом');
  const original = renderer.root.findByProps({ testID: 'delivery-original-fee' });
  assert.equal(original.props.children, '99 сом');
  assert.equal(original.props.style[0].textDecorationLine, 'line-through');
  assert.equal(renderer.root.findByType('BottomPanel').props.onClose, props.onClose);
  await act(async () => renderer.unmount());
});

test('flat free delivery never invents a crossed-out original price', async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(DeliveryInfoSheet, { ...props, restaurant: { ...restaurant, deliveryFee: 0, freeDeliveryThreshold: 0 }, lines: lines(1) })); });
  assert.equal(renderer.root.findByProps({ testID: 'delivery-current-fee' }).props.children, '0 сом');
  assert.equal(renderer.root.findAllByProps({ testID: 'delivery-original-fee' }).length, 0);
  await act(async () => renderer.unmount());
});

test('without a basket shows catalog base fee; without restaurant leaves price pending', async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(DeliveryInfoSheet, { ...props, lines: [] })); });
  assert.equal(renderer.root.findByProps({ testID: 'delivery-current-fee' }).props.children, '99 сом');
  await act(async () => renderer.update(React.createElement(DeliveryInfoSheet, { ...props, restaurant: undefined, lines: [] })));
  assert.equal(renderer.root.findAllByProps({ testID: 'delivery-current-fee' }).length, 0);
  assert.match(text(renderer), /Уточняется/);
  await act(async () => renderer.unmount());
});

test('promotion delivery price uses the base subtotal and retains the original delivery fee', async () => {
  const promoted = { ...restaurant, deliveryFee: 99, freeDeliveryThreshold: 0, dishes: [{ ...dish, price: 300, promotionBasePrice: 600 }], promotions: [
    { id: 'half', title: '50%', type: 'PERCENT', value: 50, minSubtotal: 0, dishIds: [], active: true },
    { id: 'free', title: 'Доставка от 1000', type: 'FREE_DELIVERY', value: 0, minSubtotal: 1000, dishIds: [], active: true },
  ] };
  let renderer;
  await act(async () => { renderer = create(React.createElement(DeliveryInfoSheet, { ...props, restaurant: promoted, lines: lines(2) })); });
  assert.equal(renderer.root.findByProps({ testID: 'delivery-current-fee' }).props.children, '0 сом');
  assert.equal(renderer.root.findByProps({ testID: 'delivery-original-fee' }).props.children, '99 сом');
  await act(async () => renderer.unmount());
});
