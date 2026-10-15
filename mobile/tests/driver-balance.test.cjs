const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const textOf = node => typeof node === 'string' ? node : (node?.children || []).map(textOf).join('');

function harness({ width = 426.5, reduced = false, dark = false } = {}) {
  const listeners = new Set(), opened = [], cache = new Map();
  const state = { opening: async url => { opened.push(url); } };
  const builder = { duration() { return this; }, easing() { return this; } };
  const native = { ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'RefreshControl', 'ScrollView', 'Text', 'View', 'Image', 'Modal'].map(name => [name, name])),
    useWindowDimensions: () => ({ width }),
    AppState: { addEventListener(_event, listener) { listeners.add(listener); return { remove: () => listeners.delete(listener) }; } },
    Linking: { openURL: url => state.opening(url) } };
  const animated = { __esModule: true, default: { View: 'MotionView' },
    useSharedValue(initial) { const ref = React.useRef(); if (!ref.current) { let value = initial; ref.current = { get: () => value, set: next => { value = next; } }; } return ref.current; },
    useAnimatedStyle: fn => ({ evaluate: fn }), withTiming: next => next, cancelAnimation() {},
    Easing: { bezier: () => 'curve' }, FadeIn: builder, FadeOut: builder, LinearTransition: builder };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const source = fs.readFileSync(path.join(__dirname, '../src/', file), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports, URL, require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-reanimated') return animated;
      if (id === 'react-native-svg') return { __esModule: true, default: 'Svg', Path: 'Path', Circle: 'Circle' };
      if (id === 'react-native-gesture-handler') return { GestureHandlerRootView: 'GestureRoot' };
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) };
      if (id === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (id === './design/theme') return { useTheme: () => ({ isDark: dark, palette: { background: '#111111', ink: '#FFFFFF', muted: '#AAAAAA', line: '#333333', accent: '#3478F6', elevated: '#222222' } }) };
      if (id === './design/motion') return { useMotionPreference: () => reduced };
      if (id === './design/typography') return { fonts: { regular: 'Inter_400Regular', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' } };
      if (id === './ui') return { Icon: 'Icon', money: value => value + ' сом', tr: () => value => value };
      if (id === './BalanceTopupSheet') return load('BalanceTopupSheet.tsx');
      if (id === './balanceTopup') return load('balanceTopup.ts');
      if (id === './BottomPanel') return { BottomPanel: 'BottomPanel' };
      if (/\.(png|webp)$/.test(id)) return id;
      throw new Error('Unmocked dependency: ' + id);
    } });
    return exports;
  }
  return { Screen: load('DriverBalanceScreen.tsx').DriverBalanceScreen, Sheet: load('BalanceTopupSheet.tsx').BalanceTopupSheet,
    helper: load('balanceTopup.ts'), state, opened, listeners, emit: state => [...listeners].forEach(fn => fn(state)) };
}
const balance = { deposit: 901, cashIncome: 7652, commissionTotal: 590, currency: 'KGS', operations: Array.from({ length: 100 }, (_, i) => ({ id: String(i), kind: i ? 'COMMISSION' : 'TOPUP', note: '', amount: i ? -5 : 200, balanceAfter: 901 - i * 5, createdAt: '2026-10-05T02:45:32Z' })) };
async function mount(h, extra = {}) {
  let renderer; const props = { balance, loading: false, language: 'ru', onRefresh() {}, onMenu() {}, ...extra };
  await act(async () => { renderer = create(React.createElement(h.Screen, props)); });
  return { renderer, props };
}
const click = async (renderer, id) => act(async () => renderer.root.findByProps({ testID: id }).props.onPress());

