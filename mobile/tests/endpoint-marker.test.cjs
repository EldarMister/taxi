const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const filename = path.join(__dirname, '../src/native/EndpointMarker.tsx');
const flatStyle = style => Object.assign({}, ...[style].flat().filter(Boolean));
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;

async function mount(t, initial = {}) {
  const frames = new Map();
  let nextFrame = 0, refreshes = 0, renderer, resolveFont;
  let props = { id: 'pickup', field: 'pickup', point: { latitude: 42.87, longitude: 74.57 }, dark: false, language: 'ru', pickupEtaMinutes: 6, metrics: { label: 'Подача', value: '6 мин' }, ...initial };
  const font = new Promise(resolve => { resolveFont = resolve; });
  const Annotation = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ refresh: () => refreshes++ }), []);
    return React.createElement('PointAnnotation', props, props.children);
  });
  const exported = {};
  vm.runInNewContext(compiled, { exports: exported,
    requestAnimationFrame: fn => { const id = ++nextFrame; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return { View: 'View', Text: 'Text', StyleSheet: { create: styles => styles } };
      if (id === '@expo/vector-icons') return { Ionicons: { loadFont: () => font } };
      if (id === '@maplibre/maplibre-react-native') return { PointAnnotation: Annotation };
      if (id === '../ui') return { PickupIcon: 'PickupIcon', Icon: 'Icon', colors: { blue: '#087FFF', ink: '#101D38' }, tr: () => s => s };
      throw Error(id);
    },
  });
  await act(async () => { renderer = create(React.createElement(exported.EndpointMarker, props)); });
  const update = async patch => { props = { ...props, ...patch }; await act(async () => renderer.update(React.createElement(exported.EndpointMarker, props))); };
  const flushFrame = async () => { const due = [...frames.values()]; frames.clear(); await act(async () => { due.forEach(fn => fn()); }); };
  const flush = async () => { await flushFrame(); await flushFrame(); };
  const native = () => renderer.root.findByType('PointAnnotation');
  const texts = () => native().findAllByType('Text').map(node => node.children.join(''));
  const bitmap = () => native().findByProps({ testID: `${props.field}-endpoint-bitmap` });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(frames.size, 0, 'unmount cancels pending bitmap work'); });
  return { renderer, native, bitmap, texts, update, frames, flush, flushFrame, fontLoaded: async () => { await act(async () => resolveFont()); }, get refreshes() { return refreshes; } };
}

test('presentation and text changes leave the exact ground coordinate and native annotation instance unchanged', async t => {
  const h = await mount(t);
  const annotation = h.native(), bounds = h.bitmap().props.style;
  const anchor = annotation.props.anchor;
  assert.equal(bounds.width, 360);
  assert.equal(bounds.height, 112);
  assert.equal(bounds.width * anchor.x, 130);
  assert.equal(bounds.height * anchor.y, 104);
  for (const presentation of ['compact', 'focused', 'detailed']) {
    await h.update({ presentation, metrics: { label: 'Подача', value: 'Нет машин' } });
    assert.equal(h.native(), annotation);
    assert.equal(h.bitmap().props.style, bounds);
    assert.equal(h.native().props.anchor, anchor);
    assert.deepEqual([...h.native().props.coordinate], [74.57, 42.87]);
    const shadow = h.native().findByProps({ testID: 'pickup-endpoint-shadow' }).props.style;
    const stem = h.native().findByProps({ testID: 'pickup-endpoint-stem' }).props.style[0];
    assert.equal(shadow.left + shadow.width / 2, bounds.width * anchor.x);
    assert.equal(shadow.top + shadow.height / 2, bounds.height * anchor.y);
    assert.equal(stem.top + stem.height, bounds.height * anchor.y);
  }
});

