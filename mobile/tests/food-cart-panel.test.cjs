const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = fs.readFileSync(path.join(__dirname, '../src/food/CheckoutScreens.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

const colors = { ink: '#111318', muted: '#8A9099', blue: '#087FFF', surface: '#F1F1EF', white: '#FFFFFF' };
const dishes = [
  { id: 'plov', name: 'Плов', price: 380, portion: '1 порция', available: true, optionIds: [] },
  { id: 'samsa', name: 'Самса', price: 180, portion: '1 штука', available: true, optionIds: [] },
];
const restaurant = { id: 'halva', name: 'Халва', dishes, options: [], deliveryFee: 0, minimumOrder: 0 };
const cartSummary = (_restaurant, lines) => {
  const items = lines.map(line => {
    const dish = dishes.find(value => value.id === line.dishId);
    return { ...line, dish, options: [], total: dish.price * line.quantity };
  });
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  return { items, subtotal, total: subtotal, deliveryFee: 0, count: lines.reduce((sum, line) => sum + line.quantity, 0), invalid: false };
};

function loadCartScreen() {
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return {
      Image: 'Image', Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' }, Pressable: 'Pressable', ScrollView: 'ScrollView',
      StyleSheet: { create: styles => styles, hairlineWidth: 1 }, Text: 'Text', TextInput: 'TextInput', View: 'View',
      useWindowDimensions: () => ({ height: 850, width: 390 }),
    };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
    if (id === '../ui') return { Icon: 'Icon' };
    if (id === '../BottomPanel') return { BottomPanel: props => React.createElement('BottomPanel', props, props.children) };
    if (id === '../design/motion') return { Reveal: props => props.children, SpringPressable: props => React.createElement('SpringPressable', props, props.children) };
    if (id === '../design/tokens') return { palette: { ...colors, canvas: '#F7F7F5', line: '#E7E7E3', blueSoft: '#E8F2FF' }, radii: { small: 12, medium: 16, large: 22, hero: 28 } };
    if (id === '../design/typography') return { fonts: { regular: 'regular', medium: 'medium', semibold: 'semibold', bold: 'bold' } };
    if (id === './components') return {
      FoodButton: props => React.createElement('FoodButton', props), FoodHeader: () => null,
      FoodIconButton: props => React.createElement('FoodIconButton', props), foodColors: colors,
      money: value => `${value} сом`,
    };
    if (id === './foodTheme') return { useFoodColors: () => colors, useFoodStyles: styles => styles };
    if (id === '../design/theme') return { useTheme: () => ({ isDark: false, palette: { accent: colors.blue, accentText: '#FFFFFF' } }) };
    if (id === './assets') return { foodImage: () => 'dish-image' };
    if (id === './cart') return { cartLineKey: line => `${line.dishId}:${line.optionIds.join(',')}`, cartSummary, MAX_FOOD_QUANTITY: 20 };
    if (id === './NumberTicker') return { NumberTicker: props => React.createElement('NumberTicker', props) };
    if (id === './i18n') return { useFoodT: () => value => value };
    if (id === '../address') return { shortAddress: value => value };
    throw new Error(`Unexpected import ${id}`);
  } }, { filename: 'CheckoutScreens.tsx' });
  return exports.CartScreen;
}

test('cart sheet follows its content, caps tall content, and animates the checkout amount', async () => {
  const CartScreen = loadCartScreen();
  const props = { restaurant, lines: [{ dishId: 'plov', optionIds: [], quantity: 1 }], onBack() {}, onClear() {}, onQuantity() {}, onRemoveOption() {}, onCheckout() {}, onAddRecommendation() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(CartScreen, props)); });
  const sheet = renderer.root.findByType('BottomPanel');
  assert.equal(sheet.props.expanded, undefined);
  const body = () => renderer.root.findAllByType('ScrollView').find(node => !node.props.horizontal);
  assert.equal(body().props.style.height, 433);
  await act(async () => body().props.onContentSizeChange(390, 315));
  assert.equal(body().props.style.height, 315);
  await act(async () => body().props.onContentSizeChange(390, 1000));
  assert.equal(body().props.style.height, 552, 'long carts scroll within the available height');

  const checkout = () => renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel?.includes('К оформлению'));
  assert.equal(checkout().findByType('NumberTicker').props.value, 380);
  await act(async () => renderer.update(React.createElement(CartScreen, { ...props, lines: [{ ...props.lines[0], quantity: 2 }] })));
  assert.equal(checkout().findByType('NumberTicker').props.value, 760);
  const step = renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Увеличить Плов');
  assert.equal(step.props.style.backgroundColor, '#FFFFFF');
  const recommendation = renderer.root.findAllByType('FoodIconButton').find(node => node.props.label === 'Добавить Самса');
  assert.equal(recommendation.props.backgroundColor, '#FFFFFF');
  await act(async () => renderer.unmount());
});
