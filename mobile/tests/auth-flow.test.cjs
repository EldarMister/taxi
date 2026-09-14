// Render the real screen with React hooks. Only native views, shared visual
// components and the network boundary are replaced; transitions remain real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = fs.readFileSync(path.join(__dirname, '../src/AuthScreen.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const textOf = node => typeof node === 'string' || typeof node === 'number'
  ? String(node) : (node?.children || []).map(textOf).join(' ');

async function setup(t, options = {}) {
  const calls = [], logins = [], intervals = new Map(), timeouts = new Map(), backHandlers = new Set(), keyboardHandlers = new Map(), motionHandlers = new Set(), animations = [];
  let clock = 1000000, timerId = 0, renderer;
  class TestDate extends Date { static now() { return clock; } }
  const native = {
    BackHandler: { addEventListener: (_, handler) => {
      backHandlers.add(handler); return { remove: () => backHandlers.delete(handler) };
    } },
    Keyboard: { dismiss() {}, addListener: (event, callback) => { keyboardHandlers.set(event, callback); return { remove: () => keyboardHandlers.delete(event) }; } },
    AccessibilityInfo: {
      isReduceMotionEnabled: async () => options.reducedMotion ?? true,
      addEventListener: (_, callback) => { motionHandlers.add(callback); return { remove: () => motionHandlers.delete(callback) }; },
    },
    Animated: {
      View: 'AnimatedView', Text: 'AnimatedText',
      Value: class { constructor(value) { this.value = value; } setValue(value) { this.value = value; } stopAnimation() {} interpolate({ outputRange }) { return outputRange[this.value ? outputRange.length - 1 : 0]; } },
      timing: (value, config) => { animations.push(config); return { start: cb => { value.setValue(config.toValue); cb?.({ finished: true }); }, stop() {} }; },
      spring: (value, config) => { animations.push(config); return { start: cb => { value.setValue(config.toValue); cb?.({ finished: true }); }, stop() {} }; },
      parallel: children => ({ start: () => children.forEach(child => child.start()), stop: () => children.forEach(child => child.stop()) }),
      sequence: children => ({ start: () => children.forEach(child => child.start()), stop: () => children.forEach(child => child.stop()) }),
    },
    Linking: { openURL: async () => {} }, Platform: { OS: options.platform || 'android' },
    StyleSheet: { create: styles => styles, absoluteFillObject: {} },
    useWindowDimensions: () => ({ width: 390, height: 844 }),
    ...Object.fromEntries(['ActivityIndicator', 'Image', 'KeyboardAvoidingView', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map(name => [name, name])),
  };
  const ui = {
    ...Object.fromEntries(['CityArt', 'Icon', 'IconButton', 'Logo'].map(name => [name, name])),
    Button: props => React.createElement('Button', { ...props, disabled: !!(props.disabled || props.busy) }),
    colors: { blue: '#007AFF', muted: '#7D8DA5', ink: '#102039', danger: '#D33445', line: '#DDD' },
    s: { row: {} }, tr: () => value => value,
  };
  const theme = { useTheme: () => ({ isDark: !!options.dark }) };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, process: { env: {} }, Date: TestDate,
    setInterval: callback => { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval: id => intervals.delete(id),
    setTimeout: (callback, delay) => { const id = ++timerId; timeouts.set(id, { callback, deadline: clock + delay }); return id; },
    clearTimeout: id => timeouts.delete(id),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) };
      if (id === './auth/AuthMotion') {
        const motionExports = {};
        const motion = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/auth/AuthMotion.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
        vm.runInNewContext(motion, { exports: motionExports, require: dependency => dependency === 'react-native' ? native : dependency === '../ui' ? ui : dependency === '../design/theme' ? theme : require(dependency) });
        return motionExports;
      }
      if (id === './design/theme') return theme;
      if (id === './ui') return ui;
      if (id.endsWith('.png')) return id;
      if (id === './api') return {
        api: { post: async (endpoint, body) => {
          calls.push({ endpoint, body: JSON.parse(JSON.stringify(body)) });
          return options.post ? options.post(endpoint, body) : { retryAfterSeconds: 60 };
        } },
        messageOf: error => error.message,
      };
      throw new Error(`Unexpected dependency ${id}`);
    },
  }, { filename: 'AuthScreen.tsx' });
  await act(async () => {
    renderer = create(React.createElement(exports.AuthScreen, { onLogin: async (session, language) => {
      logins.push({ session, language });
      if (options.onLogin) await options.onLogin(session, language);
    } }), { createNodeMock: () => ({ focus() {}, blur() {}, scrollTo() {} }) });
  });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(intervals.size, 0); assert.equal(timeouts.size, 0); assert.equal(backHandlers.size, 0); assert.equal(keyboardHandlers.size, 0); assert.equal(motionHandlers.size, 0); });
  const h = {
    calls, logins, animations, renderer,
    hasInput: id => renderer.root.findAllByProps({ testID: id }).length > 0,
    input: id => renderer.root.findByProps({ testID: id }),
    button: () => renderer.root.findByType('Button'),
    buttons: () => renderer.root.findAllByType('Button'),
    codeCells: () => renderer.root.find(node => node.type?.name === 'CodeCells').props,
    keyboardAvoider: () => renderer.root.findByType('KeyboardAvoidingView'),
    text: () => textOf(renderer.toJSON()),
    pressable: label => renderer.root.findAllByType('Pressable').find(node => textOf(node).includes(label)),
    change: async (id, value) => act(async () => h.input(id).props.onChangeText(value)),
    submit: async () => {
      const button = h.button(); assert.equal(button.props.disabled, false, 'Continue must be enabled');
      await act(async () => button.props.onPress());
    },
    press: async label => {
      const node = h.pressable(label); assert.ok(node, `Missing button: ${label}`);
      assert.notEqual(node.props.disabled, true, `Button disabled: ${label}`);
      await act(async () => node.props.onPress());
    },
    hardwareBack: async () => {
      assert.equal(backHandlers.size, 1);
      await act(async () => { assert.equal([...backHandlers][0](), true); });
    },
    advance: async seconds => act(async () => { clock += seconds * 1000; for (const callback of intervals.values()) callback(); for (const [id, timer] of timeouts) { if (timer.deadline <= clock) { timeouts.delete(id); timer.callback(); } } }),
    unmount: async () => act(async () => renderer.unmount()),
    keyboard: async visible => act(async () => keyboardHandlers.get(visible ? 'keyboardDidShow' : 'keyboardDidHide')?.()),
    reduceMotion: async value => act(async () => { for (const callback of motionHandlers) callback(value); }),
  };
  return h;
}

