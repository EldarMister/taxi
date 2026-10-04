const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const clone = value => JSON.parse(JSON.stringify(value));
const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const screenText = renderer => renderer.root.findAllByType('Text').map(textOf).join(' ');
const control = (renderer, label) => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
const driver = { id: 'driver', role: 'DRIVER', language: 'ru', name: 'Actual driver', phone: '+996555123456', notifications: true, driverProfile: {
  transportClass: 'ECONOMY', verified: true, online: true, rating: 4.8, carMake: 'Real vehicle', carPlate: 'ACTUAL 123', carColor: 'Серый',
  acceptsEconomy: true, acceptsComfort: false, acceptsDeliveryCar: true, acceptsDeliveryTruck: false,
} };

function setup(initial = driver, width = 360) {
  let saved = clone(initial), theme = 'light', granted = true;
  const patches = [], errors = [], requests = [], languages = [], navigations = [], voices = [], online = [];
  const palette = { ink: '#171B2B', background: '#FDFDFF', surface: '#FFFFFF', muted: '#808598', line: '#E2E3EE', accent: '#1677FF' };
  const themed = { useTheme: () => ({ isDark: theme === 'dark', palette }) };
  const native = {
    View: 'View', Text: 'Text', TextInput: 'TextInput', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
    Modal: props => props.visible ? React.createElement('Modal', props, props.children) : null,
    useWindowDimensions: () => ({ width, height: 780 }), StyleSheet: { create: styles => styles, hairlineWidth: .5, absoluteFillObject: {} },
    AppState: { addEventListener: () => ({ remove() {} }) }, Linking: {},
  };
  const ui = {
    Icon: 'Icon', Avatar: 'Avatar', Car: 'Car', Route: 'Route', Empty: 'Empty', colors: {}, s: {},
    tr: () => value => value, localize: (_language, ru) => ru,
    ToggleSwitch: props => React.createElement('Pressable', { accessibilityRole: 'switch', accessibilityLabel: props.label, disabled: props.disabled, accessibilityState: { checked: props.value, disabled: props.disabled }, onPress: () => props.onValueChange(!props.value) }),
    Button: props => React.createElement('Pressable', { onPress: props.onPress, disabled: props.disabled, accessibilityLabel: props.label }, React.createElement('Text', null, props.label)),
  };
  const api = { baseUrl: 'http://local.test/api', getTokens: () => null,
    request: async url => { requests.push(url); return []; },
    patch: async (url, patch) => {
      patches.push({ url, patch: clone(patch) });
      if (url === '/driver/preferences') Object.assign(saved.driverProfile, patch);
      else Object.assign(saved, patch);
      return clone(saved);
    },
  };
  function load(file, extra = {}) {
    const output = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports: output, process: { env: {} }, require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) };
      if (id === 'expo-status-bar') return { StatusBar: 'StatusBar' };
      if (id === './design/theme') return themed;
      if (id === './design/typography') return { fonts: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', bold: 'Inter_700Bold' } };
      if (id === './ui') return ui;
      if (id === './api') return { api, messageOf: error => error.message };
      if (id === './native/push') return {
        getNotificationPermissionState: async () => ({ granted }), requestNotificationAccess: async () => ({ granted, canAskAgain: true, supported: true }), registerPushNotifications: async () => {}, openNotificationSettings: async () => {},
      };
      if (id === './auth/languageStore') return { writeSelectedLanguage: async language => languages.push(language) };
      if (id === './DriverBalanceScreen') return {};
      if (id === './DriverAccountScreens') return extra.account;
      if (id === './ClientTripHistory' || id === './DriverTripHistory' || id.startsWith('expo-image-')) return {};
      throw new Error('Unmocked dependency ' + id);
    } });
    return output;
  }
  const account = load('DriverAccountScreens.tsx');
  const { AccountScreen } = load('AccountScreens.tsx', { account });
  function Harness({ page = 'settings' }) {
    const [user, setUser] = React.useState(() => clone(saved));
    const [preference, setPreference] = React.useState(theme);
    const [voice, setVoice] = React.useState(true);
    return React.createElement(AccountScreen, { page, user, config: null, onUser: setUser, onError: error => errors.push(error), onOnline: value => online.push(value), onNavigate: value => navigations.push(value), onMenu: () => navigations.push('menu'), busy: false, themePreference: preference,
      onThemePreferenceChange: value => { theme = value; setPreference(value); }, historyDetailId: null, onHistoryDetailId() {}, voiceEnabled: voice, onVoiceEnabledChange: value => { voices.push(value); setVoice(value); } });
  }
  return { Harness, patches, errors, requests, languages, navigations, voices, online, saved: () => clone(saved), denyNotifications: () => { granted = false; } };
}

