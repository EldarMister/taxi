const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const textOf = node => typeof node === 'string' ? node : (node.children || []).map(textOf).join('');

function screen() {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/DriverBalanceScreen.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return { ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'RefreshControl', 'ScrollView', 'Text', 'View'].map(name => [name, name])), useWindowDimensions: () => ({ width: 360 }) };
    if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 34, left: 0, right: 0 }) };
    if (id === 'expo-status-bar') return { StatusBar: 'StatusBar' };
    if (id === './design/theme') return { useTheme: () => ({ isDark: false, palette: {} }) };
    if (id === './design/typography') return { fonts: { regular: 'Inter_400Regular', bold: 'Inter_700Bold' } };
    if (id === './ui') return { Icon: 'Icon', money: value => `${value} сом`, tr: () => value => value };
    throw new Error('Unmocked dependency: ' + id);
  } });
  return exports.DriverBalanceScreen;
}

test('deposit, cash and commission retain API values, while the full operation list preserves signs and running balances', async () => {
  const Screen = screen(); let renderer, menu = 0, refresh = 0;
  const operations = Array.from({ length: 100 }, (_, i) => ({ id: String(i), kind: i ? 'COMMISSION' : 'TOPUP', note: '', amount: i ? -5 : 200, balanceAfter: 901 - i * 5, createdAt: '2026-10-05T02:45:32Z' }));
  const balance = { deposit: 901, cashIncome: 7652, commissionTotal: 590, currency: 'KGS', operations };
  await act(async () => { renderer = create(React.createElement(Screen, { balance, loading: false, language: 'ru', onRefresh: () => ++refresh, onMenu: () => ++menu })); });
  const text = textOf(renderer.toJSON());
  assert.match(text, /901 сом/);
  assert.match(text, /Доход наличными7652 сом/);
  assert.match(text, /Комиссия сервиса590 сом/);
  assert.match(text, /\+200 сом/); assert.match(text, /-5 сом/);
  assert.match(text, /Остаток: 901 сом/);
  assert.equal(renderer.root.findAll(node => node.type === 'View' && node.props.testID?.startsWith('balance-operation-')).length, 100);
  assert.equal(renderer.root.findByProps({ testID: 'driver-balance-scroll' }).props.contentContainerStyle.paddingBottom, 34 + 24 * (360 / 426.5));
  await act(async () => renderer.root.findByType('Pressable').props.onPress());
  await act(async () => renderer.root.findByType('ScrollView').props.refreshControl.props.onRefresh());
  assert.equal(menu, 1); assert.equal(refresh, 1);
  await act(async () => renderer.unmount());
});

test('loading does not fabricate financial values and an empty ledger remains readable', async () => {
  const Screen = screen(); let renderer;
  const props = { balance: null, loading: true, language: 'ru', onRefresh() {}, onMenu() {} };
  await act(async () => { renderer = create(React.createElement(Screen, props)); });
  assert.equal(renderer.root.findAllByType('ActivityIndicator').length, 1);
  assert.doesNotMatch(textOf(renderer.toJSON()), /сом/);
  await act(async () => renderer.update(React.createElement(Screen, { ...props, loading: false, balance: { deposit: 0, cashIncome: 0, commissionTotal: 0, currency: 'KGS', operations: [] } })));
  assert.match(textOf(renderer.toJSON()), /Операций пока нет/);
  assert.equal(renderer.root.findAllByType('ActivityIndicator').length, 0);
  await act(async () => renderer.unmount());
});
