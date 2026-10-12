const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function screen(t, transportClass = 'ECONOMY') {
  const calls = [], updates = [], errors = [], exports = {};
  const user = { id: 'driver', role: 'DRIVER', name: 'Водитель', language: 'ru', notifications: true,
    driverProfile: { transportClass, acceptsEconomy: true, acceptsComfort: false, acceptsDeliveryCar: true, acceptsDeliveryTruck: transportClass === 'TRUCK' } };
  const native = { ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])), StyleSheet: { create: styles => styles }, AppState: { addEventListener: () => ({ remove() {} }) } };
  const ui = { ...Object.fromEntries(['Avatar', 'Button', 'Car', 'Empty', 'Icon', 'Route', 'ToggleSwitch'].map(name => [name, name])), colors: {}, s: {}, tr: () => value => value, money: value => value };
  const source = fs.readFileSync(path.join(__dirname, '../src/AccountScreens.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === 'react-native') return native;
    if (name === './ui') return ui;
    if (name === './design/theme') return { useTheme: () => ({ isDark: false, palette: {} }) };
    if (name === './api') return { messageOf: error => error.message, api: { patch: async (route, patch) => { calls.push({ route, patch }); return { ...user, driverProfile: { ...user.driverProfile, ...patch } }; } } };
    if (name === './native/push') return { getNotificationPermissionState: async () => ({ granted: true }) };
    return {};
  } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.AccountScreen, { page: 'settings', user, config: null, onUser: value => updates.push(value), onError: value => errors.push(value), onOnline() {}, onNavigate() {}, busy: false, themePreference: 'system', onThemePreferenceChange() {}, historyDetailId: null, onHistoryDetailId() {} })); });
  t.after(async () => act(async () => renderer.unmount()));
  return { renderer, calls, updates, errors };
}

test('food delivery is a separate explicit opt-in and never inherits ordinary cargo consent', async t => {
  const h = await screen(t);
  const toggle = h.renderer.root.findAllByType('ToggleSwitch').find(node => node.props.label === 'Доставка еды');
  assert.equal(toggle.props.value, false);
  await act(async () => toggle.props.onValueChange(true));
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [{ route: '/driver/preferences', patch: { acceptsDeliveryFood: true } }]);
  assert.equal(h.updates[0].driverProfile.acceptsDeliveryCar, true);
  assert.equal(h.updates[0].driverProfile.acceptsDeliveryFood, true);
  assert.deepEqual(h.errors, []);
});

test('truck settings do not offer food delivery', async t => {
  const h = await screen(t, 'TRUCK');
  assert.equal(h.renderer.root.findAllByType('ToggleSwitch').some(node => node.props.label === 'Доставка еды'), false);
});
