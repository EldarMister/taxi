const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const clone = value => JSON.parse(JSON.stringify(value));
const saved = { fulfillment: 'DELIVERY', address: 'ул. Токтогула, 100', addressPoint: { latitude: 42.87, longitude: 74.57 }, comment: 'Позвоните', paymentMethod: 'CASH', entrance: '2', floor: '4', apartment: '18', intercom: '18К', cutleryCount: 3, restaurantComment: 'Без лука' };

async function mount(t, { details = saved, geocode, position, defaultPoint, platform = 'android', deferSheetClose = false } = {}) {
  const saves = [], searches = [];
  const pendingSheetClosures = [];
  let closed = 0, selected, renderer;
  const native = Object.fromEntries(['View', 'Text', 'TextInput', 'Pressable', 'ScrollView', 'Modal', 'KeyboardAvoidingView'].map(name => [name, name]));
  native.StyleSheet = { create: value => value, absoluteFill: {}, hairlineWidth: 1 };
  let dismissed = 0;
  native.Keyboard = { dismiss() { dismissed++; } };
  native.Platform = { OS: platform };
  const exports = {};
  const compile = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food/FoodAddressPicker.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(compile, { exports, AbortController, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return native;
    if (id === 'react-native-gesture-handler') return { GestureHandlerRootView: 'GestureHandlerRootView' };
    if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) };
    if (id === '../native/TaxiMap') return { __esModule: true, default: props => React.createElement('TaxiMap', props,
      props.renderSelectionPanel(selected ?? { point: props.pickup, address: props.pickup.address ?? '', ready: true, moving: false, locatingAddress: false })) };
    if (id === '../native/mapkit') return { BISHKEK: { latitude: 42.87, longitude: 74.57 }, searchAddresses: (...args) => { searches.push(args); return geocode?.promise ?? Promise.resolve([]); } };
    if (id === '../native/location') return { getLocationPermissionState: async () => ({ granted: false, servicesEnabled: false }), getCurrentPosition: async () => position ?? { latitude: 42.91, longitude: 74.61, address: 'Текущее место' } };
    if (id === '../AddressPicker') return { AddressPicker: props => React.createElement('AddressPicker', props) };
    if (id === '../BottomPanel') return { BottomPanel: function BottomPanel({ closeRequested, onClose, children, ...props }) {
      React.useEffect(() => {
        if (!closeRequested) return;
        if (deferSheetClose) pendingSheetClosures.push(onClose);
        else onClose();
      }, [closeRequested]);
      return React.createElement('BottomPanel', { ...props, closeRequested, onClose }, children);
    } };
    if (id === '../ui') return { Icon: 'Icon' };
    if (id === '../address') return { shortAddress: value => value ?? '' };
    if (id === '../api') return { messageOf: value => value.message };
    if (id === '../design/theme') return { useTheme: () => ({ resolved: 'light', palette: { ink: '#222', muted: '#999' } }) };
    if (id === '../design/typography') return { fonts: {} };
    if (id === './components') return { FoodButton: props => React.createElement('FoodButton', props) };
    if (id === './i18n') return { useFoodT: () => value => value };
    if (id === './foodTheme') return { useFoodStyles: value => value };
    throw new Error(`Unexpected import ${id}`);
  } });
  const props = { details: clone(details), defaultPoint, language: 'ru', onSave: value => saves.push(clone(value)), onClose: () => { closed++; } };
  await act(async () => { renderer = create(React.createElement(exports.FoodAddressPicker, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return {
    renderer, saves, searches, props, get closed() { return closed; },
    get dismissed() { return dismissed; },
    get map() { return renderer.root.findByType('TaxiMap').props; },
    get search() { return renderer.root.findByType('AddressPicker').props; },
    button: label => renderer.root.findAllByType('FoodButton').find(node => node.props.label === label),
    input: label => renderer.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === label),
    press: async label => act(async () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label).props.onPress()),
    finishSheetClose: async () => act(async () => { pendingSheetClosures.splice(0).forEach(callback => callback()); }),
    select: async value => act(async () => { selected = value; renderer.update(React.createElement(exports.FoodAddressPicker, { ...props })); }),
  };
}

test('food address draft keeps delivery details, saves current settled coordinates and discards cancelled edits', async t => {
  const h = await mount(t);
  assert.equal(h.map.pickup.address, saved.address, 'restoring coordinates also restores the readable address');
  await act(async () => { h.input('Подъезд').props.onChangeText('7'); h.input('Домофон').props.onChangeText('77К'); });
  const next = { point: { latitude: 42.891, longitude: 74.591 }, address: 'ул. Киевская, 10', ready: true, moving: false, locatingAddress: false };
  await h.select(next);
  await act(async () => h.button('Готово').props.onPress());
  assert.deepEqual(h.saves[0], { ...saved, address: next.address, addressPoint: next.point, entrance: '7', intercom: '77К' });
  assert.deepEqual(h.props.details, saved, 'draft editing never mutates persisted checkout details');
  await act(async () => h.input('Квартира').props.onChangeText('99'));
  await h.press('Назад');
  assert.equal(h.closed, 1);
  assert.equal(h.saves.length, 1, 'cancelling never persists the latest field edits');
  assert.equal(h.saves[0].apartment, '18');
});

test('food address cannot save an unsettled, unresolved or empty map address', async t => {
  const h = await mount(t);
  const valid = { point: saved.addressPoint, address: saved.address, ready: true, moving: false, locatingAddress: false };
  for (const change of [{ ready: false }, { moving: true }, { locatingAddress: true }, { address: 'Точка на карте' }, { address: '' }]) {
    await h.select({ ...valid, ...change });
    assert.equal(h.button('Готово').props.disabled, true);
    await act(async () => h.button('Готово').props.onPress());
    assert.equal(h.saves.length, 0);
  }
});

test('late GPS results do not replace a newer address search selection', async t => {
  const gps = deferred();
  const h = await mount(t, { position: gps.promise });
  await h.press('Найти адрес');
  await act(async () => { h.search.onLocation(); h.search.onClose(); });
  await h.press('Найти адрес');
  const chosen = { latitude: 42.905, longitude: 74.605, address: 'Новый адрес' };
  await act(async () => { h.search.onSelect(chosen); h.search.onClose(); });
  await act(async () => gps.resolve({ latitude: 42.8, longitude: 74.5, address: 'Предыдущее местоположение' }));
  assert.deepEqual(clone(h.map.pickup), chosen);
  assert.deepEqual(clone(h.map.focusPoint), chosen);
});

test('food search opens at the current map address and a late legacy lookup cannot override a new selection', async t => {
  const geocode = deferred();
  const h = await mount(t, { details: { ...saved, addressPoint: undefined }, geocode });
  assert.equal(h.searches.length, 1);
  const mapPoint = { latitude: 42.88, longitude: 74.58 };
  await h.select({ point: mapPoint, address: 'ул. Московская, 20', ready: true, moving: false, locatingAddress: false });
  await h.press('Найти адрес');
  assert.equal(h.search.savedPlace.point.address, 'ул. Московская, 20');
  assert.equal(h.search.center.latitude, mapPoint.latitude);
  assert.equal(h.search.center.longitude, mapPoint.longitude);
  const chosen = { latitude: 42.9, longitude: 74.6, address: 'пр. Чуй, 40' };
  await act(async () => { h.search.onSelect(chosen); h.search.onClose(); });
  assert.deepEqual(clone(h.map.focusPoint), chosen);
  assert.deepEqual(clone(h.map.pickup), chosen);
  await act(async () => geocode.resolve([{ ...saved.addressPoint, address: saved.address }]));
  assert.deepEqual(clone(h.map.focusPoint), chosen, 'new user choice wins over the pending saved-address lookup');
});

test('courier comment sheet cancels independently and only an explicit save updates the address draft', async t => {
  const h = await mount(t);
  const openComment = async () => act(async () => {
    h.renderer.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Позвоните')).props.onPress();
  });
  await openComment();
  await act(async () => h.input('Комментарий курьеру').props.onChangeText('Не сохранять'));
  await act(async () => h.renderer.root.findAllByType('Modal').at(-1).props.onRequestClose());
  await openComment();
  assert.equal(h.input('Комментарий курьеру').props.value, 'Позвоните');
  await act(async () => h.input('Комментарий курьеру').props.onChangeText('  Вход со двора  '));
  await act(async () => h.button('Сохранить').props.onPress());
  assert.equal(h.saves.length, 0, 'comment confirmation updates only the local address draft');
  await act(async () => h.button('Готово').props.onPress());
  assert.equal(h.saves[0].comment, 'Вход со двора');
  assert.equal(h.saves[0].restaurantComment, 'Без лука');
});

test('the native food modal owns a gesture root for address search and the shared courier comment sheet', async t => {
  for (const platform of ['android', 'ios']) {
    const h = await mount(t, { platform });
    const nativeModal = h.renderer.root.findByType('Modal');
    const gestureRoot = nativeModal.findByType('GestureHandlerRootView');
    assert.equal(gestureRoot.props.style.flex, 1);
    assert.equal(gestureRoot.findAllByType('TaxiMap').length, 1);
    const keyboard = gestureRoot.findByType('KeyboardAvoidingView');
    assert.equal(keyboard.props.enabled, platform === 'ios', 'Android Modal uses its own native adjustResize');
    assert.equal(keyboard.props.behavior, platform === 'ios' ? 'padding' : undefined);
    await h.press('Найти адрес');
    assert.equal(gestureRoot.findAllByType('AddressPicker').length, 1, 'food address search stays below the modal-native gesture root');
    await act(async () => h.search.onClose());
    await h.press('Комментарий курьеру');
    assert.equal(h.renderer.root.findAllByType('Modal').length, 1, 'courier comment does not create a separate native touch root');
    const sheet = gestureRoot.findByType('BottomPanel');
    let ancestor = sheet.parent;
    while (ancestor && ancestor.type !== 'GestureHandlerRootView') {
      assert.notEqual(ancestor.type, 'KeyboardAvoidingView', 'courier sheet is a sibling of the map keyboard wrapper');
      ancestor = ancestor.parent;
    }
    assert.equal(ancestor, gestureRoot);
    assert.equal(sheet.findAllByType('KeyboardAvoidingView').length, 0, 'the shared sheet compensates its own keyboard');
    assert.equal(sheet.findByProps({ testID: 'food-courier-comment' }).props.keyboardShouldPersistTaps, 'handled');
    assert.equal(keyboard.props.pointerEvents, 'none');
    assert.equal(keyboard.props.importantForAccessibility, 'no-hide-descendants', 'the map cannot be closed or saved behind an open comment');
  }
});

test('courier close waits for the sheet exit, discards unsaved comments and commits saved comments only to the draft', async t => {
  const h = await mount(t, { deferSheetClose: true });
  await h.press('Комментарий курьеру');
  await act(async () => h.input('Комментарий курьеру').props.onChangeText('Не сохранять'));
  await h.press('Закрыть');
  assert.equal(h.renderer.root.findByType('BottomPanel').props.closeRequested, true);
  assert.equal(h.input('Комментарий курьеру').props.editable, false);
  assert.equal(h.closed, 0);
  await h.finishSheetClose();
  assert.equal(h.renderer.root.findAllByType('BottomPanel').length, 0);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.pointerEvents, 'auto');
  await h.press('Комментарий курьеру');
  assert.equal(h.input('Комментарий курьеру').props.value, 'Позвоните');
  await act(async () => h.input('Комментарий курьеру').props.onChangeText('Не сохранять жестом'));
  await act(async () => h.renderer.root.findByType('BottomPanel').props.onClose());
  await h.press('Комментарий курьеру');
  assert.equal(h.input('Комментарий курьеру').props.value, 'Позвоните');
  await act(async () => h.input('Комментарий курьеру').props.onChangeText('  Вход со двора  '));
  await act(async () => h.button('Сохранить').props.onPress());
  assert.equal(h.renderer.root.findByType('BottomPanel').props.closeRequested, true);
  assert.equal(h.button('Сохранить').props.disabled, true);
  assert.equal(h.saves.length, 0);
  assert.deepEqual(h.props.details, saved);
  await h.finishSheetClose();
  await act(async () => h.button('Готово').props.onPress());
  assert.equal(h.saves[0].comment, 'Вход со двора');
  assert.equal(h.saves[0].restaurantComment, 'Без лука');
  assert.equal(h.closed, 0, 'comment save does not close the address picker');
  assert.ok(h.dismissed >= 3, 'all close and confirmation paths release the keyboard');
});

