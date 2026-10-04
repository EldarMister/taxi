const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function load(file, dependencies) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id in dependencies) return dependencies[id];
    throw new Error(`Unexpected dependency ${id}`);
  } });
  return exports;
}

const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
  StyleSheet: { create: value => value, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 393, height: 852 }),
};

test('food switch exposes controlled checked state, rejects disabled input and respects live reduced motion', async () => {
  let reduced = false, lastValue = false;
  const timings = [];
  const { FoodSwitch } = load('FoodSwitch.tsx', {
    'react-native': native,
    'react-native-reanimated': {
      __esModule: true, default: { View: 'AnimatedView' }, cancelAnimation() {},
      Easing: { bezier: (...values) => values },
      useSharedValue: initial => React.useRef({ value: initial, get() { return this.value; }, set(value) { this.value = value; } }).current,
      useAnimatedStyle: evaluate => ({ evaluate }),
      interpolateColor: (value, _input, colors) => colors[value < .5 ? 0 : 1],
      withTiming: (value, options) => { timings.push({ value, options }); return value; },
    },
    '../design/motion': { useMotionPreference: () => reduced },
    '../design/theme': { useTheme: () => ({ isDark: false }) },
  });
  let renderer;
  const props = { value: false, accessibilityLabel: 'Оставить у двери', onValueChange: value => { lastValue = value; } };
  await act(async () => { renderer = create(React.createElement(FoodSwitch, props)); });
  const control = () => renderer.root.findByType('Pressable');
  const trackColor = () => renderer.root.findByProps({ testID: 'food-switch-track' }).props.style.at(-1).evaluate().backgroundColor;
  assert.equal(control().props.accessibilityRole, 'switch');
  assert.equal(control().props.accessibilityState.checked, false);
  assert.equal(trackColor(), '#EEEEEE');
  await act(async () => control().props.onPress());
  assert.equal(lastValue, true);
  assert.equal(control().props.accessibilityState.checked, false, 'only the owner can commit a controlled setting');
  await act(async () => renderer.update(React.createElement(FoodSwitch, { ...props, value: true })));
  assert.equal(control().props.accessibilityState.checked, true);
  assert.equal(trackColor(), '#FFE500');
  assert.equal(timings.at(-1).options.duration, 150);
  await act(async () => renderer.update(React.createElement(FoodSwitch, { ...props, value: true, disabled: true })));
  await act(async () => control().props.onPress());
  assert.equal(lastValue, true, 'a busy checkout must not change its delivery preference');
  assert.equal(control().props.accessibilityState.disabled, true);
  reduced = true;
  const previousAnimations = timings.length;
  await act(async () => renderer.update(React.createElement(FoodSwitch, { ...props, value: false })));
  assert.equal(timings.length, previousAnimations, 'changing the system preference removes thumb motion immediately');
  assert.equal(trackColor(), '#EEEEEE');
  assert.equal(control().props.accessibilityState.checked, false);
  await act(async () => renderer.unmount());
});

test('filter selection uses blue checks, excludes offers and only applies on confirmation', async () => {
  const restaurantDiscovery = load('restaurantDiscovery.ts', {});
  const { emptyRestaurantFilters } = restaurantDiscovery;
  const { FoodFiltersSheet } = load('FoodFiltersSheet.tsx', {
    'react-native': native,
    '@expo/vector-icons': { Ionicons: 'Icon' },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 24, left: 0 }) },
    '../BottomPanel': { BottomPanel: props => React.createElement('BottomPanel', props, props.children) },
    '../design/typography': { fonts: {} },
    '../design/tokens': { palette: { blue: '#087FFF' } },
    '../design/theme': { useTheme: () => ({ isDark: false, palette: {} }) },
    './foodTheme': { useFoodColors: () => ({ ink: '#242424' }), useFoodStyles: styles => styles },
    './CategoryArtwork': { CategoryArtwork: 'CategoryArtwork', filterDishCategories: ['Пицца', 'Суши'], filterCuisines: ['Местная', 'Япония'] },
    './restaurantDiscovery': restaurantDiscovery,
    './i18n': { useFoodT: () => value => value },
  });
  const applied = [], initial = emptyRestaurantFilters();
  let renderer;
  await act(async () => { renderer = create(React.createElement(FoodFiltersSheet, { value: initial, onApply: value => applied.push(value), onClose() {} })); });
  const control = label => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
  const button = label => renderer.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === label));
  assert.equal(control('Акции'), undefined);
  await act(async () => { control('Пицца').props.onPress(); control('С высоким рейтингом').props.onPress(); });
  assert.equal(control('Пицца').props.accessibilityState.checked, true);
  assert.equal(control('С высоким рейтингом').props.accessibilityState.checked, true);
  assert.equal(control('По умолчанию').props.accessibilityState.checked, false);
  assert.equal(applied.length, 0);
  assert.equal(initial.sort, 'default');
  const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style || {};
  assert.equal(flatten(control('Пицца').findByType('Text').props.style).backgroundColor, '#087FFF');
  assert.equal(flatten(control('Пицца').findByType('Text').props.style).color, '#FFFFFF');
  const radio = control('С высоким рейтингом').findAllByType('View').find(node => flatten(node.props.style).width === 24);
  assert.equal(flatten(radio.props.style).backgroundColor, '#087FFF');
  assert.equal(radio.findByType('Icon').props.color, '#FFFFFF');
  await act(async () => control('Быстрые').props.onPress());
  assert.equal(control('С высоким рейтингом').props.accessibilityState.checked, false);
  assert.equal(control('Быстрые').props.accessibilityState.checked, true);
  await act(async () => button('Сбросить').props.onPress());
  assert.equal(control('Пицца').props.accessibilityState.checked, false);
  assert.equal(control('По умолчанию').props.accessibilityState.checked, true);
  await act(async () => { control('Япония').props.onPress(); control('Быстрые').props.onPress(); });
  await act(async () => button('Применить').props.onPress());
  assert.deepEqual(JSON.parse(JSON.stringify(applied[0])), { dishes: [], cuisines: ['Япония'], sort: 'fast' });
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true);
  await act(async () => renderer.unmount());
});
