const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('home reference controls change address, split delivery cards, and show unread notifications only', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/food/HomeScreen.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  let unread = false;
  const posts = [];
  const api = { request: async () => ({ asOf: new Date().toISOString(), hasUnread: unread,
    items: unread ? [{ id: 'one', title: 'Водитель найден', body: 'Водитель едет', createdAt: new Date().toISOString(), readAt: null }] : [] }),
    post: async (url, body) => { posts.push({ url, body }); unread = false; return { ok: true }; } };
  const exports = {};
  vm.runInNewContext(code, { exports, setInterval: () => 1, clearInterval: () => {},
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id.endsWith('.png')) return 1;
      if (id === 'react-native') return { ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable',
        ScrollView: 'ScrollView', StyleSheet: { create: value => value, hairlineWidth: 1 }, Text: 'Text', View: 'View',
        useWindowDimensions: () => ({ width: 390, height: 800 }) };
      if (id === 'expo-linear-gradient') return { LinearGradient: 'LinearGradient' };
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 20, left: 0, right: 0, bottom: 20 }) };
      if (id === '../BottomPanel') return { BottomPanel: 'BottomPanel' };
      if (id === '../api') return { api, messageOf: error => String(error) };
      if (id === '../address') return { shortAddress: value => value || '' };
      if (id === '../design/motion') return { SpringPressable: props => React.createElement('SpringPressable', props, props.children) };
      if (id === '../design/theme') return { useTheme: () => ({ isDark: false, palette: { ink: '#000', muted: '#888', background: '#fff', surface: '#fff', elevated: '#eee', line: '#ddd', accent: '#067' } }) };
      if (id === '../design/typography') return { fonts: { medium: 'medium', bold: 'bold', semibold: 'semibold', extraBold: 'extraBold' } };
      if (id === '../ui') return { Icon: 'Icon', tr: () => value => value };
      if (id === './BannerCarousel') return { BannerCarousel: 'BannerCarousel' };
      throw Error(id);
    },
  });
  const actions = [];
  const props = { userId: 'client', currentAddress: 'Ленина 18', language: 'ru', savedPlaces: {}, banners: [], active: true, hasOrder: false,
    onChangeAddress: () => actions.push('address'), onTaxi: () => actions.push('taxi'),
    onDelivery: () => actions.push('delivery'), onTruck: () => actions.push('truck'), onSearch: () => actions.push('search'),
    onSavedPlace: () => {}, onEditSavedPlace: () => {}, onFood: () => actions.push('food'), onBanner: () => {}, onMenu: () => {}, onOrders: () => {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.ServiceHomeScreen, props)); });
  const button = label => renderer.root.findByProps({ accessibilityLabel: label });
  assert.equal(renderer.root.findAllByProps({ testID: 'notification-dot' }).length, 0);
  await act(async () => button('Изменить свой адрес').props.onPress());
  await act(async () => button('Доставка').props.onPress());
  await act(async () => button('Грузовой').props.onPress());
  assert.deepEqual(actions, ['address', 'delivery', 'truck']);
  await act(async () => renderer.unmount());

  unread = true;
  await act(async () => { renderer = create(React.createElement(exports.ServiceHomeScreen, props)); });
  assert.equal(renderer.root.findAllByProps({ testID: 'notification-dot' }).length, 1);
  await act(async () => button('Уведомления').props.onPress());
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, '/users/me/notifications/read');
  assert.equal(renderer.root.findAllByProps({ testID: 'notification-dot' }).length, 0);
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1);
  await act(async () => renderer.unmount());
});
