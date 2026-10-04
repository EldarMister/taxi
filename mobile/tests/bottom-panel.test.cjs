const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Load the real hook and gesture callbacks; animations advance only when asked
// so deferred close delivery, interruptions and cancellations remain observable.
function panelHarness({ reduced = false, platform = 'android' } = {}) {
  const values = [], animations = [], keyboardListeners = new Map();
  const state = { closes: 0, keyboardDismisses: 0, back: null, frame: { y: 0, height: 914 },
    scrollFrame: { pageY: 200, pageX: 0, x: 0, y: 0, width: 412, height: 400 } };
  function shared(initial) {
    let value = initial;
    const object = { get: () => value, set(next) {
      if (next?.animation) {
        object.pending = { ...next, from: value }; animations.push(object.pending);
        if (next.config.duration === 0) object.step(1);
      } else { object.pending = null; value = typeof next === 'function' ? next(value) : next; }
    }, step(fraction) {
      const pending = object.pending;
      if (!pending) return;
      value = pending.from + (pending.to - pending.from) * fraction;
      if (fraction === 1) { object.pending = null; pending.callback?.(true); }
    } };
    values.push(object); return object;
  }
  const animated = { __esModule: true, default: { View: 'MotionView', ScrollView: 'MotionScrollView' },
    useSharedValue: initial => { const ref = React.useRef(); if (!ref.current) ref.current = shared(initial); return ref.current; },
    useAnimatedStyle: evaluate => ({ evaluate }), useAnimatedScrollHandler: handler => handler,
    useAnimatedRef: () => { const ref = React.useRef(); if (!ref.current) {
      const assign = value => { assign.current = value; }; assign.current = null; ref.current = assign;
    } return ref.current; },
    measure: () => state.scrollFrame,
    cancelAnimation: value => { const pending = value.pending; value.pending = null; pending?.callback?.(false); },
    runOnJS: callback => callback, Easing: { bezier: () => 'sheet-curve' },
    withSpring: (to, config, callback) => ({ animation: 'spring', to, config, callback }),
    withTiming: (to, config, callback) => ({ animation: 'timing', to, config, callback }),
  };
  function gesture(kind) {
    const handlers = {}, config = {}, result = { kind, handlers, config };
    for (const key of ['enabled', 'activeOffsetY', 'failOffsetX', 'manualActivation', 'blocksExternalGesture']) {
      result[key] = value => { config[key] = value; return result; };
    }
    for (const key of ['onStart', 'onUpdate', 'onEnd', 'onFinalize', 'onTouchesDown', 'onTouchesMove', 'onTouchesUp']) {
      result[key] = callback => { handlers[key] = callback; return result; };
    }
    return result;
  }
  const native = {
    View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView',
    BackHandler: { addEventListener(_event, listener) { state.back = listener; return { remove() { if (state.back === listener) state.back = null; } }; } },
    Keyboard: {
      dismiss: () => { state.keyboardDismisses++; },
      addListener(event, listener) { keyboardListeners.set(event, listener); return { remove() { if (keyboardListeners.get(event) === listener) keyboardListeners.delete(event); } }; },
    },
    Platform: { OS: platform }, StyleSheet: { create: styles => styles, absoluteFill: {}, absoluteFillObject: {} },
    useWindowDimensions: () => ({ width: 412, height: 914 }),
  };
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const exports = {}; cache.set(file, exports);
    vm.runInNewContext(code, { exports, require(id) {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-reanimated') return animated;
      if (id === 'react-native-gesture-handler') return { Gesture: { Pan: () => gesture('pan'), Native: () => gesture('native') }, GestureDetector: 'GestureDetector' };
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 20 }) };
      if (id === './design/motion') return { useMotionPreference: () => reduced };
      if (id === './design/theme') return { useTheme: () => ({ isDark: false, palette: { surface: '#fff', background: '#fff' } }) };
      if (id === './useSheetDragToClose') return load('useSheetDragToClose.ts');
      throw new Error('Unexpected import: ' + id);
    } });
    return exports;
  }
  const BottomPanel = load('BottomPanel.tsx').BottomPanel;
  let renderer, props, children;
  const h = { values, animations, state, keyboardListeners, BottomPanel,
    get renderer() { return renderer; }, get position() { return values[0]; },
    async mount(t, extra = {}, content = React.createElement('Child'), ready = true) {
      props = { onClose: () => { state.closes++; }, label: 'Закрыть', ...extra }; children = content;
      await act(async () => { renderer = create(React.createElement(BottomPanel, props, children), {
        createNodeMock: () => ({ measureInWindow: callback => callback(0, state.frame.y, 412, state.frame.height) }),
      }); });
      if (t) t.after(async () => { await h.unmount(); assert.equal(keyboardListeners.size, 0); assert.equal(state.back, null); });
      if (ready) { await h.layout(300); await h.step(1); }
      return h;
    },
    async update(extra) { props = { ...props, ...extra }; await act(async () => renderer.update(React.createElement(BottomPanel, props, children))); },
    async unmount() { if (!renderer) return; await act(async () => renderer.unmount()); renderer = null; },
    panel: () => renderer.root.findByProps({ testID: 'bottom-panel' }),
    area: () => renderer.root.findByProps({ testID: 'bottom-panel-drag-area' }),
    dock: () => renderer.root.findByProps({ testID: 'bottom-panel-dock' }),
    positionStyle: () => h.panel().props.style.at(-1).evaluate(),
    contentGesture: () => h.area().parent.props.gesture,
    handleGesture: () => renderer.root.findAllByType('GestureDetector').find(node => node.findAllByProps({ accessibilityLabel: 'Закрыть' }).length).props.gesture,
    async layout(height) { await act(async () => h.panel().props.onLayout({ nativeEvent: { layout: { height } } })); },
    async step(fraction) { await act(async () => h.position.step(fraction)); },
    async pressClose() { await act(async () => renderer.root.findAllByProps({ accessibilityLabel: 'Закрыть' })[0].props.onPress()); },
    async drag(distance, velocity = 0, end = true, success = true) {
      await act(async () => { const handlers = h.handleGesture().handlers; handlers.onStart({ translationY: 0 });
        handlers.onUpdate({ translationY: distance });
        if (end) { handlers.onEnd({ velocityY: velocity }, success); handlers.onFinalize(); }
      });
    },
    async touchContent(y, dx, dy, offset = 0) {
      const manager = { failed: 0, activated: 0, fail() { this.failed++; }, activate() { this.activated++; } };
      await act(async () => {
        const scroller = renderer.root.findAllByType('MotionScrollView')[0];
        if (scroller) scroller.props.onScroll({ contentOffset: { y: offset } });
        const handlers = h.contentGesture().handlers;
        handlers.onTouchesDown({ allTouches: [{ y, absoluteX: 20, absoluteY: 140 + y }] }, manager);
        if (!manager.failed) handlers.onTouchesMove({ allTouches: [{ y: y + dy, absoluteX: 20 + dx, absoluteY: 140 + y + dy }] }, manager);
      });
      return manager;
    },
  };
  return h;
}

