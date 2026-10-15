const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const root = path.join(__dirname, '../src/registration');
function setup() {
  const cache = new Map(), secure = new Map(), Platform = { OS: 'android' };
  let focused = 0;
  const Picker = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ focus: () => { focused++; } }));
    return React.createElement('Picker', props, props.children);
  });
  Picker.Item = 'PickerItem';
  const palette = { surface: '#FFF', background: '#FBFBFD', ink: '#1E2028', muted: '#737B8C', line: '#DDE1EA', accent: '#3478F6' };
  const mocks = {
    'react-native': { View: 'View', Image: 'Image', Text: 'Text', TextInput: 'TextInput', Pressable: 'Pressable', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator', Platform, NativeModules: {}, Keyboard: { dismiss() {} },
      FlatList: p => React.createElement('VirtualList', p, p.data.length ? p.data.slice(0, p.initialNumToRender).map((item, index) => React.createElement(React.Fragment, { key: p.keyExtractor(item) }, p.renderItem({ item, index }))) : p.ListEmptyComponent),
      Modal: p => p.visible ? React.createElement('Modal', p, p.children) : null,
      StyleSheet: { create: s => s, hairlineWidth: .5, absoluteFill: {} }, useWindowDimensions: () => ({ width: 426, height: 924 }) },
    '@react-native-picker/picker': { Picker },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) },
    'react-native-gesture-handler': { GestureHandlerRootView: 'GestureHandlerRootView' },
    'expo-secure-store': { getItemAsync: async k => secure.get(k) ?? null, setItemAsync: async (k, v) => secure.set(k, v), deleteItemAsync: async k => secure.delete(k) },
  };
  function load(filename, overrides = {}) {
    filename = path.resolve(root, filename);
    const key = filename + (Object.keys(overrides).length ? ':form' : '');
    if (cache.has(key)) return cache.get(key).exports;
    const module = { exports: {} }; cache.set(key, module);
    const requireLocal = id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (mocks[id]) return mocks[id];
      if (overrides[id]) return overrides[id];
      if (id === './design') return { useRegistrationDesign: () => ({ palette, isDark: false }) };
      if (id === '../ui') return { Icon: 'Icon' };
      if (id === '../design/typography') return { fonts: { regular: 'Inter', semibold: 'InterSemiBold', bold: 'InterBold' } };
      if (id === '../auth/LocalizedText') return { LocalizedText: 'Text', translateInterfaceText: t => t };
      if (id === './components') return { SectionTitle: p => React.createElement('Text', null, p.title), FormInput: 'FormInput' };
      if (id === '../BottomPanel') return { BottomPanel: p => {
        React.useEffect(() => { if (p.closeRequested) p.onClose(); }, [p.closeRequested]);
        return React.createElement('BottomPanel', p, p.children);
      } };
      if (id.endsWith('.json')) return JSON.parse(fs.readFileSync(path.resolve(path.dirname(filename), id), 'utf8'));
      if (id.endsWith('.png')) return id;
      if (id.startsWith('.')) return load(path.resolve(path.dirname(filename), id + (path.extname(id) ? '' : fs.existsSync(path.resolve(path.dirname(filename), id + '.tsx')) ? '.tsx' : '.ts')), overrides);
      throw new Error('Unmocked ' + id);
    };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(code, { exports: module.exports, module, require: requireLocal, console, setTimeout, clearTimeout, Buffer, TextEncoder, TextDecoder });
    return module.exports;
  }
  return { load, Platform, NativeModules: mocks['react-native'].NativeModules, focused: () => focused };
}
const control = (renderer, label) => renderer.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === label);
const flush = async () => { await act(async () => { await Promise.resolve(); }); };

