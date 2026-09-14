const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function loadAssets() {
  const exports = {};
  vm.runInNewContext(compile('assets.ts'), { exports, require: id => {
    if (id === '../api') return { api: { socketUrl: 'https://taxi.test' } };
    if (/\.(png|jpe?g)$/i.test(id)) return id;
    throw new Error(`Unexpected dependency ${id}`);
  } });
  return exports;
}

test('uploaded and remote menu images override bundled reference images', () => {
  const { foodImage } = loadAssets();
  assert.equal(foodImage('sushi-roll', '/api/content/media/image-id').uri, 'https://taxi.test/api/content/media/image-id');
  assert.equal(foodImage('philadelphia', 'https://images.test/dish.jpg').uri, 'https://images.test/dish.jpg');
  assert.match(foodImage('philadelphia'), /sushi-roll\.png$/);
  assert.equal(typeof foodImage('sushi-roll', 'javascript:alert(1)'), 'string');
});

test('food cards, text and primary buttons keep contrast when dark theme is active', () => {
  const exports = {};
  const colors = { background: '#050505', surface: '#111111', elevated: '#1D1D1D', ink: '#FFFFFF', muted: '#B0B0B0', line: '#353535', accent: '#FFFFFF', accentText: '#050505' };
  let isDark = true;
  const source = fs.readFileSync(path.join(__dirname, '../src/food/foodTheme.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react') return { useMemo: callback => callback() };
    if (id === 'react-native') return { StyleSheet: { flatten: style => style } };
    if (id === '../design/theme') return { useTheme: () => ({ isDark, palette: colors }) };
    if (id === '../design/tokens') return { palette: { ink: '#111318', muted: '#8A9099', blue: '#087FFF', green: '#169B62', line: '#E7E7E3', surface: '#F1F1EF', white: '#FFFFFF' } };
    throw new Error(`Unexpected dependency ${id}`);
  } });
  const light = { screen: { backgroundColor: '#F7F7F5' }, sectionCard: { backgroundColor: '#FFFFFF', borderColor: '#E7E7E3' }, title: { color: '#111318' }, caption: { color: '#8A9099' }, button: { backgroundColor: '#087FFF' }, buttonText: { color: '#FFFFFF' } };
  const dark = exports.useFoodStyles(light);
  assert.equal(dark.screen.backgroundColor, '#050505');
  assert.equal(dark.sectionCard.backgroundColor, '#111111');
  assert.equal(dark.title.color, '#FFFFFF');
  assert.equal(dark.caption.color, '#B0B0B0');
  assert.equal(dark.button.backgroundColor, '#FFFFFF');
  assert.equal(dark.buttonText.color, '#050505');
  isDark = false;
  assert.equal(exports.useFoodStyles(light), light, 'light styles remain exactly as designed');
});

test('banner swipe, page dots, and tap navigate real configured items and adapt after removal', async t => {
  const exports = {}, scrolls = [], opened = [];
  const native = { Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View', StyleSheet: { create: value => value, absoluteFill: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } } };
  vm.runInNewContext(compile('BannerCarousel.tsx'), { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return native;
    if (id === './assets') return loadAssets();
    if (id === './components') return { foodColors: { ink: '#111', blue: '#007aff' } };
    if (id === './foodTheme') return { useFoodStyles: styles => styles };
    throw new Error(`Unexpected dependency ${id}`);
  } });
  let props = { banners: [
    { id: 'one', title: 'Обед', subtitle: 'Меню ресторана', imageUrl: '/api/content/media/one', actionType: 'RESTAURANT', restaurantId: 'one' },
    { id: 'two', title: 'Еда', subtitle: '', actionType: 'FOOD' },
    { id: 'three', title: 'Скоро', subtitle: '', actionType: 'NONE' },
  ], width: 360, onBanner: banner => opened.push(banner.id) };
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.BannerCarousel, props), { createNodeMock: node => node.type === 'ScrollView' ? { scrollTo: value => scrolls.push(value) } : null }); });
  t.after(async () => act(async () => renderer.unmount()));
  const dots = () => renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityLabel.startsWith('Баннер'));
  const banners = () => renderer.root.findAllByType('Pressable').filter(node => !node.props.accessibilityLabel.startsWith('Баннер'));
  assert.equal(dots().length, 3);
  await act(async () => dots()[1].props.onPress());
  assert.equal(scrolls.at(-1).x, 360);
  assert.equal(dots()[1].props.accessibilityState.selected, true);
  await act(async () => renderer.root.findByType('ScrollView').props.onMomentumScrollEnd({ nativeEvent: { contentOffset: { x: 720 } } }));
  assert.equal(dots()[2].props.accessibilityState.selected, true);
  await act(async () => banners()[0].props.onPress());
  assert.deepEqual(opened, ['one']);
  assert.equal(banners()[2].props.disabled, true);
  props = { ...props, banners: props.banners.slice(0, 1) };
  await act(async () => renderer.update(React.createElement(exports.BannerCarousel, props)));
  assert.equal(dots().length, 0);
  assert.equal(scrolls.at(-1).x, 0);
  props = { ...props, banners: [] };
  await act(async () => renderer.update(React.createElement(exports.BannerCarousel, props)));
  assert.equal(renderer.toJSON(), null);
});
