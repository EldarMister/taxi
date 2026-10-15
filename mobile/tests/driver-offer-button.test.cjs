const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/DriverOfferAcceptButton.tsx'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;

async function mount(t, options = {}) {
  let now = Date.parse('2026-10-13T12:00:00Z'), nextTimer = 1, reduced = options.reduced ?? false;
  const timers = new Map(), listeners = new Set(), values = [], animations = [], calls = [];
  class Clock extends Date {
    constructor(...args) { if (args.length) super(...args); else super(now); }
    static now() { return now; }
  }
  const nativeState = { currentState: 'active', addEventListener: (_name, listener) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  } };
  function shared(initial) {
    let value = initial;
    const object = {
      pending: null,
      get() {
        const animation = object.pending;
        if (!animation) return value;
        const fraction = Math.max(0, Math.min(1, (now - animation.startedAt - animation.delay) / animation.config.duration));
        return animation.from + (animation.to - animation.from) * fraction;
      },
      set(next) {
        value = object.get();
        object.pending = null;
        if (next?.type) {
          const animation = next.type === 'delay' ? next.animation : next;
          object.pending = { ...animation, from: value, startedAt: now, delay: next.type === 'delay' ? next.delay : 0 };
          animations.push(object.pending);
        } else value = typeof next === 'function' ? next(value) : next;
      },
    };
    values.push(object);
    return object;
  }
  const animated = {
    __esModule: true, default: { View: 'MotionView' },
    useSharedValue: initial => { const ref = React.useRef(); if (!ref.current) ref.current = shared(initial); return ref.current; },
    useAnimatedStyle: evaluate => ({ evaluate }),
    cancelAnimation: value => value.set(value.get()),
    Easing: { linear: 'linear' }, ReduceMotion: { Never: 'never' },
    withTiming: (to, config) => ({ type: 'timing', to, config }),
    withDelay: (delay, animation) => ({ type: 'delay', delay, animation }),
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, Date: Clock,
    setTimeout: (callback, delay) => { const id = nextTimer++; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return { AppState: nativeState, Pressable: 'Pressable', View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: x => x, absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } } };
      if (id === 'react-native-reanimated') return animated;
      if (id === './design/motion') return { useMotionPreference: () => reduced };
      if (id === './design/theme') return { useTheme: () => ({ isDark: options.dark ?? false }) };
      if (id === './design/tokens') return { driverAction: { height: 72, inset: 4, bottomGap: 16 } };
      if (id === './ui') return { colors: { blue: '#087FFF' }, Icon: 'Icon', money: price => `${price} сом`, tr: language => text => text === 'Принять' ? language === 'en' ? 'Accept' : language === 'ky' ? 'Кабыл алуу' : text : text };
      throw Error(id);
    },
  });
  let props = {
    offer: { id: 'offer-one', status: 'SEARCHING', price: 250, createdAt: new Date(now - 180_000).toISOString(), searchExpiresAt: new Date(now + 30_000).toISOString(), ...options.offer },
    language: options.language ?? 'ru', busy: options.busy ?? false, onAccept: offer => { calls.push(offer); return options.onAccept?.(offer); },
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.DriverOfferAcceptButton, props)); });
  const button = () => renderer.root.findByProps({ testID: 'driver-offer-accept' });
  const fill = () => renderer.root.findByProps({ testID: 'driver-offer-countdown-fill' });
  const seconds = () => renderer.root.findByProps({ testID: 'driver-offer-seconds' }).props.children.join('');
  await act(async () => button().props.onLayout({ nativeEvent: { layout: { width: 360 } } }));
  t.after(async () => {
    await act(async () => renderer.unmount());
    assert.equal(timers.size, 0, 'unmount removes numeric tick');
    assert.equal(listeners.size, 0, 'unmount removes foreground listener');
    assert.equal(values[0].pending, null, 'unmount cancels the UI animation');
  });
  return {
    renderer, props: () => props, button, fill, seconds, values, animations, calls, timers, now: () => now,
    translation: () => Number(fill().props.style.at(-1).evaluate().transform[0].translateX.toFixed(6)),
    tap: async () => act(async () => button().props.onPress()),
    async update(next) { props = { ...props, ...next }; await act(async () => renderer.update(React.createElement(exports.DriverOfferAcceptButton, props))); },
    async setReduced(value) { reduced = value; await act(async () => renderer.update(React.createElement(exports.DriverOfferAcceptButton, props))); },
    async state(state) { nativeState.currentState = state; await act(async () => { for (const listener of listeners) listener(state); }); },
    stall(ms) { now += ms; },
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = Math.max(now, next[1].at); timers.delete(next[0]);
        await act(async () => next[1].callback());
      }
      now = target;
    },
  };
}