test('initial screen accepts only a complete national phone number and normalizes pasted international numbers', async t => {
  const h = await setup(t);
  assert.equal(h.hasInput('auth-phone'), true);
  assert.equal(h.hasInput('auth-code'), false);
  assert.equal(h.button().props.disabled, true);
  await h.change('auth-phone', '700 12x');
  assert.equal(h.input('auth-phone').props.value, '700 12');
  assert.equal(h.button().props.disabled, true);
  // Keyboard submission is guarded even when the native keyboard emits submit.
  await act(async () => h.input('auth-phone').props.onSubmitEditing());
  assert.equal(h.calls.length, 0);
  await h.change('auth-phone', '+996 (700) 123-456');
  assert.equal(h.input('auth-phone').props.value, '700 123 456');
  assert.equal(h.button().props.disabled, false);
  await h.submit();
  assert.deepEqual(h.calls, [{ endpoint: '/auth/request-code', body: { phone: '+996700123456' } }]);
});

test('dark login keeps phone and SMS code fields legible', async t => {
  const h = await setup(t, { dark: true });
  assert.equal(h.renderer.root.findByType('SafeAreaView').props.style[1].backgroundColor, '#050505');
  assert.equal(h.input('auth-phone').props.style[1].color, '#FFFFFF');
  assert.equal(h.renderer.root.findByType('Button').props.label, 'Продолжить');
  await h.change('auth-phone', '700123456');
  await h.submit();
  assert.equal(h.renderer.root.findByProps({ testID: 'auth-digit-0' }).props.style[1].backgroundColor, '#202020');
  assert.equal(h.renderer.root.findByType('SafeAreaView').props.style[1].backgroundColor, '#050505');
});

test('successful SMS request replaces the phone form with a separate code form', async t => {
  const pending = deferred();
  const h = await setup(t, { post: () => pending.promise });
  await h.change('auth-phone', '700123456');
  await h.submit();
  assert.equal(h.hasInput('auth-phone'), true);
  assert.equal(h.hasInput('auth-code'), false);
  assert.equal(h.input('auth-phone').props.editable, false);
  assert.equal(h.button().props.disabled, true);
  await act(async () => pending.resolve({ retryAfterSeconds: 45 }));
  assert.equal(h.hasInput('auth-phone'), false);
  assert.equal(h.hasInput('auth-code'), true);
  assert.match(h.text(), /Отправили SMS на номер/);
  assert.match(h.text(), /\+996 700 123 456/);
  assert.match(h.text(), /через 45 с/);
});

