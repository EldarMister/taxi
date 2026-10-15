const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const textOf = node => typeof node === 'string' ? node : (node?.children || []).map(textOf).join(' ');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function setup(t, options = {}) {
  const patches = [], errors = [], focuses = [];
  let saved = { id: 'client-unique', role: 'CLIENT', language: 'ru', phone: '+996700123456', name: 'Элдар Райымов', notifications: true, ...options.user };
  let renderer, setCurrentUser;
  const native = {
    ...Object.fromEntries(['ActivityIndicator', 'Pressable', 'RefreshControl', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
    Alert: { alert() {} }, AppState: { addEventListener: () => ({ remove() {} }) }, Linking: {},
    StyleSheet: { create: value => value },
  };
  const ui = {
    Icon: 'Icon', Avatar: 'Avatar', Car: 'Car', Route: 'Route', Empty: 'Empty', ToggleSwitch: 'ToggleSwitch',
    colors: { danger: '#CA4149', ink: '#101D38', muted: '#63718D', line: '#E5EDF6' },
    s: { input: { color: '#101D38', backgroundColor: '#FFFFFF' } },
    tr: () => value => value, localize: (_language, value) => value,
    Button: props => React.createElement('Button', { ...props, disabled: !!props.busy || !!props.disabled }),
  };
  const api = {
    patch: async (url, body) => {
      patches.push({ url, body: clone(body) });
      await options.patch?.(url, body);
      saved = { ...saved, ...body, name: body.firstName !== undefined ? `${body.firstName} ${body.lastName}` : saved.name };
      return clone(saved);
    },
    request: async () => [],
  };
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/AccountScreens.tsx'), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return native;
    if (id === './ui') return ui;
    if (id === './api') return { api, messageOf: error => error.message };
    if (id === './design/theme') return { useTheme: () => ({ isDark: !!options.dark, palette: {
      ink: options.dark ? '#FFFFFF' : '#101D38', muted: '#63718D', accent: '#087FFF', background: '#050505',
    } }) };
    if (id === './auth/languageStore') return { writeSelectedLanguage: async () => {} };
    if (id === './native/push') return {};
    if (id === './DriverAccountScreens') return { DriverProfileScreen: 'DriverProfileScreen', DriverSettingsScreen: 'DriverSettingsScreen' };
    if (['./accountDeletion', './LegalDocumentLink', './ClientTripHistory', './DriverTripHistory', './driverHistory', './DriverBalanceScreen', './DriverDetailsScreen', 'expo-image-picker', 'expo-image-manipulator'].includes(id)) return {};
    throw Error(`Unexpected dependency ${id}`);
  } }, { filename: 'AccountScreens.tsx' });
  function Harness() {
    const [user, setUser] = React.useState(saved);
    setCurrentUser = setUser;
    return React.createElement(exports.AccountScreen, {
      page: 'profile', user, config: null, onUser: setUser, onError: value => errors.push(value),
      onOnline() {}, onNavigate() {}, onLogout() {}, busy: false, themePreference: 'system',
      onThemePreferenceChange() {}, historyDetailId: null, onHistoryDetailId() {},
    });
  }
  await act(async () => {
    renderer = create(React.createElement(Harness), { createNodeMock: element => element.type === 'TextInput'
      ? { focus: () => focuses.push(element.props.testID) } : null });
  });
  t.after(async () => act(async () => renderer.unmount()));
  const h = {
    renderer, patches, errors, focuses,
    input: field => renderer.root.findByProps({ testID: `client-profile-${field}-name` }),
    inputs: () => renderer.root.findAllByType('TextInput'),
    button: () => renderer.root.findByType('Button'),
    text: () => textOf(renderer.toJSON()),
    editControl: () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Редактировать профиль'),
    edit: async () => act(async () => h.editControl().props.onPress()),
    change: async (field, value) => act(async () => h.input(field).props.onChangeText(value)),
    save: async () => act(async () => { h.button().props.onPress(); }),
    keyboardSubmit: async field => act(async () => h.input(field).props.onSubmitEditing()),
    remoteUser: async patch => act(async () => { saved = { ...saved, ...patch }; setCurrentUser(saved); }),
    dark: async () => act(async () => { options.dark = true; renderer.update(React.createElement(Harness)); }),
  };
  return h;
}