test('price and localized acceptance share a capsule that drains left on the UI thread', async t => {
  const h = await mount(t);
  assert.equal(h.seconds(), '30 с');
  assert.equal(h.renderer.root.findByProps({ testID: 'driver-offer-accept-price' }).props.children, '250 сом');
  assert.equal(h.button().props.accessibilityLabel, '250 сом · Принять');
  assert.equal(h.translation(), 0);
  assert.equal(h.animations.length, 1);
  assert.equal(h.animations[0].config.duration, 30_000);
  assert.equal(h.animations[0].config.easing, 'linear');
  await h.advance(15_000);
  assert.equal(h.seconds(), '15 с');
  assert.equal(h.translation(), -180, 'only the left half remains visible');
  assert.equal(h.animations.length, 1, 'JS numeral ticks do not restart the animation');
  await h.advance(15_000);
  assert.equal(h.seconds(), '0 с');
  assert.equal(h.translation(), -360);
  assert.equal(h.button().props.disabled, true);
  await h.tap(); assert.equal(h.calls.length, 0, 'expiry never dispatches acceptance or skip');
});

test('white button labels remain legible on the blue countdown fill', async t => {
  const h = await mount(t);
  const fillColor = h.fill().props.style[1].backgroundColor;
  const components = fillColor.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const luminance = components[0] * .2126 + components[1] * .7152 + components[2] * .0722;
  assert.ok(1.05 / (luminance + .05) >= 4.5, 'caption contrast meets the normal-text threshold');
});

test('rerenders preserve the absolute deadline, and a new offer or renewed deadline resynchronizes it', async t => {
  const h = await mount(t);
  await h.advance(9_000);
  await h.update({ offer: { ...h.props().offer, price: 390 }, language: 'en' });
  assert.equal(h.seconds(), '21 s');
  assert.equal(h.animations.length, 1);
  assert.equal(h.button().props.accessibilityLabel, '390 сом · Accept');
  await h.update({ offer: { ...h.props().offer, id: 'offer-two', searchExpiresAt: new Date(h.now() + 12_500).toISOString() } });
  assert.equal(h.seconds(), '13 s');
  assert.equal(h.animations.at(-1).config.duration, 12_500);
  assert.ok(Math.abs(h.translation() + 210) < .001);
  await h.advance(500); assert.equal(h.seconds(), '12 s');
  await h.update({ offer: { ...h.props().offer, searchExpiresAt: new Date(h.now() + 30_000).toISOString() } });
  assert.equal(h.seconds(), '30 s');
  assert.equal(h.translation(), 0);
  await h.update({ language: 'ky' });
  assert.match(h.button().props.accessibilityLabel, /Кабыл алуу/);
});

test('foreground return resumes elapsed time and an expired offer stays unacceptible even before a JS tick', async t => {
  const h = await mount(t);
  await h.advance(4_000);
  await h.state('background');
  assert.equal(h.timers.size, 0);
  assert.equal(h.values[0].pending, null);
  h.stall(18_000);
  await h.state('active');
  assert.equal(h.seconds(), '8 с');
  assert.equal(h.animations.at(-1).config.duration, 8_000);
  assert.equal(h.translation(), -264);
  h.stall(8_001);
  assert.equal(h.button().props.disabled, false, 'simulate a blocked JS thread with an old visual state');
  await h.tap(); assert.equal(h.calls.length, 0, 'press checks the actual deadline');
  await h.state('active');
  assert.equal(h.seconds(), '0 с');
  assert.equal(h.button().props.disabled, true);
  assert.equal(h.timers.size, 0);
});

test('a synchronous fence blocks double taps and busy completion permits retry until expiry', async t => {
  const h = await mount(t);
  await act(async () => { const onPress = h.button().props.onPress; onPress(); onPress(); });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0], h.props().offer);
  assert.equal(h.button().props.disabled, true);
  await h.update({ busy: true }); await h.tap(); assert.equal(h.calls.length, 1);
  await h.update({ busy: false });
  assert.equal(h.button().props.disabled, false);
  await h.tap(); assert.equal(h.calls.length, 2);
  await h.update({ busy: true });
  await h.advance(30_000);
  await h.update({ busy: false });
  await h.tap(); assert.equal(h.calls.length, 2, 'completion after expiry cannot retry');
});