test('failed SMS request keeps the phone screen, displays the error and allows retry', async t => {
  let attempts = 0;
  const h = await setup(t, { post: async () => {
    if (++attempts === 1) throw new Error('Сервер временно недоступен');
    return { retryAfterSeconds: 60 };
  } });
  await h.change('auth-phone', '700123456');
  await h.submit();
  assert.equal(h.hasInput('auth-phone'), true);
  assert.equal(h.hasInput('auth-code'), false);
  assert.equal(h.input('auth-phone').props.value, '700 123 456');
  assert.match(h.text(), /Сервер временно недоступен/);
  assert.equal(h.button().props.disabled, false);
  await h.submit();
  assert.equal(h.hasInput('auth-code'), true);
  assert.doesNotMatch(h.text(), /Сервер временно недоступен/);
  assert.equal(h.calls.length, 2);
});

test('the sixth code digit automatically verifies and passes the session and selected language', async t => {
  const session = { accessToken: 'access', refreshToken: 'refresh', user: { id: 'client-1', role: 'CLIENT' } };
  const h = await setup(t, { post: async endpoint => endpoint.endsWith('verify-code') ? session : { retryAfterSeconds: 60 } });
  await h.press('KG');
  await h.change('auth-phone', '555123456');
  await h.submit();
  await h.change('auth-code', '12a34');
  assert.equal(h.input('auth-code').props.value, '1234');
  assert.equal(h.buttons().length, 0, 'The code step must not render a Continue button');
  await act(async () => h.input('auth-code').props.onSubmitEditing());
  assert.equal(h.calls.length, 1);
  await h.change('auth-code', '1234567');
  assert.equal(h.input('auth-code').props.value, '123456');
  assert.deepEqual(h.calls[1], { endpoint: '/auth/verify-code', body: { phone: '+996555123456', code: '123456' } });
  assert.deepEqual(h.logins, [{ session, language: 'ky' }]);
});

test('invalid verification stays on the code screen and editing clears the error before retry', async t => {
  let verifies = 0;
  const h = await setup(t, { post: async endpoint => {
    if (endpoint.endsWith('verify-code') && ++verifies === 1) throw new Error('Неверный код');
    return { retryAfterSeconds: 60, accessToken: 'verified' };
  } });
  await h.change('auth-phone', '700123456'); await h.submit();
  await h.change('auth-code', '111111');
  assert.equal(h.hasInput('auth-code'), true);
  assert.equal(h.hasInput('auth-phone'), false);
  assert.match(h.text(), /Неверный код/);
  assert.equal(h.logins.length, 0);
  await h.change('auth-code', '111111');
  assert.equal(verifies, 1, 'The same native value event must not retry without an edit');
  assert.match(h.text(), /Неверный код/, 'An unchanged value must not hide the verification error');
  await h.change('auth-code', '222222');
  assert.doesNotMatch(h.text(), /Неверный код/);
  assert.equal(h.logins.length, 1);
});

test('Android back retains the phone and reuses the pending SMS; changing the phone starts a new request', async t => {
  const h = await setup(t);
  await h.change('auth-phone', '700123456'); await h.submit();
  await h.change('auth-code', '123');
  await h.hardwareBack();
  assert.equal(h.hasInput('auth-code'), false);
  assert.equal(h.input('auth-phone').props.value, '700 123 456');
  await h.submit();
  assert.equal(h.hasInput('auth-phone'), false);
  assert.equal(h.input('auth-code').props.value, '');
  assert.equal(h.calls.length, 1, 'Returning to an unexpired SMS must not send another SMS');
  await h.press('Изменить номер телефона');
  await h.change('auth-phone', '555654321'); await h.submit();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[1].body, { phone: '+996555654321' });
  assert.match(h.text(), /\+996 555 654 321/);
});

test('resend remains blocked during the server cooldown and resets the code when sent again', async t => {
  const h = await setup(t, { post: async () => ({ retryAfterSeconds: 3 }) });
  await h.change('auth-phone', '700123456'); await h.submit();
  assert.equal(h.pressable('Отправить код ещё раз').props.disabled, true);
  await act(async () => h.pressable('Отправить код ещё раз').props.onPress());
  assert.equal(h.calls.length, 1, 'Cooldown guard must survive a duplicate/native press event');
  await h.advance(2);
  assert.match(h.text(), /через 1 с/);
  assert.equal(h.pressable('Отправить код ещё раз').props.disabled, true);
  await h.change('auth-code', '123');
  await h.advance(1);
  await h.press('Отправить ещё раз');
  assert.equal(h.calls.length, 2);
  assert.equal(h.input('auth-code').props.value, '');
  assert.match(h.text(), /через 3 с/);
});