test('Android keyboard overlap resets after hide and is not applied twice after native resize', async t => {
  const h = await panelHarness().mount(t);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.enabled, false);
  assert.equal(h.dock().props.style[1].paddingBottom, 0);
  await act(async () => h.keyboardListeners.get('keyboardDidShow')({ endCoordinates: { screenY: 590 } }));
  assert.equal(h.dock().props.style[1].paddingBottom, 332);
  h.state.frame.height = 590;
  await act(async () => h.renderer.root.findAllByType('View').find(node => node.props.onLayout).props.onLayout());
  assert.equal(h.dock().props.style[1].paddingBottom, 8);
  await act(async () => h.keyboardListeners.get('keyboardDidHide')());
  assert.equal(h.dock().props.style[1].paddingBottom, 0);
  await h.pressClose();
  assert.equal(h.state.keyboardDismisses, 1);
});

test('content-sized panel has its handle in a transparent strip outside the card', async t => {
  const h = await panelHarness().mount(t);
  const panelStyle = Object.assign({}, ...h.panel().props.style);
  const contentStyle = Object.assign({}, ...h.area().props.style);
  assert.equal(panelStyle.flex, undefined, 'compact sheets fit their measured children');
  assert.equal(panelStyle.backgroundColor, undefined, 'grabber strip adds no empty surface above the header');
  assert.equal(panelStyle.overflow, 'visible');
  assert.equal(contentStyle.paddingTop, undefined);
  assert.equal(contentStyle.backgroundColor, '#fff');
  assert.equal(contentStyle.minHeight, 0);
  const handle = h.renderer.root.findAllByType('View').find(node => node.props.style?.position === 'absolute');
  assert.equal(handle.props.style.top, 0);
  assert.equal(handle.props.style.height, panelStyle.paddingTop);
  assert.equal(h.area().findAllByProps({ accessibilityLabel: 'Закрыть' }).length, 0);
  assert.equal(h.positionStyle().transform[0].translateY, 0);
  assert.equal(h.values[1].get(), 324, 'travel follows measured content and its grabber');
  await h.update({ expanded: true });
  assert.equal(Object.assign({}, ...h.panel().props.style).flex, 1, 'full height remains an explicit opt-in');
});