test('delivery expands separately from both switches and retains saved settings after remount', async () => {
  const h = setup(); let r;
  await act(async () => { r = create(React.createElement(h.Harness)); });
  assert.equal(control(r, 'Доставка').props.accessibilityState.expanded, true);
  assert.equal(control(r, 'Доставка на машине').props.accessibilityState.checked, true);
  assert.equal(control(r, 'Доставка еды').props.accessibilityState.checked, false);
  await act(async () => control(r, 'Доставка еды').props.onPress());
  assert.deepEqual(h.patches.at(-1), { url: '/driver/preferences', patch: { acceptsDeliveryFood: true } });
  assert.equal(control(r, 'Доставка').props.accessibilityState.expanded, true);
  await act(async () => control(r, 'Доставка на машине').props.onPress());
  assert.deepEqual(h.patches.at(-1).patch, { acceptsDeliveryCar: false });
  assert.equal(control(r, 'Доставка еды').props.accessibilityState.checked, true);
  await act(async () => control(r, 'Доставка').props.onPress());
  assert.equal(control(r, 'Доставка еды'), undefined);
  assert.equal(h.patches.length, 2);
  await act(async () => control(r, 'Доставка').props.onPress());
  assert.equal(control(r, 'Доставка еды').props.accessibilityState.checked, true);
  await act(async () => r.unmount());
  await act(async () => { r = create(React.createElement(h.Harness)); });
  assert.equal(control(r, 'Доставка еды').props.accessibilityState.checked, true);
  assert.equal(control(r, 'Доставка на машине').props.accessibilityState.checked, false);
  assert.deepEqual(h.errors, []);
  const scroll = r.root.findByType('ScrollView');
  assert.ok(scroll.props.contentContainerStyle.paddingBottom >= 34);
  assert.notEqual(scroll.props.scrollEnabled, false);
  await act(async () => r.unmount());
});

test('Comfort is visibly unavailable for Economy and enabled for Comfort drivers', async () => {
  for (const available of [false, true]) {
    const h = setup({ ...driver, driverProfile: { ...driver.driverProfile, transportClass: available ? 'COMFORT' : 'ECONOMY' } }); let r;
    await act(async () => { r = create(React.createElement(h.Harness)); });
    assert.equal(control(r, 'Комфорт').props.disabled, !available);
    assert.match(screenText(r), available ? /Назначенный класс: Комфорт/ : /Недоступен вам/);
    if (available) {
      await act(async () => control(r, 'Комфорт').props.onPress());
      assert.deepEqual(h.patches.at(-1).patch, { acceptsComfort: true });
    }
    await act(async () => r.unmount());
  }
});

test('voice, notifications, theme and language keep their existing saving and permission actions', async () => {
  const h = setup(); let r;
  await act(async () => { r = create(React.createElement(h.Harness)); });
  await act(async () => control(r, 'Озвучивать маршрут').props.onPress());
  assert.deepEqual(h.voices, [false]);
  await act(async () => control(r, 'Уведомления').props.onPress());
  assert.deepEqual(h.patches.at(-1), { url: '/users/me', patch: { notifications: false } });
  h.denyNotifications();
  await act(async () => control(r, 'Уведомления').props.onPress());
  assert.equal(h.saved().notifications, false);
  assert.equal(h.errors.length, 1);
  for (const label of ['Тёмная', 'Как в системе', 'Светлая']) {
    await act(async () => control(r, label).props.onPress());
    assert.equal(control(r, label).props.accessibilityState.checked, true);
  }
  await act(async () => control(r, 'Язык интерфейса').props.onPress());
  await act(async () => control(r, 'Кыргызча').props.onPress());
  assert.deepEqual(h.patches.at(-1), { url: '/users/me', patch: { language: 'ky' } });
  assert.deepEqual(h.languages, ['ky']);
  assert.equal(r.root.findAllByType('Modal').length, 0);
  await act(async () => r.unmount());
});

test('profile uses actual user and vehicle data, keeps navigation and online, and has no financial UI or requests', async () => {
  const h = setup(); let r;
  await act(async () => { r = create(React.createElement(h.Harness, { page: 'profile' })); });
  assert.match(screenText(r), /Actual driver.*\+996555123456.*4\.8.*Real vehicle.*ACTUAL 123.*Серый/);
  assert.doesNotMatch(screenText(r), /Баланс|Заработок|История операций|Сегодня|Неделя/);
  assert.deepEqual(h.requests, []);
  await act(async () => control(r, 'На линии').props.onPress());
  assert.deepEqual(h.online, [false]);
  for (const label of ['Допуски и документы', 'Настройки', 'Поддержка', 'История заказов', 'Меню']) await act(async () => control(r, label).props.onPress());
  assert.deepEqual(h.navigations, ['registration', 'settings', 'support', 'history', 'menu']);
  await act(async () => r.unmount());
});