test('history starts collapsed and toggles the full real ledger without changing metrics or requesting data', async () => {
  const h = harness(); let refresh = 0, menu = 0;
  const { renderer } = await mount(h, { onRefresh: () => ++refresh, onMenu: () => ++menu });
  assert.match(textOf(renderer.toJSON()), /901 сом.*Доход наличными7652 сом.*Комиссия сервиса590 сом/);
  assert.doesNotMatch(textOf(renderer.toJSON()), /Пополнение через администратора/);
  assert.equal(renderer.root.findAllByProps({ testID: 'balance-history-content' }).length, 0);
  await click(renderer, 'balance-history-toggle');
  assert.equal(renderer.root.findByProps({ testID: 'balance-history-toggle' }).props.accessibilityState.expanded, true);
  assert.equal(renderer.root.findAll(node => node.type === 'View' && node.props.testID?.startsWith('balance-operation-')).length, 100);
  assert.match(textOf(renderer.toJSON()), /\+200 сом/); assert.match(textOf(renderer.toJSON()), /-5 сом/);
  assert.match(textOf(renderer.toJSON()), /Остаток: 901 сом/); assert.match(textOf(renderer.toJSON()), /05.10.2026, 08:45:32/);
  await click(renderer, 'balance-history-toggle');
  assert.equal(renderer.root.findAllByProps({ testID: 'balance-history-content' }).length, 0);
  assert.match(textOf(renderer.toJSON()), /901 сом/); assert.equal(refresh, 0);
  await act(async () => renderer.root.findAllByType('Pressable')[0].props.onPress());
  await act(async () => renderer.root.findByType('ScrollView').props.refreshControl.props.onRefresh());
  assert.equal(menu, 1); assert.equal(refresh, 1);
  await act(async () => renderer.unmount()); assert.equal(h.listeners.size, 0);
});

test('loading, empty history, and failure with retry do not fabricate values', async () => {
  const h = harness(); let refresh = 0;
  const { renderer, props } = await mount(h, { balance: null, loading: true, onRefresh: () => ++refresh });
  assert.equal(renderer.root.findAllByType('ActivityIndicator').length, 1); assert.doesNotMatch(textOf(renderer.toJSON()), /сом/);
  await click(renderer, 'balance-history-toggle');
  assert.equal(renderer.root.findAllByProps({ testID: 'balance-history-loading' }).length, 1);
  await act(async () => renderer.update(React.createElement(h.Screen, { ...props, loading: false, balance: { ...balance, operations: [] } })));
  assert.match(textOf(renderer.toJSON()), /Операций пока нет/);
  await act(async () => renderer.update(React.createElement(h.Screen, { ...props, loading: false, error: 'offline' })));
  assert.match(textOf(renderer.toJSON()), /Не удалось загрузить баланс и операции/);
  const retry = renderer.root.findAllByType('Pressable').find(n => textOf(n.toJSON?.() || { children: n.children }) === 'Обновить');
  assert.ok(retry); await act(async () => retry.props.onPress()); assert.equal(refresh, 1);
  await act(async () => renderer.unmount());
});

test('topup uses the provided logos, banks are disabled, and system back requests the existing panel close animation', async () => {
  const h = harness(); const { renderer } = await mount(h);
  await click(renderer, 'balance-topup-open');
  const panel = renderer.root.findByType('BottomPanel');
  assert.equal(panel.props.handlePlacement, 'outside'); assert.equal(panel.props.closeRequested, false);
  assert.equal(renderer.root.findAllByProps({ accessibilityLabel: 'X' }).length, 0);
  assert.equal(renderer.root.findAllByProps({ testID: 'balance-topup-telegram' }).length, 0);
  assert.doesNotMatch(textOf(renderer.toJSON()), /Telegram/);
  for (const id of ['mbank', 'obank', 'kompanion']) {
    const row = renderer.root.findByProps({ testID: 'balance-topup-' + id });
    assert.equal(row.props.disabled, true); assert.equal(row.props.onPress, undefined); assert.match(textOf({ children: row.children }), /Скоро/);
    assert.equal(row.findAllByType('Icon').length, 0);
  }
  assert.deepEqual(renderer.root.findAllByType('Image').map(n => n.props.source), ['../assets/balance/mbank.png', '../assets/balance/obank.webp', '../assets/balance/kompanon.png']);
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true);
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  assert.equal(renderer.root.findAllByType('Modal').length, 0); await act(async () => renderer.unmount());
});

test('narrow screens and dark/reduced-motion mode preserve full amounts, readable layout, and disabled banking options', async () => {
  const h = harness({ width: 320, reduced: true, dark: true });
  const { renderer } = await mount(h, { balance: { ...balance, deposit: -12345678.95 } });
  const deposit = renderer.root.findByProps({ testID: 'balance-deposit' });
  assert.equal(deposit.props.adjustsFontSizeToFit, true); assert.match(textOf(renderer.toJSON()), /-12345678.95 сом/);
  await click(renderer, 'balance-history-toggle');
  assert.equal(renderer.root.findByProps({ testID: 'balance-history-content' }).props.entering, undefined);
  assert.equal(renderer.root.findByType('StatusBar').props.style, 'light');
  assert.equal(renderer.root.findByProps({ testID: 'driver-balance-scroll' }).props.contentContainerStyle.paddingBottom, 24 * .78);
  await act(async () => renderer.unmount());
});