test('cached bitmap refreshes after new ETA, fare or font content, without refreshing for geographic changes', async t => {
  const h = await mount(t);
  assert.equal(h.refreshes, 0, 'wait for the native commit');
  await h.flushFrame();
  assert.equal(h.refreshes, 0);
  await h.flushFrame();
  assert.equal(h.refreshes, 1);
  await h.update({ point: { latitude: 42.88, longitude: 74.58 } });
  assert.equal(h.frames.size, 0, 'coordinate updates are handled directly by native MapLibre');
  assert.deepEqual([...h.native().props.coordinate], [74.58, 42.88]);
  await h.update({ metrics: { label: 'Подача', value: '10 мин' } });
  assert.ok(h.texts().includes('10 мин'));
  await h.flush();
  assert.equal(h.refreshes, 2, 'fixed-size content changes still update the bitmap');
  await h.fontLoaded();
  await h.flush();
  assert.equal(h.refreshes, 3, 'a font completing after layout must not leave a blank cached flag');
  await act(async () => h.native().findAllByType('Text')[0].props.onTextLayout());
  await h.flush();
  assert.equal(h.refreshes, 4, 'native text reflow also refreshes the snapshot');
});

test('compact pickup uses truthful rounded ETA and a focused bubble offers edit through the native selection callback', async t => {
  let focused = 0, edited = 0;
  const h = await mount(t, { presentation: 'compact', pickupEtaMinutes: 5.3, onPress: () => focused++, onEdit: () => edited++ });
  assert.deepEqual(h.texts(), ['6', 'мин']);
  assert.equal(h.native().findAllByType('PickupIcon').length, 0);
  await act(async () => h.native().props.onSelected({}));
  assert.equal(focused, 1);
  assert.equal(edited, 0);
  await h.update({ presentation: 'focused' });
  assert.ok(h.texts().includes('Место подачи ›'));
  assert.ok(h.texts().includes('Изменить'));
  await act(async () => h.native().props.onSelected({}));
  assert.equal(focused, 1);
  assert.equal(edited, 1);
  await h.update({ presentation: 'detailed' });
  assert.equal(h.native().findAllByType('PickupIcon').length, 1);
  assert.equal(h.native().findByProps({ testID: 'pickup-endpoint-icon' }).props.style[0].backgroundColor, '#087FFF');
});

test('missing ETA keeps the pickup icon, and driver route distance/duration remain readable in one native endpoint', async t => {
  const h = await mount(t, { presentation: 'compact', pickupEtaMinutes: null });
  assert.equal(h.native().findAllByType('PickupIcon').length, 1);
  assert.deepEqual(h.texts(), []);
  await h.update({ pickupEtaMinutes: Number.NaN });
  assert.equal(h.native().findAllByType('PickupIcon').length, 1);
  await h.update({ id: 'dropoff', field: 'dropoff', presentation: 'detailed', appearance: 'driver', routeLabel: '44 км · 1 ч 10 мин', metrics: null });
  assert.deepEqual(h.texts(), ['Б', '44 км', '1 ч 10 мин']);
  assert.equal(h.native().findAllByType('Icon').length, 0, 'driver route keeps its original letter instead of the passenger flag');
  const icon = () => h.native().findByProps({ testID: 'dropoff-endpoint-icon' });
  const letter = () => h.native().findByProps({ testID: 'driver-dropoff-letter' });
  assert.equal(icon().props.style[1].backgroundColor, '#246BFD');
  assert.equal(letter().props.style[0].color, '#FFFFFF');
  const anchor = h.native().props.anchor, bounds = h.bitmap().props.style;
  await h.update({ dark: true });
  assert.equal(icon().props.style[2].backgroundColor, '#FFFFFF');
  assert.equal(letter().props.style[1].color, '#101010');
  assert.equal(h.native().props.anchor, anchor);
  assert.equal(h.bitmap().props.style, bounds);
  assert.equal(h.native().props.draggable, false, 'committed coordinates are not draggable native overlays');
});

test('unmount cancels in-flight refresh frames and a late font load cannot schedule stale work', async t => {
  const h = await mount(t);
  await h.flushFrame();
  assert.equal(h.frames.size, 1);
  await act(async () => h.renderer.unmount());
  assert.equal(h.frames.size, 0);
  await h.fontLoaded();
  assert.equal(h.frames.size, 0);
  assert.equal(h.refreshes, 0);
});

