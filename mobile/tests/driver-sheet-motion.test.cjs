const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const React = require('react'), { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/DriverRideSheet.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
async function mount(t, stage, reduced = false) {
  const values = [], reactions = new Set(), animations = [], heights = [], expanded = [];
  let flushBusy = false;
  const flush = () => { if (flushBusy) return; flushBusy = true; for (const run of reactions) run(); flushBusy = false; };
  function shared(initial) {
    let value = initial;
    const object = { get: () => value, set: next => {
      if (next?.animation) { object.pending = { ...next, from: value }; animations.push(object.pending); }
      else { object.pending = null; value = typeof next === 'function' ? next(value) : next; flush(); }
    }, step(fraction) { const pending = object.pending; if (!pending) return;
      value = pending.from + (pending.to - pending.from) * fraction; flush();
      if (fraction === 1) { object.pending = null; pending.callback?.(true); }
    } }; values.push(object); return object;
  }
  const animated = { __esModule: true, default: { View: 'MotionView' },
    useSharedValue: initial => { const ref = React.useRef(); if (!ref.current) ref.current = shared(initial); return ref.current; },
    useAnimatedStyle: evaluate => ({ evaluate }),
    useAnimatedReaction: (prepare, react) => React.useEffect(() => { const run = () => react(prepare()); reactions.add(run); run(); return () => reactions.delete(run); }),
    cancelAnimation: value => { if (value.pending) value.pending.callback?.(false); value.pending = null; },
    runOnJS: fn => fn, Easing: { bezier: () => 'sheet' },
    withSpring: (to, config, callback) => ({ animation: 'spring', to, config, callback }),
    withTiming: (to, config, callback) => ({ animation: 'timing', to, config, callback }),
  };
  function pan() { const handlers = {}, config = {}; const gesture = { handlers, config };
    for (const key of ['enabled', 'activeOffsetY', 'failOffsetX']) gesture[key] = value => { config[key] = value; return gesture; };
    for (const key of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) gesture[key] = fn => { handlers[key] = fn; return gesture; };
    return gesture;
  }
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return { Pressable: 'Pressable', View: 'View', StyleSheet: { create: x => x } };
    if (id === 'react-native-reanimated') return animated;
    if (id === 'react-native-gesture-handler') return { Gesture: { Pan: pan }, GestureDetector: 'GestureDetector' };
    if (id === './design/motion') return { useMotionPreference: () => reduced };
    throw Error(id);
  } });
  const inset = shared(0), contacts = { calls: 0, chats: 0, actions: 0 }, detailsMounts = { count: 0 };
  function Details() { React.useEffect(() => { detailsMounts.count++; }, []); return React.createElement('Text', null, 'Route details'); }
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.DriverRideSheet, {
    header: React.createElement('View', null, React.createElement('Pressable', { testID: 'call', onPress: () => contacts.calls++ }), React.createElement('Pressable', { testID: 'chat', onPress: () => contacts.chats++ }), stage === 'ARRIVED' ? React.createElement('Text', { testID: 'timer' }, '0:47') : null),
    details: React.createElement(Details), footer: React.createElement('Pressable', { testID: 'confirm', onPress: () => contacts.actions++ }),
    compactDetails: stage === 'SEARCHING' ? React.createElement('Text', null, 'Tariff and fare') : undefined,
    style: {}, handleStyle: {}, handleLabel: open => open ? 'Close' : 'Open', onHeight: value => heights.push(value), onExpanded: value => expanded.push(value), inset,
  })); });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(reactions.size, 0); });
  const root = () => renderer.root.findByProps({ testID: 'driver-ride-sheet' });
  const clip = () => renderer.root.findAllByType('MotionView').find(node => node !== root() && node.props.onLayout);
  await act(async () => { root().props.onLayout({ nativeEvent: { layout: { height: 420 } } }); clip().props.onLayout({ nativeEvent: { layout: { height: 220 } } }); });
  if (stage === 'SEARCHING') await act(async () => renderer.root.findByProps({ testID: 'driver-sheet-compact-details' }).props.onLayout({ nativeEvent: { layout: { height: 44 } } }));
  const reveal = values[1]; // external inset was created before the component's shared values
  const gesture = () => renderer.root.findByType('GestureDetector').props.gesture;
  const tap = async id => act(async () => renderer.root.findByProps({ testID: id }).props.onPress());
  const step = async fraction => act(async () => reveal.step(fraction));
  const style = () => root().props.style.at(-1).evaluate();
  return { renderer, gesture, tap, step, style, reveal, inset, animations, heights, expanded, contacts, detailsMounts,
    async resize(total, details) { await act(async () => { root().props.onLayout({ nativeEvent: { layout: { height: total } } }); clip().props.onLayout({ nativeEvent: { layout: { height: details } } }); }); },
    async drag(dy, vy = 0, end = true) { await act(async () => { const h = gesture().handlers; h.onStart({ translationY: 0 }); h.onUpdate({ translationY: dy }); if (end) { h.onEnd({ velocityY: vy }); h.onFinalize(); } }); } };
}
test('full measured detail height becomes the expanded detent', async t => {
  const h = await mount(t, 'ARRIVED');
  await h.tap('driver-panel-handle'); await h.step(1);
  await h.resize(820, 620); await h.step(1);
  assert.equal(h.inset.get(), 820);
  assert.equal(h.style().transform[0].translateY, 0);
  assert.equal(h.detailsMounts.count, 1);
  await h.tap('driver-panel-handle'); await h.step(1);
  assert.equal(h.inset.get(), 200, 'closed height stays compact');
});
test('SEARCHING: fare swaps with full details while drag, reversal and footer follow the current position', async t => {
  const h = await mount(t, 'SEARCHING');
  assert.equal(h.inset.get(), 244, 'closed sheet includes the measured compact fare row');
  assert.equal(h.style().transform[0].translateY, 176);
  await h.drag(-65, 0, false);
  assert.equal(h.reveal.get(), 65, 'surface follows a slow finger before release');
  assert.equal(h.inset.get(), 309, 'map controls receive the same intermediate position');
  await act(async () => h.gesture().handlers.onUpdate({ translationY: -20 }));
  assert.equal(h.reveal.get(), 20, 'reversing the drag does not reset its origin');
  await act(async () => { h.gesture().handlers.onEnd({ velocityY: -1000 }); h.gesture().handlers.onFinalize(); });
  await h.step(.5);
  const midway = h.reveal.get();
  await h.tap('driver-panel-handle');
  assert.equal(h.animations.at(-1).from, midway, 'tap interrupts the spring at its current position');
  await h.step(1);
  assert.equal(h.inset.get(), 244);
  await h.tap('driver-panel-handle'); await h.step(1);
  assert.equal(h.inset.get(), 420);
  assert.equal(h.detailsMounts.count, 1, 'order details stay mounted across both positions');
  const detector = h.renderer.root.findByType('GestureDetector');
  assert.equal(detector.findAllByProps({ testID: 'confirm' }).length, 0, 'horizontal acceptance slider stays outside the vertical gesture');
  await h.tap('confirm'); assert.equal(h.contacts.actions, 1);
});
test('SEARCHING: reduced motion settles without a spring and preserves the compact fare row', async t => {
  const h = await mount(t, 'SEARCHING', true);
  await h.tap('driver-panel-handle');
  assert.equal(h.animations.at(-1).animation, 'timing');
  assert.equal(h.animations.at(-1).config.duration, 120);
  await h.step(1); assert.equal(h.inset.get(), 420);
  await h.tap('driver-panel-handle'); await h.step(1);
  assert.equal(h.inset.get(), 244);
  assert.equal(h.detailsMounts.count, 1);
});
for (const stage of ['ARRIVED', 'IN_PROGRESS']) {
  test(`${stage}: tap transitions, reversal and synchronized inset keep details mounted and controls usable`, async t => {
    const h = await mount(t, stage);
    assert.equal(h.inset.get(), 200); assert.equal(h.style().transform[0].translateY, 220);
    const handle = h.renderer.root.findByProps({ testID: 'driver-panel-handle' });
    assert.ok(Object.assign({}, ...handle.props.style).height >= 56 && handle.props.hitSlop.bottom > 0, 'handle has a generous touch and drag area');
    await h.tap('driver-panel-handle');
    assert.equal(h.animations.at(-1).animation, 'spring'); assert.equal(h.animations.at(-1).config.duration, 300);
    assert.equal(h.animations.at(-1).config.overshootClamping, true);
    await h.step(.4); assert.equal(h.reveal.get(), 88); assert.equal(h.inset.get(), 288);
    assert.equal(h.style().transform[0].translateY, 132);
    const footer = h.renderer.root.findAllByType('MotionView').at(-1);
    assert.equal(h.style().transform[0].translateY + footer.props.style.at(-1).evaluate().transform[0].translateY, 0, 'footer stays fixed as the surface moves');
    await h.tap('call'); await h.tap('chat'); await h.tap('confirm');
    await h.tap('driver-panel-handle'); assert.equal(h.animations.at(-1).from, 88, 'repeat tap reverses from current pose');
    await h.step(.5); assert.equal(h.reveal.get(), 44);
    await h.drag(-40, 0, false); assert.equal(h.reveal.get(), 84, 'drag interrupts without resetting the reveal');
    await act(async () => h.gesture().handlers.onUpdate({ translationY: 10 })); assert.equal(h.reveal.get(), 34, 'direction reversal tracks the same finger origin');
    await act(async () => { h.gesture().handlers.onEnd({ velocityY: 0 }); h.gesture().handlers.onFinalize(); });
    await h.step(1); assert.equal(h.inset.get(), 200);
    await h.tap('driver-panel-handle'); await h.step(1); assert.equal(h.inset.get(), 420);
    await h.tap('call'); await h.tap('chat'); await h.tap('confirm');
    assert.deepEqual(h.contacts, { calls: 2, chats: 2, actions: 2 });
    assert.equal(h.detailsMounts.count, 1, 'details never unmount during expansion');
    assert.equal(h.renderer.root.findAllByProps({ testID: 'timer' }).length, stage === 'ARRIVED' ? 1 : 0);
    const detector = h.renderer.root.findByType('GestureDetector');
    assert.equal(detector.findAllByProps({ testID: 'confirm' }).length, 0, 'slider is outside the vertical gesture');
    assert.deepEqual(Array.from(h.gesture().config.failOffsetX), [-10, 10]);
  });
  test(`${stage}: slow drags, short fast flicks and cancelled gestures settle by distance and speed`, async t => {
    const h = await mount(t, stage);
    await h.drag(-70); await h.step(1); assert.equal(h.inset.get(), 200);
    await h.drag(-140); await h.step(1); assert.equal(h.inset.get(), 420);
    await h.drag(140); await h.step(1); assert.equal(h.inset.get(), 200);
    await h.drag(-15, -1000); assert.equal(h.animations.at(-1).config.velocity, 1000); await h.step(1); assert.equal(h.inset.get(), 420);
    await h.drag(15, 1000); await h.step(1); assert.equal(h.inset.get(), 200);
    await h.drag(-140, 0, false); await act(async () => h.gesture().handlers.onFinalize()); await h.step(1); assert.equal(h.inset.get(), 420);
  });
  test(`${stage}: reduced motion uses a short non-spring transition`, async t => {
    const h = await mount(t, stage, true);
    await h.tap('driver-panel-handle'); assert.equal(h.animations.at(-1).animation, 'timing'); assert.equal(h.animations.at(-1).config.duration, 120);
    await h.step(1); assert.equal(h.inset.get(), 420);
    await h.tap('driver-panel-handle'); await h.step(1); assert.equal(h.inset.get(), 200);
  });
}
