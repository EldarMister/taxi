const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class AnimatedValue {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
  interpolate() { return this; }
}
const animate = (value, options) => ({
  start(callback) { value.setValue(options.toValue); callback?.({ finished: true }); }, stop() {},
});
const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable', TextInput: 'TextInput', ScrollView: 'ScrollView',
  KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'Spinner',
  Animated: { View: 'AnimatedView', Image: 'AnimatedImage', Value: AnimatedValue, timing: animate, spring: animate },
  Easing: { in: value => value, out: value => value, cubic: 'cubic' }, Platform: { OS: 'android' },
  StyleSheet: { create: value => value, absoluteFillObject: {} }, useWindowDimensions: () => ({ width: 412, height: 914 }),
};
const palette = { surface: '#FFFFFF', ink: '#101D38', accent: '#087FFF', accentText: '#FFFFFF', backdrop: '#00000080' };
const modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return native;
    if (id === 'react-native-reanimated') return { __esModule: true, default: { View: 'ReanimatedView' } };
    if (id === 'react-native-gesture-handler') return { GestureDetector: 'GestureDetector' };
    if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
    if (id === './design/theme') return { useTheme: () => ({ isDark: false, palette }) };
    if (id === './design/motion') return { useMotionPreference: () => false };
    if (id === './design/tokens') return { motion: { sheet: 320 } };
    if (id === './useSheetStageTransition') return load('useSheetStageTransition.ts');
    // The shared hook's physics have separate tests; here we verify panel ownership and completion callbacks.
    if (id === './useSheetDragToClose') return { useSheetDragToClose: (onClosed, enabled, height) => ({
      gesture: { onClosed, enabled, height }, animatedStyle: { transform: [{ translateY: 0 }] }, reset() {},
    }) };
    if (id === './SuccessCelebration') return { SuccessCelebration: 'SuccessCelebration' };
    if (id === './ui') return {
      Icon: 'Icon', colors: { ink: palette.ink, blue: palette.accent }, localize: (_language, text) => text,
      money: String, km: String, tripTime: String, shortAddress: text => text,
    };
    return {};
  } });
  return exports;
}
const { ClientCompletionPanel } = load('ClientCompletionPanel.tsx');
const { DriverCompletionPanel } = load('DriverCompletionPanel.tsx');
const order = { id: 'completed-trip', status: 'COMPLETED', pickup: { address: 'A' }, dropoff: { address: 'B' },
  price: 100, distanceMeters: 200, durationSeconds: 60 };
const textOf = node => typeof node === 'string' ? node : node.children?.map(textOf).join('') || '';
const propsFor = (role, onDone = () => {}) => ({ order, user: { role, language: 'ru' }, busy: false, onDone,
  onRating: async () => true, onRateClient: async () => true, onHeight() {} });
const componentFor = role => role === 'DRIVER' ? DriverCompletionPanel : ClientCompletionPanel;
const gestureOf = renderer => renderer.root.findByType('GestureDetector').props.gesture;
const tap = async (renderer, label) => {
  const button = renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
  assert.ok(button, label);
  await act(async () => button.props.onPress());
};

test('completion panels drag from the whole heading while their forms keep native scrolling', async t => {
  for (const role of ['CLIENT', 'DRIVER']) {
    let renderer;
    await act(async () => { renderer = create(React.createElement(componentFor(role), propsFor(role))); });
    t.after(async () => act(async () => renderer.unmount()));
    const upper = renderer.root.findByType('GestureDetector');
    assert.equal(upper.findAllByType('SuccessCelebration').length, 1);
    assert.match(textOf(upper), /Заказ успешно.*Спасибо/s);
    assert.equal(upper.findAllByType('ScrollView').length, 0, 'the pull cannot intercept native form scrolling');
    assert.equal(renderer.root.findAllByType('ScrollView').length, 1);
    assert.equal(renderer.root.findAllByType('ReanimatedView').length, 1, 'the dragged frame uses Reanimated independently of the stage wrapper');
    await tap(renderer, role === 'CLIENT' ? 'Оценить поездку' : 'Оценить пассажира');
    const ratingUpper = renderer.root.findByType('GestureDetector');
    assert.match(textOf(ratingUpper), role === 'CLIENT' ? /Оцените поездку/ : /Как всё прошло/);
    assert.equal(ratingUpper.findAllByType('ScrollView').length, 0);
    assert.equal(ratingUpper.findAllByType('TextInput').length, 0, 'comment editing remains in the scrollable form');
  }
});

test('completed drag closes the summary and a rating drag returns to the summary without closing the order', async t => {
  for (const role of ['CLIENT', 'DRIVER']) {
    let renderer;
    const closed = [];
    await act(async () => { renderer = create(React.createElement(componentFor(role), propsFor(role, id => closed.push(id)))); });
    t.after(async () => act(async () => renderer.unmount()));
    await tap(renderer, role === 'CLIENT' ? 'Оценить поездку' : 'Оценить пассажира');
    await act(async () => gestureOf(renderer).onClosed());
    assert.equal(closed.length, 0);
    assert.match(textOf(renderer.root), /Заказ успешно/);
    await act(async () => gestureOf(renderer).onClosed());
    assert.deepEqual(closed, [role === 'DRIVER' ? order.id : undefined]);
  }
});

test('completion drag uses the measured content height and disables the recognizer while busy', async t => {
  for (const role of ['CLIENT', 'DRIVER']) {
    let renderer;
    const props = propsFor(role);
    await act(async () => { renderer = create(React.createElement(componentFor(role), props)); });
    t.after(async () => act(async () => renderer.unmount()));
    const frame = renderer.root.findAllByType('AnimatedView').find(node => node.props.onLayout);
    await act(async () => frame.props.onLayout({ nativeEvent: { layout: { height: 265 } } }));
    assert.equal(gestureOf(renderer).height, 265);
    assert.equal(gestureOf(renderer).enabled, true);
    await act(async () => renderer.update(React.createElement(componentFor(role), { ...props, busy: true })));
    assert.equal(gestureOf(renderer).enabled, false);
    const handle = renderer.root.findByType('GestureDetector').findByType('Pressable');
    assert.equal(handle.props.disabled, true);
  }
});