test('fast async failures release the fence even if parent busy transitions are batched', async t => {
  const requests = [];
  const h = await mount(t, { onAccept: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) });
  await h.tap(); assert.equal(h.button().props.disabled, true);
  await act(async () => requests[0].reject(new Error('Network failure')));
  assert.equal(h.button().props.disabled, false);
  await h.tap(); assert.equal(h.calls.length, 2);
  await act(async () => requests[1].resolve());
  assert.equal(h.button().props.disabled, false, 'parent run also resolves after handling a failed request');
});

test('an old promise cannot release a newer request fence after a retry or offer replacement', async t => {
  const requests = [];
  const h = await mount(t, { onAccept: () => new Promise(resolve => requests.push(resolve)) });
  await h.tap();
  await h.update({ busy: true }); await h.update({ busy: false });
  await h.tap();
  await act(async () => requests[0]());
  assert.equal(h.button().props.disabled, true, 'only the current request may release its fence');
  await h.update({ offer: { ...h.props().offer, id: 'offer-two' } });
  await h.tap();
  await act(async () => requests[1]());
  assert.equal(h.button().props.disabled, true, 'old-offer settlement cannot release the new offer');
  await act(async () => requests[2]());
  assert.equal(h.button().props.disabled, false);
});

test('replaced offers release the tap fence and stale handlers cannot accept the old offer', async t => {
  const h = await mount(t);
  const oldPress = h.button().props.onPress;
  await h.tap();
  await h.update({ offer: { ...h.props().offer, id: 'offer-two' } });
  assert.equal(h.button().props.disabled, false);
  await act(async () => oldPress());
  assert.equal(h.calls.length, 1);
  await h.tap(); assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].id, 'offer-two');
});

test('reduced motion uses accurate once-per-second steps and preference changes preserve elapsed time', async t => {
  const h = await mount(t, { reduced: true });
  assert.equal(h.animations.length, 0);
  await h.advance(10_750);
  assert.equal(h.seconds(), '20 с');
  assert.equal(h.translation(), -120, 'reduced motion does not continuously translate');
  await h.advance(250);
  assert.equal(h.translation(), -132);
  await h.setReduced(false);
  assert.equal(h.animations.at(-1).config.duration, 19_000);
  await h.advance(1_500);
  assert.equal(h.translation(), -150);
  await h.setReduced(true);
  assert.equal(h.values[0].pending, null);
  assert.equal(h.translation(), -150);
  await h.advance(17_500);
  assert.equal(h.seconds(), '0 с');
  assert.equal(h.button().props.disabled, true);
});

for (const deadline of [undefined, 'invalid', '2026-10-13T11:59:59Z']) {
  test(`missing, malformed or expired deadline fails closed: ${deadline}`, async t => {
    const h = await mount(t, { offer: { searchExpiresAt: deadline } });
    assert.equal(h.seconds(), '0 с');
    assert.equal(h.button().props.disabled, true);
    assert.equal(h.animations.length, 0);
    assert.equal(h.timers.size, 0);
    await h.tap(); assert.equal(h.calls.length, 0);
  });
}

test('non-searching offers and busy parents cannot be accepted', async t => {
  const h = await mount(t, { busy: true });
  await h.tap(); assert.equal(h.calls.length, 0);
  await h.update({ busy: false, offer: { ...h.props().offer, status: 'ASSIGNED' } });
  assert.equal(h.button().props.disabled, true);
  await h.tap(); assert.equal(h.calls.length, 0);
});

test('a future deadline clamps at 30 seconds then drains at a constant rate', async t => {
  const h = await mount(t, { offer: { searchExpiresAt: '2026-10-13T12:00:45Z' } });
  assert.equal(h.seconds(), '30 с');
  assert.equal(h.animations.at(-1).delay, 15_000);
  await h.advance(15_000); assert.equal(h.translation(), 0);
  await h.advance(15_000); assert.equal(h.seconds(), '15 с'); assert.equal(h.translation(), -180);
  await h.advance(15_000); assert.equal(h.button().props.disabled, true);
});

test('a queued old tick cannot mutate the replacement offer or reschedule after unmount', async t => {
  const h = await mount(t);
  const oldTick = [...h.timers.values()][0].callback;
  await h.advance(5_000);
  await h.update({ offer: { ...h.props().offer, id: 'offer-two', searchExpiresAt: new Date(h.now() + 30_000).toISOString() } });
  const animationCount = h.animations.length;
  await act(async () => oldTick());
  assert.equal(h.seconds(), '30 с');
  assert.equal(h.translation(), 0);
  assert.equal(h.animations.length, animationCount);
  assert.equal(h.timers.size, 1);
  const queuedTick = [...h.timers.values()][0].callback;
  await act(async () => { h.renderer.unmount(); queuedTick(); });
  assert.equal(h.timers.size, 0);
  assert.equal(h.values[0].pending, null);
});