test('rapid duplicate submissions issue only one request and cannot navigate back during verification', async t => {
  const send = deferred(), verify = deferred();
  const h = await setup(t, { post: endpoint => endpoint.endsWith('verify-code') ? verify.promise : send.promise });
  await h.change('auth-phone', '700123456');
  const pressSend = h.button().props.onPress;
  await act(async () => { pressSend(); pressSend(); });
  assert.equal(h.calls.length, 1);
  await act(async () => send.resolve({ retryAfterSeconds: 60 }));
  const enterCode = h.input('auth-code').props.onChangeText;
  await act(async () => { enterCode('123456'); enterCode('123456'); });
  assert.equal(h.calls.length, 2);
  assert.equal(h.input('auth-code').props.editable, false);
  await h.hardwareBack();
  assert.equal(h.hasInput('auth-code'), true);
  await act(async () => verify.resolve({ accessToken: 'access' }));
  assert.equal(h.logins.length, 1);
});

test('development code is labelled as a test login and is never shown without the development flag', async t => {
  let requests = 0;
  const h = await setup(t, { post: async () => ++requests === 1
    ? { retryAfterSeconds: 1, development: true, developmentCode: '654321' }
    : { retryAfterSeconds: 1, developmentCode: '999999' } });
  await h.change('auth-phone', '700123456'); await h.submit();
  assert.match(h.text(), /Тестовый вход для номера/);
  assert.match(h.text(), /Тестовый код.*654321/);
  assert.doesNotMatch(h.text(), /Отправили SMS/);
  await h.advance(1); await h.press('Отправить ещё раз');
  assert.doesNotMatch(h.text(), /654321|999999|Тестовый код/);
  assert.match(h.text(), /Отправили SMS на номер/);
});

test('Android auth keeps the code input focused without decorative artwork', async t => {
  const h = await setup(t);
  assert.equal(h.keyboardAvoider().props.behavior, 'padding');
  assert.equal(h.renderer.root.findAllByType('Image').length, 0);
  await h.change('auth-phone', '700123456'); await h.submit();
  assert.equal(h.renderer.root.findAllByType('Image').length, 0);
  assert.equal(h.input('auth-code').props.autoFocus, true);
  assert.equal(h.buttons().length, 0);
});

test('confirmation waits for the server, keeps actions locked during the success animation and then hands off once', async t => {
  const verify = deferred();
  const h = await setup(t, { reducedMotion: false, post: endpoint => endpoint.endsWith('verify-code') ? verify.promise : { retryAfterSeconds: 60 } });
  await h.change('auth-phone', '700123456'); await h.submit();
  await h.change('auth-code', '123456');
  assert.equal(h.input('auth-code').props.editable, false);
  assert.equal(h.codeCells().verified, false);
  assert.equal(h.logins.length, 0);
  await act(async () => verify.resolve({ accessToken: 'verified' }));
  assert.equal(h.codeCells().verified, true);
  assert.equal(h.logins.length, 0, 'The confirmed state must remain visible before navigation');
  assert.equal(h.input('auth-code').props.editable, false);
  await h.hardwareBack();
  await h.change('auth-code', '654321');
  assert.equal(h.input('auth-code').props.value, '123456');
  await h.advance(.36);
  assert.equal(h.logins.length, 1);
  assert.equal(h.calls.filter(call => call.endpoint.endsWith('verify-code')).length, 1);
});

test('leaving during verification never signs in from a late response', async t => {
  const verify = deferred();
  const h = await setup(t, { post: endpoint => endpoint.endsWith('verify-code') ? verify.promise : {} });
  await h.change('auth-phone', '700123456'); await h.submit();
  await h.change('auth-code', '123456');
  await h.unmount();
  await act(async () => verify.resolve({ accessToken: 'late-session' }));
  assert.equal(h.logins.length, 0);
});

test('leaving during the success animation cancels its timer and session handoff', async t => {
  const h = await setup(t, { reducedMotion: false, post: async () => ({ accessToken: 'verified' }) });
  await h.change('auth-phone', '700123456'); await h.submit();
  await h.change('auth-code', '123456');
  assert.equal(h.codeCells().verified, true);
  await h.unmount();
  await h.advance(1);
  assert.equal(h.logins.length, 0);
});

test('Reduce Motion changes apply without remounting and do not delay a successful login', async t => {
  const h = await setup(t, { reducedMotion: false, post: async () => ({ accessToken: 'verified' }) });
  await h.change('auth-phone', '700123456'); await h.submit();
  await h.reduceMotion(true);
  await h.change('auth-code', '123456');
  assert.equal(h.logins.length, 1, 'Reduced motion must skip the decorative handoff delay');
});
