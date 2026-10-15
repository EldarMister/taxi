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
const textOf = node => typeof node === 'string' || typeof node === 'number'
  ? String(node) : (node?.children || []).map(textOf).join(' ');
const dictionaries = {};
for (const [lang, file, name] of [['ky', 'ui.tsx', 'ky'], ['en', 'en.ts', 'en']]) {
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  const match = source.match(new RegExp(`(?:export )?const ${name}: Record<string, string> = (\\{[\\s\\S]*?\\n\\});`));
  assert.ok(match, `Translation dictionary ${lang} is present`);
  dictionaries[lang] = vm.runInNewContext(`(${match[1]})`);
}

async function render(props, dimensions = { width: 390, height: 844 }) {
  const calls = [];
  const native = {
    ActivityIndicator: 'ActivityIndicator', Image: 'Image', Pressable: 'Pressable',
    ScrollView: 'ScrollView', Text: 'Text', View: 'View',
    StyleSheet: { create: styles => styles }, useWindowDimensions: () => dimensions,
  };
  const svg = Object.fromEntries(['Circle', 'Defs', 'G', 'LinearGradient', 'Path', 'Rect', 'Stop', 'Text'].map(name => [name, `Svg${name}`]));
  svg.default = 'Svg'; svg.__esModule = true;
  const cache = {};
  const load = filename => {
    if (cache[filename]) return cache[filename];
    const source = fs.readFileSync(path.join(root, 'src', filename + '.tsx'), 'utf8');
    return compile(source, filename);
  };
  const compile = (source, name) => {
    const compiled = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    const exports = {};
    cache[name] = exports;
    vm.runInNewContext(compiled, {
      exports,
      require: id => {
        if (id === 'react' || id === 'react/jsx-runtime') return require(id);
        if (id === 'react-native') return native;
        if (id === 'react-native-svg') return svg;
        if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
        if (id === 'expo-status-bar') return { StatusBar: 'StatusBar' };
        if (id === './design/theme') return { useTheme: () => ({ isDark: !!dimensions.dark }) };
        if (id === './permissionPalette') return compile(fs.readFileSync(path.join(root, 'src/permissionPalette.ts'), 'utf8'), 'permissionPalette');
        if (id === './ui') return { tr: language => value => dictionaries[language]?.[value] || value };
        if (id === './permissionFlow') return compile(fs.readFileSync(path.join(root, 'src/permissionFlow.ts'), 'utf8'), 'permissionFlow');
        if (id === './PermissionIllustration') return load('PermissionIllustration');
        if (id.endsWith('.png')) return id;
        throw new Error(`Unexpected dependency ${id}`);
      },
    }, { filename: name });
    return exports;
  };
  const screen = load('PermissionOnboarding');
  let renderer;
  await act(async () => { renderer = create(React.createElement(screen.PermissionOnboarding, {
    busy: false, onAllow: () => calls.push('allow'), onSkip: () => calls.push('skip'), ...props,
  })); });
  return { calls, renderer, text: () => textOf(renderer.toJSON()) };
}

for (const [role, steps] of [['CLIENT', ['notifications', 'location']], ['DRIVER', ['notifications', 'overlay', 'location', 'battery']]]) {
  for (const [index, step] of steps.entries()) {
    test(`${role}: ${step} shows correct header progress, settings diagram and original logo`, async t => {
      const view = await render({ step, language: 'ru', role });
      t.after(async () => act(async () => view.renderer.unmount()));
      const progress = view.renderer.root.findByProps({ accessibilityRole: 'progressbar' });
      assert.equal(progress.props.accessibilityLabel, `Шаг ${index + 1} из ${steps.length}`);
      assert.equal(progress.findAllByType('View').length - 1, steps.length);
      assert.equal(progress.props.accessibilityValue.now, index + 1);
      const dots = progress.findAllByType('View').slice(1);
      assert.equal(dots.filter(dot => dot.props.style[2]).length, 1);
      assert.equal(dots[index].props.style[2].backgroundColor, '#2C6BFF');
      const logo = view.renderer.root.findByType('Image');
      assert.equal(logo.props.source, '../assets/logo light.png');
      assert.equal(logo.props.accessibilityLabel, 'ATLAS');
      assert.equal(view.renderer.root.findAllByType('Svg').length, 1);
      assert.ok(view.renderer.root.findAllByType('SvgLinearGradient').length > 0);
      assert.doesNotMatch(view.text(), /NaviTaxi|Atlas Pro|ATLAS PRO/);
      const actions = view.renderer.root.findAllByType('Pressable');
      await act(async () => actions[0].props.onPress());
      await act(async () => actions[1].props.onPress());
      assert.deepEqual(view.calls, ['allow', 'skip']);
      if (step === 'overlay' || step === 'battery') assert.equal(actions[0].props.accessibilityLabel, 'Открыть настройки');
      if (step === 'battery') assert.match(view.text(), /Энергосбережение/);
    });
  }
}