test('client profile displays authoritative full name and reveals structured names only while editing', async t => {
  const h = await setup(t, { user: { name: 'Элдар Райымов', firstName: 'Элдар', lastName: 'Райымов' } });
  assert.match(h.text(), /Элдар Райымов/);
  assert.equal(h.inputs().length, 0);
  await h.edit();
  assert.equal(h.input('first').props.value, 'Элдар');
  assert.equal(h.input('last').props.value, 'Райымов');
  await h.change('first', 'Не сохранено');
  await h.edit();
  assert.equal(h.inputs().length, 0);
  assert.match(h.text(), /Элдар Райымов/);
  await h.remoteUser({ name: 'Жан Люк', firstName: 'Жан', lastName: 'Люк' });
  await h.edit();
  assert.equal(h.input('first').props.value, 'Жан');
  assert.equal(h.input('last').props.value, 'Люк');
});

test('legacy unsplit full name is preserved and requires explicit first and last names to edit', async t => {
  const h = await setup(t, { user: { name: 'Jean van der Meer' } });
  await h.edit();
  assert.match(h.text(), /Jean van der Meer/);
  assert.equal(h.input('first').props.value, '');
  assert.equal(h.input('last').props.value, '');
  assert.equal(h.button().props.disabled, true);
  await h.change('first', '  ');
  await h.change('last', 'van der Meer');
  await h.keyboardSubmit('last');
  assert.equal(h.patches.length, 0);
  assert.match(h.text(), /Введите имя и фамилию/);
});

test('client edit saves both international names normalized and renders returned full name', async t => {
  const h = await setup(t);
  await h.edit();
  await h.change('first', '  Jean  Luc-李 ');
  await h.change('last', ' O’Neill  ');
  await h.keyboardSubmit('first');
  assert.deepEqual(h.focuses, ['client-profile-last-name']);
  await h.save();
  assert.deepEqual(h.patches, [{ url: '/users/me', body: { firstName: 'Jean Luc-李', lastName: 'O’Neill' } }]);
  assert.equal(h.inputs().length, 0);
  assert.match(h.text(), /Jean Luc-李 O’Neill/);
});

test('client profile rejects a combined name over 80 characters and accepts the boundary', async t => {
  const h = await setup(t);
  await h.edit();
  await h.change('first', 'А'.repeat(40));
  await h.change('last', 'Б'.repeat(40));
  assert.equal(h.button().props.disabled, true);
  assert.match(h.text(), /не более 80 символов/);
  await h.keyboardSubmit('last');
  assert.equal(h.patches.length, 0);
  await h.change('last', 'Б'.repeat(39));
  assert.equal(h.button().props.disabled, false);
  await h.save();
  assert.equal(`${h.patches[0].body.firstName} ${h.patches[0].body.lastName}`.length, 80);
});

test('saving blocks duplicate taps, keyboard submits and editor dismissal', async t => {
  const pending = deferred();
  const h = await setup(t, { user: { firstName: 'Элдар', lastName: 'Райымов' }, patch: () => pending.promise });
  await h.edit();
  const save = h.button().props.onPress, close = h.editControl().props.onPress;
  await act(async () => { save(); save(); close(); });
  await h.keyboardSubmit('last');
  assert.equal(h.patches.length, 1);
  assert.equal(h.button().props.disabled, true);
  assert.equal(h.input('first').props.editable, false);
  assert.equal(h.input('last').props.editable, false);
  assert.equal(h.editControl().props.disabled, true);
  await act(async () => pending.resolve());
  assert.equal(h.inputs().length, 0);
});

test('failed profile save reports the error and keeps edited names ready for retry', async t => {
  let attempt = 0;
  const h = await setup(t, { patch: async () => { if (++attempt === 1) throw Error('Ошибка сети'); } });
  await h.edit();
  await h.change('first', 'Элдар');
  await h.change('last', 'Райымов');
  await h.save();
  assert.deepEqual(h.errors, ['Ошибка сети']);
  assert.equal(h.input('first').props.value, 'Элдар');
  assert.equal(h.input('last').props.value, 'Райымов');
  assert.equal(h.button().props.disabled, false);
  await h.save();
  assert.equal(h.patches.length, 2);
  assert.equal(h.inputs().length, 0);
});

test('client profile inputs stay readable when the theme changes without clearing drafts', async t => {
  const h = await setup(t);
  await h.edit();
  await h.change('first', 'Элдар');
  await h.dark();
  assert.equal(h.input('first').props.value, 'Элдар');
  assert.equal(h.input('first').props.style.color, '#FFFFFF');
  assert.equal(h.input('last').props.keyboardAppearance, 'dark');
  assert.equal(h.input('last').props.accessibilityLabel, 'Фамилия');
});

test('driver profile remains routed to its separate screen without client name inputs', async t => {
  const h = await setup(t, { user: { role: 'DRIVER', name: 'Actual driver', driverProfile: null } });
  assert.equal(h.renderer.root.findAllByType('DriverProfileScreen').length, 1);
  assert.equal(h.inputs().length, 0);
  assert.equal(h.patches.length, 0);
});