test('focused bubble centers over its fixed ground and fits even a 320dp viewport', async t => {
  const h = await mount(t, { presentation: 'detailed' });
  const groundX = h.bitmap().props.style.width * h.native().props.anchor.x;
  const head = () => Object.assign({}, ...h.native().findByProps({ testID: 'pickup-endpoint-head' }).props.style.filter(Boolean));
  assert.equal(head().left + 44 / 2, groundX, 'normal icon remains directly above the endpoint');
  await h.update({ presentation: 'focused' });
  const measuredWidth = 184;
  await act(async () => h.native().findByProps({ testID: 'pickup-endpoint-head' }).props.onLayout({ nativeEvent: { layout: { width: measuredWidth } } }));
  assert.equal(head().left + measuredWidth / 2, groundX, 'focused bubble centers the whole block above the endpoint');
  for (const viewportWidth of [320, 360, 412]) {
    const geographicScreenX = viewportWidth / 2;
    const left = geographicScreenX + head().left - groundX;
    const right = left + measuredWidth;
    assert.ok(left - 4 >= 0 && right + 4 <= viewportWidth, `focused bubble and its halo fit ${viewportWidth}dp`);
  }
  await h.update({ presentation: 'compact' });
  assert.equal(head().left + 44 / 2, groundX, 'compact icon returns without moving the geographic ground');
});


test('both passenger endpoints restore white icons and black content at night, including ETA-only pickup', async t => {
  const h = await mount(t);
  const anchor = h.native().props.anchor;
  for (const field of ['pickup', 'dropoff']) {
    await h.update({ field, dark: true, presentation: 'detailed' });
    const icon = h.native().findByProps({ testID: field + '-endpoint-icon' });
    assert.equal(flatStyle(icon.props.style).backgroundColor, '#FFFFFF');
    const glyph = icon.findByType(field === 'pickup' ? 'PickupIcon' : 'Icon');
    assert.equal(glyph.props.color, '#101010');
    assert.equal(h.native().props.anchor, anchor);
  }
  await h.update({ field: 'pickup', presentation: 'compact' });
  const icon = h.native().findByProps({ testID: 'pickup-endpoint-icon' });
  assert.deepEqual(icon.findAllByType('Text').map(node => node.children.join('')), ['6', 'мин']);
  assert.ok(icon.findAllByType('Text').every(node => flatStyle(node.props.style).color === '#101010'));
});

test('driver letters persist after offer metrics disappear and do not turn into ETA or passenger icons', async t => {
  const h = await mount(t, { appearance: 'driver', presentation: 'compact' });
  assert.equal(h.native().findByProps({ testID: 'driver-pickup-letter' }).children.join(''), 'А');
  assert.equal(h.native().findAllByType('PickupIcon').length, 0);
  await h.update({ field: 'dropoff', routeLabel: '1 км · 2 мин' });
  assert.equal(h.native().findByProps({ testID: 'driver-dropoff-letter' }).children.join(''), 'Б');
  await h.update({ routeLabel: undefined, metrics: null, dark: true });
  assert.deepEqual(h.texts(), ['Б']);
  assert.equal(flatStyle(h.native().findByProps({ testID: 'driver-dropoff-letter' }).props.style).color, '#101010');
});


test('a completed style reload refreshes the current bitmap without remounting or moving the endpoint', async t => {
  const h = await mount(t);
  await h.flush();
  const native = h.native(), anchor = native.props.anchor;
  const before = h.refreshes;
  await h.update({ styleRevision: 1 });
  await h.flush();
  assert.equal(h.refreshes, before + 1);
  assert.equal(h.native(), native);
  assert.equal(h.native().props.anchor, anchor);
  await h.update({ styleRevision: 1 });
  assert.equal(h.frames.size, 0, 'ordinary renders do not trigger refresh work');
});