test('client location has foreground access copy and manual address action', async t => {
  const view = await render({ step: 'location', language: 'ru', role: 'CLIENT' });
  t.after(async () => act(async () => view.renderer.unmount()));
  assert.match(view.text(), /При использовании приложения/);
  assert.match(view.text(), /место подачи/);
  assert.match(view.text(), /Указать адрес вручную/);
  assert.doesNotMatch(view.text(), /Разрешить в любом режиме/);
});

test('driver Kyrgyz notifications and settings action are translated', async t => {
  const view = await render({ step: 'notifications', language: 'ky', role: 'DRIVER', openSettings: true, error: 'Разрешите уведомления в настройках устройства.' });
  t.after(async () => act(async () => view.renderer.unmount()));
  assert.match(view.text(), /Билдирүүлөргө уруксат бериңиз/);
  assert.match(view.text(), /Жаңы буюртма/);
  assert.equal(view.renderer.root.findAllByType('Pressable')[0].props.accessibilityLabel, 'Жөндөөлөрдү ачуу');
  assert.equal(view.renderer.root.findByProps({ accessibilityRole: 'progressbar' }).props.accessibilityLabel, '4 кадамдын 1-кадамы');
});

test('small screen keeps content scrollable and disables both actions while checking', async t => {
  const view = await render({ step: 'location', language: 'en', role: 'DRIVER', busy: true }, { width: 320, height: 568 });
  t.after(async () => act(async () => view.renderer.unmount()));
  assert.equal(view.renderer.root.findByType('SafeAreaView').props.style.at(-1).backgroundColor, '#FFFFFF');
  assert.equal(view.renderer.root.findByType('ScrollView').props.contentContainerStyle.flexGrow, 1);
  assert.ok(view.renderer.root.findByType('Svg').props.width <= 276);
  assert.ok(view.renderer.root.findAllByType('Pressable').every(node => node.props.disabled));
  assert.equal(view.renderer.root.findAllByType('ActivityIndicator').length, 1);
  assert.match(view.text(), /background/);
  assert.match(view.text(), /permission/);
  assert.match(view.text(), /Allow all the time/);
});

test('new permission and progress copy has Kyrgyz and English translations', () => {
  for (const text of ['Разрешите уведомления', 'Разрешите отображение всплывающих окон', 'Отключите энергосбережение', 'Энергосбережение', 'При использовании приложения', 'Разрешить в любом режиме', 'Шаг 1 из 4', 'Шаг 2 из 4', 'Шаг 3 из 4', 'Шаг 4 из 4']) {
    for (const lang of ['ky', 'en']) assert.ok(dictionaries[lang][text], `${lang} translation missing: ${text}`);
  }
});

for (const step of ['notifications', 'overlay', 'location', 'battery']) {
  test('dark ' + step + ' themes the whole screen and illustration fade without losing the blue progress', async t => {
    const view = await render({ step, language: 'ru', role: 'DRIVER', error: 'Проверка ошибки' }, { width: 390, height: 844, dark: true });
    t.after(async () => act(async () => view.renderer.unmount()));
    assert.equal(view.renderer.root.findByType('SafeAreaView').props.style.at(-1).backgroundColor, '#050505');
    assert.equal(view.renderer.root.findByType('StatusBar').props.style, 'light');
    assert.equal(view.renderer.root.findByType('Image').props.source, '../assets/logo dark.png');
    assert.equal(view.renderer.root.findByProps({ accessibilityRole: 'header' }).props.style.at(-1).color, '#F4F5F7');
    assert.ok(view.renderer.root.findAllByType('SvgStop').every(stop => stop.props.stopColor === '#050505'));
    assert.ok(view.renderer.root.findAllByType('SvgText').every(label => label.props.fill === '#F4F5F7'));
    assert.equal(view.renderer.root.findAllByType('Pressable')[0].props.style({ pressed: false })[1].backgroundColor, '#1D1D1D');
    const progress = view.renderer.root.findByProps({ accessibilityRole: 'progressbar' });
    const active = progress.findAllByType('View').slice(1).filter(dot => dot.props.style[2]);
    assert.equal(active.length, 1);
    assert.equal(active[0].props.style[2].backgroundColor, '#2C6BFF');
    assert.equal(view.renderer.root.findByProps({ accessibilityRole: 'alert' }).props.style.at(-1).backgroundColor, '#2A1519');
  });
}
