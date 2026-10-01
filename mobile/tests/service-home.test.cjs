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
  const timers = new Map();
  const animation = { started: 0, blinkTargets: [], blinkDurations: [] };
  let nextTimer = 0;
  class AnimatedValue { constructor(value) { this.value = value; } setValue(value) { this.value = value; } }
  const api = { request: async () => ({ asOf: new Date().toISOString(), hasUnread: unread,
    items: unread ? [{ id: 'one', title: 'Водитель найден', body: 'Водитель едет', createdAt: new Date().toISOString(), readAt: null }] : [] }),
    post: async (url, body) => { posts.push({ url, body }); unread = false; return { ok: true }; } };
  const exports = {};
  vm.runInNewContext(code, { exports, setInterval: () => 1, clearInterval: () => {},
    setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id.endsWith('.png')) return 1;
      if (id === 'react-native') return { AccessibilityInfo: { isReduceMotionEnabled: async () => false,
          addEventListener: () => ({ remove() {} }) }, AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
        Animated: { Value: AnimatedValue, Text: 'AnimatedText', timing: (_value, config) => {
          if (config.toValue < 1) { animation.blinkTargets.push(config.toValue); animation.blinkDurations.push(config.duration); }
          return config;
        }, sequence: steps => steps, parallel: steps => steps,
        loop: () => ({ start: () => { animation.started++; }, stop() {} }) },
        Easing: { ease: 'ease', inOut: () => 'ease' },
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable',
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
      if (id === './assets') return { foodImage: (key, url) => ({ uri: url || key }) };
      throw Error(id);
    },
  });
  const actions = [];
  const props = { userId: 'client', currentAddress: 'Ленина 18', language: 'ru', savedPlaces: {}, banners: [], active: true, hasOrder: false,
    onChangeAddress: () => actions.push('address'), onTaxi: () => actions.push('taxi'),
    onDelivery: () => actions.push('delivery'), onTruck: () => actions.push('truck'), onSearch: () => actions.push('search'),
    onSavedPlace: () => {}, onEditSavedPlace: () => {}, onFood: () => actions.push('food'),
    onBanner: banner => actions.push(`banner:${banner.id}`), onMenu: () => actions.push('menu'), onOrders: () => {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.ServiceHomeScreen, props)); });
  const button = label => renderer.root.findByProps({ accessibilityLabel: label });
  const headerLabels = renderer.root.findByProps({ testID: 'service-home-content' }).findAllByType('Pressable')
    .slice(0, 2).map(node => node.props.accessibilityLabel);
  assert.deepEqual(headerLabels, ['Меню', 'Уведомления']);
  assert.equal(renderer.root.findAllByType('ScrollView').length, 0);
  assert.equal(renderer.root.findAllByType('LinearGradient').length, 1, 'the original nearby promo appears without a campaign');
  assert.equal(renderer.root.findAllByType('SpringPressable').filter(node => node.props.accessibilityLabel === 'Быстрые заказы рядом').length, 1);
  for (const service of ['Такси', 'Доставка', 'Грузовой', 'Еда']) assert.equal(
    renderer.root.findAllByType('SpringPressable').filter(node => node.props.accessibilityLabel === service).length, 1);
  const searchIcons = renderer.root.findByProps({ accessibilityLabel: 'Куда едем?' }).findAllByType('Icon');
  assert.equal(searchIcons.at(-1).props.name, 'chevron-forward');
  assert.equal(searchIcons.at(-1).props.color, '#4D5663');
  assert.equal(button('Такси').props.containerStyle.height, 128, 'service cards stay compact with the promo');
  assert.equal(renderer.root.findAllByProps({ testID: 'notification-dot' }).length, 0);
  const prompt = 'Куда едем?';
  const animatedText = () => renderer.root.findByType('AnimatedText').children.join('');
  assert.equal(animatedText(), '');
  for (let index = 0; index < prompt.length; index++) {
    const [id, callback] = timers.entries().next().value;
    timers.delete(id);
    await act(async () => callback());
  }
  assert.equal(animatedText(), prompt);
  assert.equal(animation.started, 1);
  assert.ok(animation.blinkTargets.some(value => value < 1));
  assert.ok(animation.blinkDurations.every(duration => duration >= 800));
  assert.equal(timers.size, 0, 'the complete prompt stays visible instead of scheduling an erase');
  await act(async () => renderer.update(React.createElement(exports.ServiceHomeScreen, { ...props, hasOrder: true })));
  const orderIcons = renderer.root.findByProps({ accessibilityLabel: 'Открыть активный заказ еды' }).findAllByType('Icon');
  assert.equal(orderIcons[0].props.color, '#1267B5');
  assert.equal(searchIcons.at(-1).props.name, orderIcons.at(-1).props.name);
  assert.equal(searchIcons.at(-1).props.size, orderIcons.at(-1).props.size);
  assert.equal(searchIcons.at(-1).props.color, orderIcons.at(-1).props.color);
  assert.doesNotMatch(JSON.stringify(renderer.toJSON()), /│/);
  await act(async () => button('Изменить свой адрес').props.onPress());
  await act(async () => button('Доставка').props.onPress());
  await act(async () => button('Грузовой').props.onPress());
  assert.deepEqual(actions, ['address', 'delivery', 'truck']);
  await act(async () => button('Быстрые заказы рядом').props.onPress());
  assert.equal(actions.at(-1), 'taxi');
  await act(async () => renderer.update(React.createElement(exports.ServiceHomeScreen, { ...props, currentAddress: 'GPS: 42.87460, 74.56980' })));
  assert.match(JSON.stringify(renderer.toJSON()), /Определяем адрес/);
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

  await act(async () => { renderer = create(React.createElement(exports.ServiceHomeScreen, {
    ...props, banners: [{ id: 'nearby', title: 'Быстрые заказы рядом!', subtitle: 'Рядом', imageKey: 'nearby-promo', actionType: 'TAXI' }],
  })); });
  assert.equal(renderer.root.findAllByType('LinearGradient').length, 1, 'the configured nearby promo remains visible');
  assert.equal(renderer.root.findAllByType('SpringPressable').filter(node => node.props.accessibilityLabel === 'Быстрые заказы рядом!').length, 1);
  await act(async () => button('Быстрые заказы рядом!').props.onPress());
  assert.equal(actions.at(-1), 'banner:nearby');
  await act(async () => renderer.unmount());

  const promo = { id: 'promo', title: 'Новая акция', subtitle: 'Сегодня', imageKey: 'nearby-promo',
    actionType: 'FOOD', sortOrder: 0, active: true };
  await act(async () => { renderer = create(React.createElement(exports.ServiceHomeScreen, { ...props, banners: [promo] })); });
  assert.equal(renderer.root.findAllByType('SpringPressable').filter(node => node.props.accessibilityLabel === promo.title).length, 1);
  assert.equal(renderer.root.findAllByType('LinearGradient').length, 1);
  assert.equal(renderer.root.findAllByType('ScrollView').length, 0);
  await act(async () => button(promo.title).props.onPress());
  assert.equal(actions.at(-1), 'banner:promo');
  await act(async () => renderer.unmount());
});
