const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let reduceMotion = false;
let hardwareBack;
let pendingClose = [];
let keyboardListeners = {};
let hostFrame = { y: 0, height: 914 };

class AnimatedValue {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
  stopAnimation(callback) { callback?.(this.value); }
  interpolate(config) { return { value: this, config }; }
}

function animation(value, config, deferClose = false) {
  let callback;
  let stopped = false;
  return {
    start(next) {
      callback = next;
      const finish = () => {
        if (stopped) return;
        value.setValue(config.toValue);
        callback?.({ finished: true });
      };
      if (deferClose && config.toValue === 0) pendingClose.push(finish);
      else finish();
    },
    stop() {
      if (stopped) return;
      stopped = true;
      callback?.({ finished: false });
    },
  };
}

const native = {
  View: 'View',
  Pressable: 'Pressable',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Animated: {
    View: 'AnimatedView',
    Value: AnimatedValue,
    timing: (value, config) => animation(value, config, true),
    spring: (value, config) => animation(value, config),
  },
  BackHandler: {
    addEventListener(_event, listener) {
      hardwareBack = listener;
      return { remove() { if (hardwareBack === listener) hardwareBack = undefined; } };
    },
  },
  Keyboard: {
    addListener(event, listener) {
      keyboardListeners[event] = listener;
      return { remove() { if (keyboardListeners[event] === listener) delete keyboardListeners[event]; } };
    },
  },
  Easing: { cubic: value => value, in: easing => easing, out: easing => easing },
  PanResponder: { create: handlers => ({ panHandlers: handlers }) },
  Platform: { OS: 'android' },
  StyleSheet: { create: styles => styles, absoluteFill: {}, absoluteFillObject: {} },
  useWindowDimensions: () => ({ width: 412, height: 914 }),
};

function loadBottomPanel() {
  const file = path.resolve(__dirname, '../src/BottomPanel.tsx');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require(id) {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 20 }) };
      if (id === './design/motion') return { useMotionPreference: () => reduceMotion };
      if (id === './design/tokens') return { motion: { quick: 150, sheet: 320 } };
      if (id === './design/theme') return { useTheme: () => ({ isDark: false, palette: {} }) };
      throw new Error(`Unexpected import: ${id}`);
    },
  });
  return exports.BottomPanel;
}

const BottomPanel = loadBottomPanel();

async function mount(onClose) {
  let renderer;
  await act(async () => { renderer = create(React.createElement(BottomPanel, { onClose, label: 'Закрыть' }, React.createElement('Child')), {
    createNodeMock: () => ({ measureInWindow: callback => callback(0, hostFrame.y, 412, hostFrame.height) }),
  }); });
  const panel = renderer.root.findAllByType('AnimatedView').find(node => node.props.accessibilityViewIsModal);
  await act(async () => panel.props.onLayout({ nativeEvent: { layout: { height: 300 } } }));
  return renderer;
}

async function finishExit() {
  const finish = pendingClose.shift();
  assert.ok(finish, 'exit animation was scheduled');
  await act(async () => finish());
}

test.beforeEach(() => {
  reduceMotion = false;
  hardwareBack = undefined;
  pendingClose = [];
  keyboardListeners = {};
  hostFrame = { y: 0, height: 914 };
});

test('Android entrance sheet clears the keyboard and does not lift twice after resize', async t => {
  const renderer = await mount(() => {});
  t.after(async () => act(async () => renderer.unmount()));
  const dock = () => renderer.root.findAllByType('View').find(node => node.props.pointerEvents === 'box-none');
  assert.equal(dock().props.style[1].paddingBottom, 0);
  await act(async () => keyboardListeners.keyboardDidShow({ endCoordinates: { screenY: 590 } }));
  assert.equal(dock().props.style[1].paddingBottom, 332);

  hostFrame = { y: 0, height: 590 };
  await act(async () => renderer.root.findAllByType('View').find(node => node.props.onLayout).props.onLayout());
  assert.equal(dock().props.style[1].paddingBottom, 8);
  await act(async () => keyboardListeners.keyboardDidHide());
  assert.equal(dock().props.style[1].paddingBottom, 0);
});

test('backdrop waits for the exit animation before delivering onClose', async t => {
  let closes = 0;
  const renderer = await mount(() => { closes++; });
  t.after(async () => act(async () => renderer.unmount()));
  const backdrop = renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Закрыть');
  await act(async () => backdrop.props.onPress());
  assert.equal(closes, 0);
  await finishExit();
  assert.equal(closes, 1);
  await act(async () => backdrop.props.onPress());
  assert.equal(closes, 1, 'repeated close gestures are ignored');
});