test('backdrop and hardware back wait for exit and deliver onClose once', async t => {
  const h = await panelHarness().mount(t);
  await h.pressClose();
  assert.equal(h.state.closes, 0);
  assert.equal(h.animations.at(-1).animation, 'spring');
  assert.equal(h.animations.at(-1).to, 324);
  await h.step(.5); assert.equal(h.position.get(), 162);
  await h.pressClose();
  assert.equal(h.animations.filter(animation => animation.to === 324).length, 1);
  await h.step(1); assert.equal(h.state.closes, 1);
  await act(async () => { assert.equal(h.state.back(), true); });
  assert.equal(h.state.closes, 1);
  const back = await panelHarness().mount(t);
  await act(async () => { assert.equal(back.state.back(), true); });
  assert.equal(back.state.closes, 0);
  await back.step(1); assert.equal(back.state.closes, 1);
});

test('external close request waits for exit and repeated request is ignored', async t => {
  const h = await panelHarness().mount(t);
  await h.update({ closeRequested: true }); assert.equal(h.state.closes, 0);
  await h.update({ closeRequested: true }); await h.step(1);
  assert.equal(h.state.closes, 1);
});

test('close requested before measuring is not cancelled by the first opening transition', async t => {
  const h = await panelHarness().mount(t, { closeRequested: true }, React.createElement('Child'), false);
  assert.equal(h.state.closes, 0);
  await h.layout(300); await h.step(1);
  assert.equal(h.state.closes, 1);
});

test('drag follows the finger, reverses and restores after a partial pull or cancellation', async t => {
  const h = await panelHarness().mount(t);
  await h.drag(55, 0, false);
  assert.equal(h.position.get(), 55); assert.equal(h.positionStyle().transform[0].translateY, 55);
  await act(async () => h.handleGesture().handlers.onUpdate({ translationY: 20 }));
  assert.equal(h.position.get(), 20, 'reversal keeps its drag origin');
  await act(async () => { h.handleGesture().handlers.onEnd({ velocityY: 0 }, true); h.handleGesture().handlers.onFinalize(); });
  assert.equal(h.animations.at(-1).to, 0); await h.step(1); assert.equal(h.state.closes, 0);
  await h.drag(180, 1200, true, false);
  assert.equal(h.animations.at(-1).to, 0, 'cancelled recognizer ignores distance and flick velocity');
  await h.step(1); assert.equal(h.state.closes, 0);
  await h.drag(-50, 0, false);
  assert.ok(h.position.get() < 0 && h.position.get() > -50, 'open edge resists the pull without breaking contact');
  await act(async () => h.handleGesture().handlers.onFinalize()); await h.step(1);
  assert.equal(h.position.get(), 0);
});

test('distance and fast flick dismiss while interruption starts at current spring position', async t => {
  const h = await panelHarness().mount(t);
  await h.drag(60); await h.step(.5); assert.equal(h.position.get(), 30);
  await h.drag(18, 1000, false); assert.equal(h.position.get(), 48, 'grabbing a settling sheet does not reset it');
  await act(async () => { h.handleGesture().handlers.onEnd({ velocityY: 1000 }, true); h.handleGesture().handlers.onFinalize(); });
  assert.equal(h.animations.at(-1).from, 48); assert.equal(h.animations.at(-1).to, 324);
  assert.equal(h.animations.at(-1).config.velocity, 1000);
  await h.step(1); assert.equal(h.state.closes, 1);
  const distance = await panelHarness().mount(t);
  await distance.drag(100); assert.equal(distance.animations.at(-1).to, 324, 'threshold follows content height');
  await distance.step(1); assert.equal(distance.state.closes, 1);
});

