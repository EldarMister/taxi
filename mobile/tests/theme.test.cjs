const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/design', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

function loadThemeStore(variant, values) {
  const output = {};
  const secureStore = {
    getItemAsync: async key => values.get(key) || null,
    setItemAsync: async (key, value) => { values.set(key, value); },
  };
  vm.runInNewContext(compile('themeStore.ts'), {
    exports: output,
    require: id => id === 'expo-secure-store' ? secureStore : id === '../appVariant' ? { appVariant: variant } : {},
  });
  return output;
}

test('theme preference starts with the phone and persists separately in Atlas and Atlas pro', async () => {
  const values = new Map();
  const client = loadThemeStore('client', values);
  const driver = loadThemeStore('driver', values);
  assert.equal(await client.readThemePreference(), 'system');
  assert.equal(await driver.readThemePreference(), 'system');
  await client.writeThemePreference('dark');
  assert.equal(await client.readThemePreference(), 'dark');
  assert.equal(await driver.readThemePreference(), 'system');
  await driver.writeThemePreference('light');
  assert.equal(await driver.readThemePreference(), 'light');
  assert.equal(await client.readThemePreference(), 'dark');
  values.set('atlas.client.themePreference.v1', 'invalid');
  assert.equal(await client.readThemePreference(), 'system');
});

test('system changes update the live theme until a manual choice overrides them', async t => {
  let systemScheme = 'dark';
  let savedPreference = 'system';
  const writes = [];
  const output = {};
  vm.runInNewContext(compile('theme.tsx'), {
    exports: output,
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return { useColorScheme: () => systemScheme, View: 'View' };
      if (id === './themeStore') return { readThemePreference: async () => savedPreference, writeThemePreference: async value => { writes.push(value); savedPreference = value; } };
      return {};
    },
  });
  function Probe() {
    const theme = output.useTheme();
    return React.createElement('Probe', { preference: theme.preference, resolved: theme.resolved, background: theme.palette.background, choose: theme.setPreference });
  }
  const app = () => React.createElement(output.ThemeProvider, null, React.createElement(Probe));
  let renderer;
  await act(async () => { renderer = create(app()); });
  t.after(async () => act(async () => renderer.unmount()));
  const current = () => renderer.root.findByType('Probe').props;
  assert.equal(current().resolved, 'dark');
  assert.equal(current().background, '#050505');
  systemScheme = 'light';
  await act(async () => renderer.update(app()));
  assert.equal(current().resolved, 'light');
  await act(async () => current().choose('dark'));
  assert.equal(current().resolved, 'dark');
  assert.deepEqual(writes, ['dark']);
  systemScheme = 'light';
  await act(async () => renderer.update(app()));
  assert.equal(current().resolved, 'dark');
  await act(async () => current().choose('system'));
  assert.equal(current().resolved, 'light');
  assert.deepEqual(writes, ['dark', 'system']);
});

test('saved manual preference is loaded before showing application content', async t => {
  let finishRead;
  const output = {};
  vm.runInNewContext(compile('theme.tsx'), {
    exports: output,
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return { useColorScheme: () => 'light', View: 'View' };
      if (id === './themeStore') return {
        readThemePreference: () => new Promise(resolve => { finishRead = resolve; }),
        writeThemePreference: async () => undefined,
      };
      return {};
    },
  });
  function Probe() {
    const { resolved } = output.useTheme();
    return React.createElement('Probe', { resolved });
  }
  let renderer;
  await act(async () => { renderer = create(React.createElement(output.ThemeProvider, null, React.createElement(Probe))); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('Probe').length, 0);
  await act(async () => finishRead('dark'));
  assert.equal(renderer.root.findByType('Probe').props.resolved, 'dark');
});