test('brand saves immediately; model is gated, resets on brand change and reopens directly', async () => {
  const env = setup();
  const { OnboardingVehicleForm } = env.load('OnboardingVehicleForm.tsx', { './VehicleSelectionSheet': { VehicleSelectionSheet: 'SelectionSheet' } });
  const { emptyVehicleDraft } = env.load('types.ts');
  let saved;
  function Harness() {
    const [vehicle, setVehicle] = React.useState(emptyVehicleDraft()); saved = vehicle;
    return React.createElement(OnboardingVehicleForm, { title: 'Автомобиль', description: '', vehicle, path: 'taxiVehicle', canEdit: () => true, onChange: value => setVehicle(v => ({ ...v, ...value })) });
  }
  let renderer; await act(async () => { renderer = create(React.createElement(Harness)); });
  assert.equal(control(renderer, 'Модель').props.disabled, true);
  await act(async () => control(renderer, 'Марка').props.onPress());
  await act(async () => renderer.root.findByType('SelectionSheet').props.onBrand('Toyota'));
  assert.equal(saved.brand, 'Toyota'); assert.equal(saved.model, '');
  assert.equal(renderer.root.findByType('SelectionSheet').props.kind, 'model');
  await act(async () => renderer.root.findByType('SelectionSheet').props.onClose());
  assert.equal(saved.brand, 'Toyota'); assert.equal(control(renderer, 'Модель').props.disabled, false);
  await act(async () => control(renderer, 'Модель').props.onPress());
  assert.equal(renderer.root.findByType('SelectionSheet').props.brand, 'Toyota');
  await act(async () => renderer.root.findByType('SelectionSheet').props.onSelect('Camry'));
  assert.equal(saved.model, 'Camry'); assert.equal(renderer.root.findAllByType('SelectionSheet').length, 0);
  await act(async () => control(renderer, 'Марка').props.onPress());
  await act(async () => renderer.root.findByType('SelectionSheet').props.onBrand('Honda'));
  assert.equal(saved.model, ''); assert.equal(saved.brand, 'Honda');
  await act(async () => renderer.root.findByType('SelectionSheet').props.onBack());
  assert.equal(renderer.root.findByType('SelectionSheet').props.kind, 'brand');
  await act(async () => renderer.unmount());
});

test('catalog search, brand-to-model query reset, color search and system Back', async () => {
  const env = setup(); const { VehicleSelectionSheet, loadVehicleCatalog } = env.load('VehicleSelectionSheet.tsx');
  const catalog = await loadVehicleCatalog();
  assert.ok(Object.keys(catalog).length > 80); assert.ok(catalog.Toyota.includes('Aqua'));
  assert.ok(catalog.Toyota.length >= 100); assert.ok(catalog.Honda.length >= 40);
  let closed = 0; const selections = [];
  const props = { kind: 'brand', brand: '', selected: '', onBrand: v => selections.push(v), onSelect: v => selections.push(v), onBack() {}, onClose: () => closed++ };
  let r; await act(async () => { r = create(React.createElement(VehicleSelectionSheet, props)); }); await flush();
  assert.ok(r.root.findByType('VirtualList').props.data.length > 100);
  assert.ok(r.root.findAllByType('Pressable').filter(n => n.props.accessibilityRole === 'radio').length <= 18);
  assert.equal(r.root.findAllByType('Pressable').some(n => n.props.accessibilityRole === 'link'), false);
  const popular = r.root.findAllByType('Pressable').filter(n => n.props.accessibilityRole === 'radio').slice(0, 18);
  const expectedPopular = ['Toyota', 'Honda', 'Hyundai', 'Kia', 'Chevrolet', 'Daewoo', 'BMW', 'Mercedes-Benz', 'Audi', 'Lada', 'Mazda', 'Lexus', 'Nissan', 'Volkswagen', 'GAZ', 'Volvo', 'Ford', 'Subaru'];
  const catalogRows = r.root.findByType('VirtualList').props.data;
  assert.deepEqual(Array.from(catalogRows.slice(1, catalogRows.findIndex(row => row.heading === 'Все')), row => row.value), expectedPopular);
  assert.deepEqual(popular.map(n => n.props.accessibilityLabel), expectedPopular.slice(0, popular.length));
  assert.ok(popular.every(n => n.findAllByType('Image').length === 1));
  assert.equal(popular[0].props.style({ pressed: false })[1].minHeight, 48);
  await act(async () => r.root.findByType('TextInput').props.onChangeText('ваз'));
  assert.ok(control(r, 'Lada'));
  await act(async () => r.root.findByType('TextInput').props.onChangeText('toyo'));
  assert.deepEqual(r.root.findAllByType('Pressable').filter(n => n.props.accessibilityRole === 'radio').map(n => n.props.accessibilityLabel), ['Toyota']);
  await act(async () => control(r, 'Toyota').props.onPress()); assert.deepEqual(selections, ['Toyota']);
  await act(async () => r.update(React.createElement(VehicleSelectionSheet, { ...props, kind: 'model', brand: 'Toyota' }))); await flush();
  assert.equal(r.root.findByType('TextInput').props.value, '');
  await act(async () => r.root.findByType('TextInput').props.onChangeText('cam'));
  assert.ok(control(r, 'Camry')); assert.equal(control(r, 'Civic'), undefined);
  await act(async () => r.update(React.createElement(VehicleSelectionSheet, { ...props, kind: 'color', selected: 'Белый' }))); await flush();
  await act(async () => r.root.findByType('TextInput').props.onChangeText('че'));
  assert.ok(control(r, 'Чёрный')); assert.equal(control(r, 'Белый'), undefined);
  await act(async () => r.root.findByType('TextInput').props.onChangeText('неизвестный цвет'));
  assert.equal(r.root.findAllByType('Pressable').filter(n => n.props.accessibilityRole === 'radio').length, 0);
  await act(async () => r.root.findByType('Modal').props.onRequestClose()); assert.equal(closed, 1);
  await act(async () => r.unmount());
});

