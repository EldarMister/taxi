const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const addressExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/address.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: addressExports });
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(compile(file), {
    exports,
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id in dependencies) return dependencies[id];
      throw new Error(`Unexpected dependency ${id} in ${file}`);
    },
  }, { filename: file });
  return exports;
}

const { cartSummary } = load('cart.ts');
const native = {
  ScrollView: 'ScrollView', Text: 'Text', View: 'View',
  StyleSheet: { create: value => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ height: 800, width: 390 }),
};
const { DeliveryInfoSheet } = load('DeliveryInfoSheet.tsx', {
  'react-native': native,
  '@expo/vector-icons': { MaterialCommunityIcons: 'MaterialCommunityIcons' },
  '../BottomPanel': { BottomPanel: ({ children, ...props }) => React.createElement('BottomPanel', props, children) },
  '../design/theme': { useTheme: () => ({ palette: {
    surface: '#fff', elevated: '#f3f7ff', line: '#ddd', ink: '#111', muted: '#777', accent: '#087fff',
  } }) },
  '../design/typography': { fonts: { regular: 'regular', medium: 'medium', semibold: 'semibold', bold: 'bold' } },
  './components': {
    FoodButton: props => React.createElement('FoodButton', props),
    money: amount => `${amount} сом`,
  },
  './cart': { cartSummary },
  './i18n': { useFoodT: () => value => value },
  './NumberTicker': { NumberTicker: props => React.createElement('NumberTicker', props) },
  '../address': addressExports,
});

const dish = { id: 'set', name: 'Сет', price: 600, available: true, optionIds: [] };
const restaurant = {
  id: 'sushi', name: 'Суши', dishes: [dish], options: [],
  deliveryFee: 99, freeDeliveryThreshold: 2467, minimumOrder: 900,
  etaMin: 40, etaMax: 55,
};
const lines = quantity => [{ dishId: dish.id, optionIds: [], quantity }];
const allText = renderer => renderer.root.findAllByType('Text').map(node => {
  const read = value => Array.isArray(value) ? value.map(read).join('') : typeof value === 'string' ? value : '';
  return read(node.props.children);
}).join(' | ');
const tickers = renderer => renderer.root.findAllByType('NumberTicker').map(node => node.props.value);

test('delivery details use customer address and live cart price tiers', async () => {
  let renderer;
  const onClose = () => {};
  await act(async () => { renderer = create(React.createElement(DeliveryInfoSheet, {
    restaurant, lines: lines(4), deliveryAddress: '10, улица Ленина, Шамалды-Сай, Ноокенский район, Джалал-Абадская область, Киргизия', onClose,
  })); });

  let text = allText(renderer);
  assert.match(text, /улица Ленина, 10, Шамалды-Сай/);
  assert.doesNotMatch(text, /Ноокенский район|Джалал-Абадская область|Киргизия/);
  assert.match(text, /~40–55 мин/);
  assert.match(text, /Минимальный заказ/);
  assert.match(text, /900 сом/);
  assert.match(text, /При заказе до 2467 сом/);
  assert.match(text, /При заказе от 2467 сом/);
  assert.match(text, /99 сом/);
  assert.match(text, /0 сом/);
  assert.deepEqual(tickers(renderer), [99, 67], 'fee and remaining amount use the current subtotal');
  assert.doesNotMatch(text, /Максимальный заказ|Ежедневно|Круглосуточно/);
  await act(async () => renderer.root.findByType('FoodButton').props.onPress());
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true,
    'the confirmation button lets the sheet play its closing animation');

  await act(async () => { renderer.update(React.createElement(DeliveryInfoSheet, {
    restaurant, lines: lines(5), deliveryAddress: 'Бишкек, улица Зияша Бектенова, 41', onClose,
  })); });
  text = allText(renderer);
  assert.match(text, /Доставка бесплатно/);
  assert.doesNotMatch(text, /До бесплатной доставки/);
  assert.deepEqual(tickers(renderer), []);
  await act(async () => { renderer.unmount(); });
});

test('free flat delivery and no minimum have no fictitious threshold', async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(DeliveryInfoSheet, {
    restaurant: { ...restaurant, deliveryFee: 0, freeDeliveryThreshold: 0, minimumOrder: 0 },
    lines: lines(1), deliveryAddress: '', onClose: () => {},
  })); });
  const text = allText(renderer);
  assert.match(text, /Доставка бесплатно/);
  assert.match(text, /Без минимальной суммы заказа/);
  assert.match(text, /Укажите адрес при оформлении/);
  assert.doesNotMatch(text, /При заказе до|При заказе от|До бесплатной доставки/);
  await act(async () => { renderer.unmount(); });
});

test('paid flat delivery shows one fee when no free threshold exists', async () => {
  let renderer;
  await act(async () => { renderer = create(React.createElement(DeliveryInfoSheet, {
    restaurant: { ...restaurant, deliveryFee: 120, freeDeliveryThreshold: undefined },
    lines: lines(1), deliveryAddress: 'Кочкор-Ата', onClose: () => {},
  })); });
  const text = allText(renderer);
  assert.deepEqual(tickers(renderer), [120]);
  assert.match(text, /120 сом/);
  assert.doesNotMatch(text, /При заказе до|При заказе от/);
  await act(async () => { renderer.unmount(); });
});