test('top content drags while lower body and scrolled content retain native scrolling', async t => {
  const scrollEvents = [];
  const scrollRef = React.createRef();
  let headerTaps = 0;
  const children = React.createElement('View', null, React.createElement('Pressable', { testID: 'header-action', onPress: () => { headerTaps++; } }),
    React.createElement('ScrollView', { ref: scrollRef, onScroll: event => scrollEvents.push(event.nativeEvent.contentOffset.y),
      keyboardShouldPersistTaps: 'handled', testID: 'content-scroll' }, React.createElement('Child')));
  const h = await panelHarness().mount(t, {}, children);
  assert.equal(h.renderer.root.findAllByType('ScrollView').length, 0);
  const scroll = h.renderer.root.findByType('MotionScrollView');
  assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled');
  assert.ok(scrollRef.current?.measureInWindow, 'caller ref still reaches the native scroller');
  assert.equal(scroll.parent.props.gesture.kind, 'native');
  assert.equal(h.contentGesture().config.blocksExternalGesture, scroll.parent.props.gesture);
  assert.equal(h.contentGesture().config.manualActivation, true);
  const upper = await h.touchContent(40, 0, 18);
  assert.equal(upper.activated, 1); assert.equal(upper.failed, 0);
  await act(async () => { const handlers = h.contentGesture().handlers; handlers.onStart({ translationY: 0 }); handlers.onUpdate({ translationY: 32 }); });
  assert.equal(h.position.get(), 32);
  await act(async () => h.contentGesture().handlers.onFinalize()); await h.step(1);
  assert.equal((await h.touchContent(220, 0, 30)).failed, 1, 'lower content stays with its native scroller');
  assert.equal((await h.touchContent(40, 20, 18)).failed, 1, 'horizontal controls are not captured');
  assert.equal((await h.touchContent(40, 0, -18)).failed, 1, 'upward motion scrolls the content');
  assert.equal((await h.touchContent(90, 0, 18, 30)).failed, 1, 'scrolled content does not become a close gesture');
  assert.equal((await h.touchContent(40, 0, 18, 30)).activated, 1, 'fixed header can be grabbed after its body is scrolled');
  h.state.scrollFrame.pageY = 400;
  assert.equal((await h.touchContent(140, 0, 18, 30)).activated, 1, 'all of a taller fixed header can be grabbed, beyond 128px');
  assert.ok(scrollEvents.includes(30), 'original onScroll remains connected');
  await act(async () => h.renderer.root.findByProps({ testID: 'header-action' }).props.onPress());
  assert.equal(headerTaps, 1, 'pressable header controls remain usable');
});

test('reduced motion restores and closes immediately without a spring', async t => {
  const h = await panelHarness({ reduced: true }).mount(t);
  assert.equal(h.position.get(), 0);
  await h.drag(35); assert.equal(h.position.get(), 0);
  await h.pressClose(); assert.equal(h.state.closes, 1);
  assert.equal(h.animations.at(-1).animation, 'timing');
  assert.equal(h.animations.at(-1).config.duration, 0);
  assert.equal(h.animations.some(animation => animation.animation === 'spring'), false);
});

test('embedded handle keeps the photo surface behind the grabber without changing other panels', async t => {
  const flatten = style => Object.assign({}, ...style.filter(Boolean));
  const h = await panelHarness().mount(t);
  assert.equal(flatten(h.panel().props.style).paddingTop, 24);
  assert.equal(flatten(h.area().props.style).paddingTop, undefined);
  await h.update({ handlePlacement: 'inside' });
  assert.equal(flatten(h.panel().props.style).paddingTop, 0);
  assert.equal(flatten(h.area().props.style).paddingTop, 24);
  assert.equal(flatten(h.area().props.style).backgroundColor, '#fff');
  await h.drag(40, 0, false);
  assert.equal(h.position.get(), 40, 'the embedded grabber still follows the finger');
});