test('editing entrance during a legacy address lookup does not replace the saved food destination', async t => {
  const geocode = deferred();
  const defaultPoint = { latitude: 42.81, longitude: 74.51, address: 'Другая точка для такси' };
  const h = await mount(t, { details: { ...saved, addressPoint: undefined }, defaultPoint, geocode });
  await act(async () => {
    // A real field tap bubbles through the screen before the input changes.
    h.renderer.root.findByType('KeyboardAvoidingView').props.onTouchStart?.();
    h.input('Подъезд').props.onChangeText('7');
  });
  const resolved = { ...saved.addressPoint, address: saved.address };
  await act(async () => geocode.resolve([resolved]));
  assert.deepEqual(clone(h.map.pickup), resolved, 'a detail-field touch must not cancel resolution of the saved destination');
  assert.deepEqual(clone(h.map.focusPoint), resolved);
  assert.equal(h.input('Подъезд').props.value, '7');
  await act(async () => h.button('Готово').props.onPress());
  assert.equal(h.saves[0].address, saved.address);
  assert.equal(h.saves[0].entrance, '7');
  assert.deepEqual(h.saves[0].addressPoint, saved.addressPoint);
});

test('a legacy food address cannot be replaced by an initial taxi fallback while its lookup is pending or empty', async t => {
  const geocode = deferred();
  const defaultPoint = { latitude: 42.81, longitude: 74.51, address: 'Другая точка для такси' };
  const h = await mount(t, { details: { ...saved, addressPoint: undefined }, defaultPoint, geocode });
  assert.equal(h.button('Готово').props.disabled, true);
  await act(async () => h.button('Готово').props.onPress());
  assert.equal(h.saves.length, 0, 'a resolved taxi fallback is not the saved food destination');
  await act(async () => geocode.resolve([]));
  assert.equal(h.button('Готово').props.disabled, true, 'an empty lookup must require an explicit address choice');
  await act(async () => h.button('Готово').props.onPress());
  assert.equal(h.saves.length, 0);
  await act(async () => h.map.onSelectionInteraction('move'));
  const chosen = { point: { latitude: 42.9, longitude: 74.6 }, address: 'Адрес, выбранный на карте', ready: true, moving: false, locatingAddress: false };
  await h.select(chosen);
  assert.equal(h.button('Готово').props.disabled, false, 'a deliberate settled map choice can be saved');
  await act(async () => h.button('Готово').props.onPress());
  assert.equal(h.saves[0].address, chosen.address);
  assert.deepEqual(h.saves[0].addressPoint, chosen.point);
});

test('manual map selection invalidates an older GPS request from address search', async t => {
  const gps = deferred();
  const h = await mount(t, { position: gps.promise });
  await h.press('Найти адрес');
  await act(async () => { h.search.onLocation(); h.search.onClose(); });
  await act(async () => h.map.onSelectionInteraction('move'));
  const chosen = { point: { latitude: 42.89, longitude: 74.59 }, address: 'Вручную выбранный адрес', ready: true, moving: false, locatingAddress: false };
  await h.select(chosen);
  const focusBeforeGps = h.map.focusPoint;
  await act(async () => gps.resolve({ latitude: 42.8, longitude: 74.5, address: 'Устаревший GPS' }));
  assert.equal(h.map.focusPoint, focusBeforeGps, 'the old GPS result must not move the camera away from the user choice');
  await act(async () => h.button('Готово').props.onPress());
  assert.equal(h.saves[0].address, chosen.address);
  assert.deepEqual(h.saves[0].addressPoint, chosen.point);
});