test('numeric native presets preserve arbitrary saved values and allow manual entry without adding range limits', async () => {
  const env = setup(), { NativeNumberInput } = env.load('NativeNumberInput.tsx'), changes = [];
  let r; await act(async () => { r = create(React.createElement(NativeNumberInput, { label: 'Количество паллет', optional: true, value: '65', options: [0, 1, 2], onChange: value => changes.push(value) })); });
  const picker = r.root.findByType('Picker');
  assert.ok(picker.findAllByType('PickerItem').some(item => item.props.value === '65'));
  await act(async () => picker.props.onValueChange('__clear__')); assert.deepEqual(changes, ['']);
  await act(async () => picker.props.onValueChange('__manual__'));
  await act(async () => r.root.findByType('TextInput').props.onChangeText('100'));
  assert.deepEqual(changes, ['', '100']);
  await act(async () => r.unmount());
});

test('cargo uses a separate commercial catalog with Porter and Gazelle and excludes passenger models and tractors', async () => {
  const env = setup(), { VehicleSelectionSheet } = env.load('VehicleSelectionSheet.tsx');
  const props = { cargo: true, kind: 'brand', brand: '', selected: '', onBrand() {}, onSelect() {}, onBack() {}, onClose() {} };
  let r; await act(async () => { r = create(React.createElement(VehicleSelectionSheet, props)); }); await flush();
  const rows = r.root.findByType('VirtualList').props.data;
  assert.ok(rows.some(row => row.value === 'Hyundai')); assert.ok(rows.some(row => row.value === 'GAZ'));
  assert.equal(rows.some(row => ['Audi', 'BMW', 'Lexus'].includes(row.value)), false);
  for (const [brand, required, excluded] of [['Hyundai', 'Porter', 'Sonata'], ['GAZ', 'Газель', 'Волга'], ['Toyota', 'Dyna', 'Camry'], ['Mercedes-Benz', 'Sprinter', 'Actros']]) {
    await act(async () => r.update(React.createElement(VehicleSelectionSheet, { ...props, kind: 'model', brand })));
    const models = r.root.findByType('VirtualList').props.data.map(row => row.value);
    assert.ok(models.includes(required)); assert.equal(models.includes(excluded), false);
  }
  await act(async () => r.unmount());
});