test('iOS owns keyboard avoidance without Android keyboard listeners', async t => {
  const h = await panelHarness({ platform: 'ios' }).mount(t);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.enabled, true);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.behavior, 'padding');
  assert.equal(h.keyboardListeners.size, 0);
});

test('unmount cancels exit and queued completion cannot deliver a stale onClose', async () => {
  const h = await panelHarness().mount();
  await h.pressClose(); const queuedCompletion = h.position.pending.callback;
  await h.unmount();
  assert.equal(h.state.closes, 0); assert.equal(h.position.pending, null);
  await act(async () => queuedCompletion(true)); assert.equal(h.state.closes, 0);
  assert.equal(h.keyboardListeners.size, 0); assert.equal(h.state.back, null);
});

test('every BottomPanel caller hides its underlying accessibility tree', () => {
  const sourceRoot = path.resolve(__dirname, '../src');
  const sourceFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(absolute) : entry.name.endsWith('.tsx') ? [absolute] : [];
  });
  const callers = sourceFiles(sourceRoot)
    .filter(file => fs.readFileSync(file, 'utf8').includes('<BottomPanel'))
    .map(file => path.relative(sourceRoot, file).replaceAll('\\', '/'))
    .sort();
  assert.deepEqual(callers, [
    'AddressPicker.tsx',
    'BookingPanel.tsx',
    'ClientTripPanel.tsx',
    'DeliveryPanel.tsx',
    'DriverPanel.tsx',
    'Overlays.tsx',
    'food/CatalogScreens.tsx',
    'food/CheckoutScreens.tsx',
    'food/DeliveryInfoSheet.tsx',
    'food/FoodAddressPicker.tsx',
    'food/FoodFiltersSheet.tsx',
    'food/HomeScreen.tsx',
    'food/RestaurantReviewsSheet.tsx',
  ]);

  const expectations = [
    ['BookingPanel.tsx', 'accessibilityElementsHidden={surface !== \'summary\'}', "importantForAccessibility={surface === 'summary' ? 'auto' : 'no-hide-descendants'}"],
    ['ClientTripPanel.tsx', 'accessibilityElementsHidden={surface !== \'summary\'}', "importantForAccessibility={surface === 'summary' ? 'auto' : 'no-hide-descendants'}"],
    ['DeliveryPanel.tsx', 'accessibilityElementsHidden={surface !== null}', "importantForAccessibility={surface !== null ? 'no-hide-descendants' : 'auto'}"],
    ['DriverPanel.tsx', 'accessibilityElementsHidden={!!(confirmation || showComment)}', "importantForAccessibility={confirmation || showComment ? 'no-hide-descendants' : 'auto'}"],
    ['Overlays.tsx', 'accessibilityElementsHidden={attachmentOpen}', "importantForAccessibility={attachmentOpen ? 'no-hide-descendants' : 'auto'}"],
    ['food/CatalogScreens.tsx', 'accessibilityElementsHidden={showInfo || showReviews}', "importantForAccessibility={showInfo || showReviews ? 'no-hide-descendants' : 'auto'}"],
    ['food/CatalogScreens.tsx', 'accessibilityElementsHidden={filtersOpen}', "importantForAccessibility={filtersOpen ? 'no-hide-descendants' : 'auto'}"],
    ['food/CheckoutScreens.tsx', 'accessibilityElementsHidden={editingComment}', "importantForAccessibility={editingComment ? 'no-hide-descendants' : 'auto'}"],
    ['food/CheckoutScreens.tsx', 'accessibilityElementsHidden={!!editor}', "importantForAccessibility={editor ? 'no-hide-descendants' : 'auto'}"],
  ];
  for (const [file, hidden, android] of expectations) {
    const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
    assert.ok(source.includes(hidden), `${file} must hide the underlay from VoiceOver`);
    assert.ok(source.includes(android), `${file} must hide the underlay from TalkBack`);
  }

  const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
  assert.ok(app.includes('accessibilityElementsHidden={!!addressField}'));
  assert.ok(app.includes("importantForAccessibility={addressField ? 'no-hide-descendants' : 'auto'}"));
  assert.match(app, /<\/View>\s*<Modal[\s\S]*<AddressPicker/, 'the address picker must remain outside the hidden underlay');
});
