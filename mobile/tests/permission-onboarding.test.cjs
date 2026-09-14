const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/PermissionOnboarding.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const ky = {
  'Не пропустите важное': 'Маанилүү билдирүүлөрдү өткөрүп жибербеңиз',
  'Сообщим о новом заказе, сообщении пассажира, когда пассажир выходит, и о завершении поездки.': 'Жаңы буюртма, жүргүнчүнүн билдирүүсү, жүргүнчү чыгып жатканы жана сапардын аякташы жөнүндө билдиребиз.',
  'Включить уведомления': 'Билдирүүлөрдү күйгүзүү',
  'Не сейчас': 'Азыр эмес',
  'Шаг 2 из 2': '2 кадамдын 2-кадамы',
};
const textOf = node => typeof node === 'string' || typeof node === 'number'
  ? String(node) : (node?.children || []).map(textOf).join(' ');

async function render(props, options = {}) {
  const calls = [];
  const native = {
    Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: styles => styles }, useWindowDimensions: () => ({ width: 390, height: 844 }),
  };
  const ui = {
    Logo: 'Logo', colors: { white: '#fff', blue: '#087fff', ink: '#101d38', muted: '#7a8ca8', danger: '#ca4149' },
    tr: language => value => language === 'ky' ? (ky[value] || value) : value,
    Button: value => React.createElement('Button', value),
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (id === './ui') return ui;
      if (id === './design/theme') return { useTheme: () => ({ isDark: !!options.dark }) };
      if (id.endsWith('.png')) return id;
      throw new Error(`Unexpected dependency ${id}`);
    },
  }, { filename: 'PermissionOnboarding.tsx' });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.PermissionOnboarding, {
    busy: false, onAllow: () => calls.push('allow'), onSkip: () => calls.push('skip'), ...props,
  })); });
  return { calls, renderer, text: () => textOf(renderer.toJSON()) };
}

test('client sees the GPS explanation before the notification step and both actions work', async t => {
  const view = await render({ step: 'location', language: 'ru', role: 'CLIENT' });
  t.after(async () => act(async () => view.renderer.unmount()));
  assert.match(view.text(), /Разрешите доступ к геолокации/);
  assert.match(view.text(), /место подачи/);
  assert.match(view.text(), /Указать адрес вручную/);
  await act(async () => view.renderer.root.findByType('Button').props.onPress());
  const skip = view.renderer.root.findAllByType('Pressable').find(node => textOf(node).includes('Указать адрес вручную'));
  await act(async () => skip.props.onPress());
  assert.deepEqual(view.calls, ['allow', 'skip']);
});

test('driver notification screen uses role-specific Kyrgyz copy and can open settings', async t => {
  const view = await render({ step: 'notifications', language: 'ky', role: 'DRIVER', openSettings: true, error: 'Разрешите уведомления в настройках устройства.' });
  t.after(async () => act(async () => view.renderer.unmount()));
  assert.match(view.text(), /Маанилүү билдирүүлөрдү/);
  assert.match(view.text(), /Жаңы буюртма/);
  assert.doesNotMatch(view.text(), /водитель назначен/);
  assert.equal(view.renderer.root.findByType('Button').props.label, 'Открыть настройки');
});

test('permission steps remain readable in dark mode', async t => {
  const view = await render({ step: 'location', language: 'ru', role: 'CLIENT' }, { dark: true });
  t.after(async () => act(async () => view.renderer.unmount()));
  assert.equal(view.renderer.root.findByType('SafeAreaView').props.style[1].backgroundColor, '#050505');
  assert.equal(view.renderer.root.findAllByType('Text').find(node => textOf(node).includes('Разрешите доступ')).props.style[1].color, '#FFFFFF');
  assert.equal(view.renderer.root.findAllByType('Text').find(node => textOf(node).includes('Указать адрес вручную')).props.style[1].color, '#FFFFFF');
  assert.equal(view.renderer.root.findByType('Button').props.label, 'Разрешить доступ');
});

test('permission artwork is bundled locally and translations cover both screens', () => {
  for (const file of ['assets/onboarding-location.png', 'assets/onboarding-notifications.png']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must be bundled`);
    assert.ok(fs.statSync(path.join(root, file)).size > 10_000, `${file} must not be a placeholder`);
  }
  const ui = fs.readFileSync(path.join(root, 'src/ui.tsx'), 'utf8');
  for (const text of ['Разрешите доступ к геолокации', 'Не пропустите важное', 'Разрешить доступ', 'Включить уведомления', 'Указать адрес вручную', 'Не сейчас']) assert.match(ui, new RegExp(text));
});