test('native selectors only commit actual selections; cancellation keeps saved value', async () => {
  const env = setup(), { NativeSelect } = env.load('NativeSelect.tsx'), changes = [];
  const props = { title: 'Год выпуска', value: '2018', options: [{ value: '2018', label: '2018' }, { value: '2019', label: '2019' }], onChange: v => changes.push(v) };
  let r; await act(async () => { r = create(React.createElement(NativeSelect, props)); });
  await act(async () => control(r, 'Год выпуска: 2018').props.onPress()); assert.equal(env.focused(), 1);
  await act(async () => { r.root.findByType('Picker').props.onValueChange(''); r.root.findByType('Picker').props.onValueChange('2018'); }); assert.deepEqual(changes, []);
  await act(async () => r.root.findByType('Picker').props.onValueChange('2019')); assert.deepEqual(changes, ['2019']);
  await act(async () => r.unmount()); env.Platform.OS = 'ios'; changes.length = 0;
  await act(async () => { r = create(React.createElement(NativeSelect, props)); });
  await act(async () => control(r, 'Год выпуска: 2018').props.onPress());
  await act(async () => r.root.findByType('Picker').props.onValueChange('2019'));
  await act(async () => r.root.findByType('Modal').props.onRequestClose()); assert.deepEqual(changes, []);
  await act(async () => control(r, 'Год выпуска: 2018').props.onPress());
  assert.equal(r.root.findByType('Picker').props.selectedValue, '2018');
  await act(async () => r.unmount());
});

test('Android number wheel preserves cancellation, prevents duplicate dialogs, and commits region 11', async () => {
  const env = setup(), { NativeSelect } = env.load('NativeSelect.tsx'), { currentPlateRegions } = env.load('vehicleData.ts');
  const changes = [], opened = []; let resolve;
  env.NativeModules.AtlasNumberPicker = { open: (...args) => { opened.push(args); return new Promise(r => { resolve = r; }); } };
  let renderer; await act(async () => { renderer = create(React.createElement(NativeSelect, { title: 'Регион', value: '01', options: currentPlateRegions, onChange: next => changes.push(next) })); });
  await act(async () => { control(renderer, 'Регион: 01').props.onPress(); control(renderer, 'Регион: 01').props.onPress(); });
  assert.equal(opened.length, 1); assert.equal(env.focused(), 0);
  assert.equal(opened[0][1].at(-1), '11'); assert.equal(opened[0][3], '01');
  await act(async () => resolve(null)); assert.deepEqual(changes, []);
  await act(async () => control(renderer, 'Регион: 01').props.onPress());
  await act(async () => resolve('11')); assert.deepEqual(changes, ['11']);
  await act(async () => renderer.unmount());
});

test('both plate masks and leading zeroes survive the actual draft store', async () => {
  const env = setup(), data = env.load('vehicleData.ts'), types = env.load('types.ts'), storage = env.load('storage.ts');
  const current = { format: 'CURRENT', region: '01', digits: '007', series: 'AAA' };
  const legacy = { format: 'LEGACY', region: 'B', digits: '0007', series: 'AB' };
  for (const parts of [current, legacy]) {
    assert.equal(data.validPlate(parts), true);
    const app = types.emptyRegistrationApplication('ru'); app.roles = ['TAXI_DRIVER'];
    app.data.taxiVehicle.plate = parts; app.data.taxiVehicle.plateNumber = data.formatPlate(parts);
    await storage.writeRegistrationDraft('onboarding-test', app);
    const restored = await storage.readRegistrationDraft('onboarding-test');
    assert.equal(restored.data.taxiVehicle.plate.digits, parts.digits);
    assert.equal(data.formatPlate(data.readPlate(restored.data.taxiVehicle)), data.formatPlate(parts));
  }
  assert.equal(data.readPlate({ plateNumber: '01 007 AAA' }).digits, '007');
  assert.equal(data.readPlate({ plateNumber: 'B0007AB' }).digits, '0007');
  assert.equal(data.plateLetters('аБc-123'), 'AC');
  assert.equal(data.validPlate({ ...current, digits: '7' }), false);
  assert.equal(data.validPlate({ ...current, region: '00' }), false);
  assert.equal(data.validPlate({ ...current, region: '11' }), true);
  assert.equal(data.currentPlateRegions.at(-1).value, '11');
  assert.equal(data.switchPlate(legacy, 'CURRENT').digits, '');
  assert.equal(data.switchPlate(current, 'LEGACY').digits, '007');
  assert.equal(data.switchPlate(current, 'LEGACY').series, '');
  assert.equal(data.vehicleYearRange().maximum, new Date().getFullYear() + 1);
});