test('hardware back and a fast downward swipe use the same close path', async t => {
  let closes = 0;
  let renderer = await mount(() => { closes++; });
  await act(async () => hardwareBack());
  assert.equal(closes, 0);
  await finishExit();
  assert.equal(closes, 1);
  await act(async () => renderer.unmount());

  closes = 0;
  renderer = await mount(() => { closes++; });
  t.after(async () => act(async () => renderer.unmount()));
  const handle = renderer.root.findAllByType('View').find(node => typeof node.props.onPanResponderMove === 'function');
  await act(async () => handle.props.onPanResponderGrant());
  await act(async () => handle.props.onPanResponderMove(null, { dy: 18 }));
  await act(async () => handle.props.onPanResponderRelease(null, { dy: 18, vy: .9 }));
  assert.equal(closes, 0);
  await finishExit();
  assert.equal(closes, 1);
});

test('Reduce Motion closes immediately without scheduling an exit animation', async t => {
  reduceMotion = true;
  let closes = 0;
  const renderer = await mount(() => { closes++; });
  t.after(async () => act(async () => renderer.unmount()));
  const handleButton = renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityLabel === 'Закрыть').at(-1);
  await act(async () => handleButton.props.onPress());
  assert.equal(closes, 1);
  assert.equal(pendingClose.length, 0);
});

test('external close request waits for the exit animation and Android avoids duplicate keyboard lift', async t => {
  let closes = 0;
  const onClose = () => { closes++; };
  const renderer = await mount(onClose);
  t.after(async () => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findByType('KeyboardAvoidingView').props.enabled, false);
  await act(async () => renderer.update(React.createElement(BottomPanel, { onClose, label: 'Закрыть', closeRequested: true }, React.createElement('Child'))));
  assert.equal(closes, 0);
  await finishExit();
  assert.equal(closes, 1);
});

test('every BottomPanel caller hides its underlying accessibility tree', () => {
  const sourceRoot = path.resolve(__dirname, '../src');
  const sourceFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(absolute) : entry.name.endsWith('.tsx') ? [absolute] : [];
  });
  const callers = sourceFiles(sourceRoot)
    .filter(file => fs.readFileSync(file, 'utf8').includes('<BottomPanel'))
    .map(file => path.relative(sourceRoot, file).replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(callers, [
    'AddressPicker.tsx',
    'BookingPanel.tsx',
    'ClientTripPanel.tsx',
    'DeliveryPanel.tsx',
    'DriverPanel.tsx',
    'food/CatalogScreens.tsx',
    'food/CheckoutScreens.tsx',
  ]);

  const expectations = [
    ['BookingPanel.tsx', 'accessibilityElementsHidden={surface !== \'summary\'}', "importantForAccessibility={surface === 'summary' ? 'auto' : 'no-hide-descendants'}"],
    ['ClientTripPanel.tsx', 'accessibilityElementsHidden={surface !== \'summary\'}', "importantForAccessibility={surface === 'summary' ? 'auto' : 'no-hide-descendants'}"],
    ['DeliveryPanel.tsx', 'accessibilityElementsHidden={surface !== null}', "importantForAccessibility={surface !== null ? 'no-hide-descendants' : 'auto'}"],
    ['DriverPanel.tsx', 'accessibilityElementsHidden={!!(confirmation || showComment)}', "importantForAccessibility={confirmation || showComment ? 'no-hide-descendants' : 'auto'}"],
    ['food/CatalogScreens.tsx', 'accessibilityElementsHidden={showInfo}', "importantForAccessibility={showInfo ? 'no-hide-descendants' : 'auto'}"],
    ['food/CheckoutScreens.tsx', 'accessibilityElementsHidden={editingAddress}', "importantForAccessibility={editingAddress ? 'no-hide-descendants' : 'auto'}"],
  ];
  for (const [file, hidden, android] of expectations) {
    const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
    assert.ok(source.includes(hidden), `${file} must hide the underlay from VoiceOver`);
    assert.ok(source.includes(android), `${file} must hide the underlay from TalkBack`);
  }

  const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  assert.ok(app.includes('accessibilityElementsHidden={!!addressField}'));
  assert.ok(app.includes("importantForAccessibility={addressField ? 'no-hide-descendants' : 'auto'}"));
  assert.match(app, /<\/View>\s*<Modal[\s\S]*<AddressPicker/, 'the address picker must remain outside the hidden underlay');
});
