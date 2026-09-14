const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const point = (address, latitude = 42.87) => ({ address, latitude, longitude: 74.57 });
const textOf = node => typeof node === 'string' ? node : node.children?.map(textOf).join('') || '';

async function setup(t, initialProps = {}, history = []) {
  const requests = [], searches = [], selected = [], fields = [];
  let renderer, props;
  const timers = new Map(); let timerId=0;
  const TextInput = React.forwardRef((inputProps, ref) => {
    React.useImperativeHandle(ref, () => ({ focus() {} }));
    return React.createElement('TextInput', inputProps);
  });
  const exports = {};
  vm.runInNewContext(compile('AddressPicker.tsx'), {
    exports, AbortController, setTimeout: callback => { const id=++timerId; timers.set(id,callback); return id; }, clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return { TextInput, View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'Spinner', Keyboard: { dismiss() {} }, StyleSheet: { create: value => value, hairlineWidth: 1 } };
      if (id === './BottomPanel') return { BottomPanel: function BottomPanel({ closeRequested, onClose, children }) {
        React.useEffect(() => { if (closeRequested) onClose(); }, [closeRequested]);
        return React.createElement('BottomPanel', { closeRequested, onClose }, children);
      } };
      if (id === './address') return { shortAddress: address => address || '' };
      if (id === './api') return { messageOf: error => error.message, api: { request: async url => { requests.push(url); return history; } } };
      if (id === './native/search') return { searchAddresses: (query, center, signal) => new Promise((resolve, reject) => searches.push({ query, center, signal, resolve, reject })) };
      if (id === './ui') return { Icon: 'Icon', PickupIcon: 'PickupIcon', colors: {}, s: {}, tr: () => value => value };
      if (id === './design/theme') return { useTheme: () => ({ isDark: !!initialProps.darkTheme, palette: { ink: initialProps.darkTheme ? '#FFFFFF' : '#101D38', elevated: '#1D1D1D', muted: '#63718D', line: '#353535', accent: '#087FFF', accentText: '#FFFFFF' } }) };
      if (id === './design/themeStyles') return { useThemeStyles: styles => styles };
      throw Error(id);
    },
  });
  props = { field: 'dropoff', language: 'ru', center: point('Центр', 42.88), onFieldChange: field => fields.push(field), onSelect: value => selected.push(value), onClose() {}, onMap() {}, onLocation() {}, ...initialProps };
  await act(async () => { renderer = create(React.createElement(exports.AddressPicker, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const input = () => renderer.root.findByType('TextInput');
  const button = label => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label || textOf(node) === label);
  return {
    renderer, searches, requests, selected, fields, input, button,
    pause: async () => act(async () => { const pending=[...timers.values()]; timers.clear(); pending.forEach(fn=>fn()); }),
    type: async value => act(async () => input().props.onChangeText(value)),
    keyboardSubmit: async () => act(async () => input().props.onSubmitEditing()),
    tap: async label => { const target = button(label); assert.ok(target, label); await act(async () => target.props.onPress()); },
    update: async patch => { props = { ...props, ...patch }; await act(async () => renderer.update(React.createElement(exports.AddressPicker, props))); },
    resolve: async (index, points) => act(async () => searches[index].resolve(points)),
    reject: async (index, message = 'Нет соединения') => act(async () => searches[index].reject(new Error(message))),
  };
}

test('typing automatically searches after a pause, while prefilled and short queries stay local', async t => {
  const h = await setup(t, { dropoff: point('Чуй 12') });
  assert.equal(h.searches.length, 0, 'opening a prefilled address is not a search');
  await h.type('Ч');
  await h.keyboardSubmit();
  assert.equal(h.searches.length, 0, 'a query under two characters cannot submit');
  await h.type('Чуй');
  await h.type('  Чуй 14  ');
  assert.equal(h.searches.length, 0, 'rapid typing waits for the debounce');
  await h.pause();
  assert.equal(h.searches.length, 1);
  assert.equal(h.searches[0].query, 'Чуй 14');
  assert.equal(h.searches[0].center.latitude, 42.88);
  await h.resolve(0, [point('Чуй 14')]);
  assert.ok(h.button('Чуй 14'));
  await h.type('Манас 44');
  assert.equal(h.searches.length, 1);
  await h.keyboardSubmit();
  assert.equal(h.searches.length, 2);
  assert.equal(h.searches[1].query, 'Манас 44');
});

test('the map button retains a visible background and border in dark mode', async t => {
  const h = await setup(t, { darkTheme: true });
  const style = h.button('Выбрать на карте').props.style;
  assert.equal(style[1].backgroundColor, '#1D1D1D');
  assert.equal(style[1].borderColor, '#353535');
  assert.equal(style[0].borderWidth, 1);
});

test('edits debounce a fresh automatic search and cancel the previous request', async t => {
  const h = await setup(t);
  await h.type('Чуй 12');
  await h.pause();
  await h.resolve(0, [point('Чуй 12')]);
  await h.type('Чуй 12 ');
  assert.equal(h.searches.length, 1, 'whitespace edits wait for the debounce');
  await h.type('Чуй 123');
  await h.type('Чуй 12');
  assert.equal(h.searches.length, 1, 'returning to a previous query still waits for the debounce');
  await h.pause();
  assert.equal(h.searches.length, 2);
});

test('responses for edited queries cannot display or replace the current submitted results', async t => {
  const h = await setup(t);
  await h.type('Первый адрес');
  await h.keyboardSubmit();
  await h.type('Второй адрес');
  assert.equal(h.searches[0].signal.aborted,true);
  await h.resolve(0, [point('Устаревший первый результат')]);
  assert.equal(h.button('Устаревший первый результат'), undefined);
  await h.keyboardSubmit();
  await h.type('Третий адрес');
  await h.keyboardSubmit();
  await h.resolve(2, [point('Текущий результат', 42.9)]);
  assert.ok(h.button('Текущий результат'));
  await h.resolve(1, [point('Устаревший второй результат')]);
  assert.ok(h.button('Текущий результат'));
  assert.equal(h.button('Устаревший второй результат'), undefined);
  await h.tap('Текущий результат');
  assert.equal(h.selected[0].latitude, 42.9);
});

test('changing pickup to dropoff rejects old-field results even when the query text is identical', async t => {
  const h = await setup(t, { field: 'pickup', pickup: point('Чуй 12'), dropoff: point('Чуй 12') });
  await h.keyboardSubmit();
  await h.tap('Изменить пункт назначения');
  assert.deepEqual(h.fields, ['dropoff']);
  await h.update({ field: 'dropoff' });
  assert.equal(h.input().props.value, 'Чуй 12');
  assert.equal(h.searches.length, 1, 'field changes do not submit a geocode request');
  await h.keyboardSubmit();
  await h.resolve(1, [point('Новый пункт назначения', 42.91)]);
  await h.resolve(0, [point('Старая точка посадки', 42.86)]);
  assert.ok(h.button('Новый пункт назначения'));
  assert.equal(h.button('Старая точка посадки'), undefined);
});

test('empty query keeps up to seven unique completed destinations and restores them after clear', async t => {
  const history = [
    { status: 'CANCELLED', dropoff: point('Отменённая поездка') },
    ...Array.from({ length: 9 }, (_, index) => ({ status: 'COMPLETED', dropoff: point('Адрес ' + index, 42.87 + index / 1000) })),
    { status: 'COMPLETED', dropoff: point('Адрес 0', 42.9) },
    { status: 'IN_PROGRESS', dropoff: point('Текущая поездка') },
  ];
  const h = await setup(t, {}, history);
  assert.deepEqual(h.requests, ['/orders/history?period=all']);
  assert.equal(h.button('Отменённая поездка'), undefined);
  assert.equal(h.button('Текущая поездка'), undefined);
  for (let index = 0; index < 7; index++) assert.ok(h.button('Адрес ' + index));
  assert.equal(h.button('Адрес 7'), undefined);
  assert.equal(h.renderer.root.findAllByProps({ accessibilityLabel: 'Адрес 0' }).length, 1);
  await h.tap('Адрес 1');
  assert.equal(h.selected[0].address, 'Адрес 1');
  await h.type('Манас 22');
  assert.equal(h.button('Адрес 1'), undefined);
  await h.tap('Очистить адрес');
  assert.ok(h.button('Адрес 1'));
  assert.equal(h.searches.length, 0);
});

test('failed searches retry only when requested and an old request error cannot hide current results', async t => {
  const h = await setup(t);
  await h.type('Чуй 12');
  await h.keyboardSubmit();
  await h.reject(0);
  assert.ok(h.renderer.root.findAllByType('Text').some(node => node.props.accessibilityRole === 'alert' && node.props.children === 'Нет соединения'));
  assert.equal(h.searches.length, 1);
  await h.tap('Повторить поиск');
  assert.equal(h.searches.length, 2);
  await h.type('Манас 44');
  await h.keyboardSubmit();
  await h.resolve(2, [point('Манас 44')]);
  await h.reject(1, 'Устаревшая ошибка');
  assert.ok(h.button('Манас 44'));
  assert.equal(h.renderer.root.findAllByProps({ accessibilityRole: 'alert' }).length, 0);
});


 test('two-letter city names such as Ош search automatically', async t => {
 const h=await setup(t);await h.type('Ош');await h.pause();assert.equal(h.searches.length,1);assert.equal(h.searches[0].query,'Ош');
 });
