const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let dark = false;
const palettes = {
  light: { surface: '#FFFFFF', elevated: '#F3F7FF', line: '#E5EDF6', ink: '#101D38', muted: '#63718D' },
  dark: { surface: '#111111', elevated: '#1D1D1D', line: '#353535', ink: '#FFFFFF', muted: '#B0B0B0' },
};
const output = {};
const source = fs.readFileSync(path.join(__dirname, '../src/ClientTripHistory.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
vm.runInNewContext(code, { exports: output, require: id => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id);
  if (id === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', Linking: { openURL: async () => {} }, StyleSheet: { create: styles => styles } };
  if (id === './design/theme') return { useTheme: () => ({ isDark: dark, palette: palettes[dark ? 'dark' : 'light'] }) };
  if (id === './ui') return { Avatar: 'Avatar', Icon: 'Icon', km: n => `${n / 1000} км`, mins: n => `${n / 60} мин`, money: n => `${n} сом`, shortAddress: x => x, tr: () => x => x };
  if (id === './native/HistoryRouteMap') return { HistoryRouteMap: 'HistoryRouteMap' };
  return {};
} });

const client = { id: 'client', role: 'CLIENT', language: 'ru' };
const point = address => ({ address, latitude: 42.87, longitude: 74.59 });
const trip = { id: 'trip', status: 'COMPLETED', pickup: point('Улица Ленина, 10'), dropoff: point('Стадион'), price: 103, distanceMeters: 2400, durationSeconds: 480, createdAt: '2026-09-16T08:10:00.000Z', completedAt: '2026-09-16T08:23:00.000Z', geometry: [], rating: 4,
  driver: { id: 'driver', role: 'DRIVER', name: 'Азамат', phone: '+996700123456', driverProfile: { rating: 4.8, carColor: 'Белый', carMake: 'Toyota Camry', carPlate: '01 KG 777 AAA' } } };
const textOf = renderer => renderer.root.findAllByType('Text').map(node => node.children.join('')).join(' ');

test('client history cards open details and use legible status colors in both themes', async t => {
  for (const mode of ['light', 'dark']) {
    dark = mode === 'dark';
    let opened = false;
    let renderer;
    await act(async () => { renderer = create(React.createElement(output.ClientHistoryRow, { order: trip, user: client, onPress: () => { opened = true; } })); });
    const row = renderer.root.findByType('Pressable');
    assert.match(row.props.accessibilityLabel, /Детали поездки/);
    await act(async () => row.props.onPress());
    assert.equal(opened, true);
    assert.match(textOf(renderer), /Завершён/);
    assert.equal(renderer.root.findByType('Pressable').props.style({ pressed: false })[1].backgroundColor, palettes[mode].surface);
    await act(async () => renderer.unmount());
  }
});

test('details show real driver, completion and rating data; cancelled trips never claim payment', async () => {
  dark = true;
  let renderer;
  await act(async () => { renderer = create(React.createElement(output.ClientTripHistoryDetail, { order: trip, user: client, onError: () => {} })); });
  let labels = textOf(renderer);
  assert.match(labels, /Ваш водитель.*Азамат/);
  assert.match(labels, /01 KG 777 AAA/);
  assert.match(labels, /Время завершения/);
  assert.match(labels, /Итого.*103 сом/);
  assert.match(labels, /Ваша оценка/);
  assert.equal(renderer.root.findAllByType('HistoryRouteMap').length, 1);
  await act(async () => renderer.update(React.createElement(output.ClientTripHistoryDetail, { order: { ...trip, status: 'CANCELLED', completedAt: null, driver: null, rating: null }, user: client, onError: () => {} })));
  labels = textOf(renderer);
  assert.match(labels, /Оплата не проводилась/);
  assert.doesNotMatch(labels, /Способ оплаты|Итого|Ваша оценка|Время завершения/);
  await act(async () => renderer.unmount());
  await act(async () => { renderer = create(React.createElement(output.ClientHistoryRow, { order: { ...trip, status: 'CANCELLED' }, user: client, onPress: () => {} })); });
  assert.match(textOf(renderer), /Отменён.*0 сом/);
  await act(async () => renderer.unmount());
});
