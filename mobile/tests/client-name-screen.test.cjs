// Exercise the real form and keyboard container; only native views and the
// parent persistence callback are mocked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const textOf = node => typeof node === 'string' || typeof node === 'number'
  ? String(node) : (node?.children || []).map(textOf).join(' ');
const flattenStyle = style => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flattenStyle)) : style;

async function setup(t, options = {}) {
  const calls = [], backs = [], keyboardListeners = new Map(), backListeners = new Set(), frames = new Map(), focuses = [], scrolls = [], inputs = new Map();
  let renderer, serial = 0, focusedInput = null;
  let hostHeight = options.hostHeight ?? 616;
  const TextInput = React.forwardRef((props, ref) => {
    const node = {
      focus() { focuses.push(props.testID); focusedInput = node; props.onFocus?.(); },
      measureInWindow: callback => callback(20, props.testID === 'client-last-name' ? 460 : 260, 280, 58),
    };
    inputs.set(props.testID, node);
    React.useImperativeHandle(ref, () => node);
    return React.createElement('NativeInput', props);
  });
  TextInput.State = { currentlyFocusedInput: () => focusedInput };
  const native = {
    TextInput,
    Platform: { OS: options.platform || 'android' },
    StyleSheet: { create: styles => styles },
    Keyboard: {
      dismiss() {},
      addListener: (event, handler) => { keyboardListeners.set(event, handler); return { remove: () => keyboardListeners.delete(event) }; },
    },
    BackHandler: { addEventListener: (_, handler) => { backListeners.add(handler); return { remove: () => backListeners.delete(handler) }; } },
    ...Object.fromEntries(['ActivityIndicator', 'KeyboardAvoidingView', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name])),
  };
  const modules = new Map();
  function load(file) {
    const filename = path.join(__dirname, '../src', file);
    if (modules.has(filename)) return modules.get(filename);
    const exports = {};
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    modules.set(filename, exports);
    vm.runInNewContext(compiled, {
      exports,
      requestAnimationFrame: handler => { const id = ++serial; frames.set(id, handler); return id; },
      cancelAnimationFrame: id => frames.delete(id),
      require: dependency => {
        if (dependency === 'react' || dependency === 'react/jsx-runtime') return require(dependency);
        if (dependency === 'react-native') return native;
        if (dependency === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
        if (dependency === 'expo-status-bar') return { StatusBar: 'StatusBar' };
        if (dependency.endsWith('/design/theme')) return { useTheme: () => ({ isDark: !!options.dark, palette: {
          background: options.dark ? '#050505' : '#F4F8FD', elevated: options.dark ? '#1D1D1D' : '#F3F7FF',
          surface: options.dark ? '#111111' : '#FFFFFF', ink: options.dark ? '#FFFFFF' : '#101D38',
          muted: options.dark ? '#B0B0B0' : '#63718D', accent: options.dark ? '#FFFFFF' : '#087FFF',
          accentText: options.dark ? '#050505' : '#FFFFFF',
        } }) };
        if (dependency === './ui') return { Icon: 'Icon', tr: language => value => language === 'en' ? ({
          'Введите имя и фамилию': 'Enter your first and last name', 'Имя': 'First name', 'Фамилия': 'Last name',
          'Далее': 'Next', 'Назад': 'Back', 'Имя и фамилия вместе — не более 80 символов': 'Use at most 80 characters for your full name',
        }[value] || value) : value };
        if (dependency === './api') return { messageOf: error => error.message };
        if (dependency.startsWith('.')) {
          const resolved = path.relative(path.join(__dirname, '../src'), path.resolve(path.dirname(filename), dependency)).replaceAll('\\', '/');
          return load(fs.existsSync(path.join(__dirname, '../src', `${resolved}.tsx`)) ? `${resolved}.tsx` : `${resolved}.ts`);
        }
        throw new Error(`Unexpected dependency ${dependency}`);
      },
    }, { filename });
    return exports;
  }
  const { ClientNameScreen } = load('ClientNameScreen.tsx');
  const user = { id: 'client-id', phone: '+996700123456', role: 'CLIENT', language: 'ru', name: 'Пассажир', notifications: true, ...options.user };
  const props = {
    user,
    onBack: () => backs.push('back'),
    onSave: async (first, last) => { calls.push({ first, last }); await options.save?.(first, last); },
  };
  await act(async () => {
    renderer = create(React.createElement(ClientNameScreen, props), { createNodeMock: element => {
      if (element.type === 'View') return { measureInWindow: callback => callback(0, 24, 320, hostHeight) };
      if (element.type === 'ScrollView') return {
        scrollTo: args => scrolls.push(args),
        getNativeScrollRef: () => ({ measureInWindow: callback => callback(0, 110, 320, Math.max(0, hostHeight - 150)) }),
      };
      return null;
    } });
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    assert.equal(keyboardListeners.size, 0);
    assert.equal(backListeners.size, 0);
    assert.equal(frames.size, 0);
  });
  const h = {
    renderer, calls, backs, focuses, scrolls,
    input: name => renderer.root.findAllByType('NativeInput').find(node => node.props.testID === `client-${name}-name`),
    button: () => renderer.root.findByProps({ testID: 'client-name-continue' }),
    text: () => textOf(renderer.toJSON()),
    change: async (name, value) => act(async () => h.input(name).props.onChangeText(value)),
    submit: async () => act(async () => { h.button().props.onPress(); }),
    keyboardSubmit: async name => act(async () => h.input(name).props.onSubmitEditing()),
    hardwareBack: async () => act(async () => { assert.equal([...backListeners][0](), true); }),
    focus: async name => act(async () => { inputs.get(`client-${name}-name`).focus(); }),
    keyboard: async visible => act(async () => {
      keyboardListeners.get(visible ? options.platform === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow' : 'keyboardDidHide')?.({ endCoordinates: { screenY: 400 } });
    }),
    flushFrames: async () => act(async () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); }),
    resizeHost: async height => act(async () => { hostHeight = height; renderer.root.findAllByType('View').find(node => node.props.collapsable === false).props.onLayout(); }),
    changeTheme: async dark => act(async () => { options.dark = dark; renderer.update(React.createElement(ClientNameScreen, props)); }),
  };
  return h;
}

test('new client must enter both names, and legacy display name is never split into invented fields', async t => {
  const h = await setup(t, { user: { name: 'Александр Попов' } });
  assert.equal(h.input('first').props.value, '');
  assert.equal(h.input('last').props.value, '');
  assert.equal(h.input('first').props.accessibilityLabel, 'Имя');
  assert.equal(h.input('last').props.accessibilityLabel, 'Фамилия');
  assert.equal(h.button().props.disabled, true);
  await h.change('first', '  ');
  await h.change('last', 'Райымов');
  await h.keyboardSubmit('last');
  assert.equal(h.calls.length, 0);
  assert.match(h.text(), /Введите имя и фамилию/);
  await h.change('first', 'Элдар');
  assert.equal(h.button().props.disabled, false);
  await h.keyboardSubmit('first');
  assert.deepEqual(h.focuses, ['client-last-name']);
  await h.hardwareBack();
  assert.deepEqual(h.backs, ['back']);
});

test('structured names are prefilled, international characters accepted, and normalized before saving', async t => {
  const h = await setup(t, { user: { firstName: 'Элдар', lastName: 'Райымов' } });
  assert.equal(h.input('first').props.value, 'Элдар');
  assert.equal(h.input('last').props.value, 'Райымов');
  await h.change('first', '  Jean  Luc-李  ');
  await h.change('last', '  O’Neill  ');
  assert.equal(h.button().props.disabled, false);
  await h.submit();
  assert.deepEqual(h.calls, [{ first: 'Jean Luc-李', last: 'O’Neill' }]);
  assert.equal(h.button().props.disabled, true, 'a successful save must not be submitted again');
});

test('combined name length matches the API limit and allows exactly 80 characters', async t => {
  const h = await setup(t);
  await h.change('first', 'А'.repeat(41));
  await h.change('last', 'Б'.repeat(40));
  assert.equal(h.button().props.disabled, true);
  assert.match(h.text(), /не более 80 символов/);
  await h.keyboardSubmit('last');
  assert.equal(h.calls.length, 0);
  await h.change('last', 'Б'.repeat(38));
  assert.equal(h.button().props.disabled, false);
  await h.submit();
  assert.equal(`${h.calls[0].first} ${h.calls[0].last}`.length, 80);
});

test('double tap and keyboard submit during saving produce one request and block back navigation', async t => {
  const pending = deferred();
  const h = await setup(t, { user: { firstName: 'Элдар', lastName: 'Райымов' }, save: () => pending.promise });
  const press = h.button().props.onPress;
  const back = h.renderer.root.findByProps({ testID: 'client-name-back' }).props.onPress;
  await act(async () => { press(); press(); back(); });
  await h.keyboardSubmit('last');
  await h.hardwareBack();
  assert.equal(h.calls.length, 1);
  assert.equal(h.backs.length, 0);
  assert.equal(h.button().props.accessibilityState.busy, true);
  assert.equal(h.input('first').props.editable, false);
  assert.equal(h.input('last').props.editable, false);
  await act(async () => pending.resolve());
  assert.equal(h.button().props.disabled, true);
});

test('failed save retains names and allows a corrected retry', async t => {
  let attempt = 0;
  const h = await setup(t, { user: { firstName: 'Элдар', lastName: 'Райымов' }, save: async () => {
    if (++attempt === 1) throw new Error('Нет соединения');
  } });
  await h.submit();
  assert.match(h.text(), /Нет соединения/);
  assert.equal(h.button().props.disabled, false);
  assert.equal(h.input('last').props.value, 'Райымов');
  await h.change('last', 'Райымов-李');
  assert.doesNotMatch(h.text(), /Нет соединения/);
  await h.submit();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].last, 'Райымов-李');
});

test('theme changes preserve entered names and expose readable inputs and translated labels', async t => {
  const h = await setup(t, { user: { language: 'en' } });
  await h.change('first', 'Jean');
  assert.match(h.text(), /Enter your first and last name/);
  assert.equal(h.input('last').props.accessibilityLabel, 'Last name');
  assert.equal(h.input('first').props.keyboardAppearance, 'light');
  const lightInput = flattenStyle(h.input('first').props.style).color;
  await h.changeTheme(true);
  assert.equal(h.input('first').props.value, 'Jean');
  assert.equal(h.input('first').props.keyboardAppearance, 'dark');
  assert.notEqual(flattenStyle(h.input('first').props.style).color, lightInput);
  assert.equal(h.renderer.root.findByType('StatusBar').props.style, 'light');
  assert.notEqual(flattenStyle(h.input('first').props.style).color, flattenStyle(h.input('first').parent.parent.props.style)?.backgroundColor);
});

test('small Android keyboard reveals the last field and lifts the pinned footer only for remaining overlap', async t => {
  const h = await setup(t, { hostHeight: 616 });
  await h.focus('last');
  await h.keyboard(true);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.style.paddingBottom, 240);
  await h.flushFrames();
  assert.ok(h.scrolls.length > 0, 'offscreen focused surname must scroll into view');
  assert.ok(h.scrolls.at(-1).y > 0);
  // Android adjustResize has already reduced the host to end at the keyboard.
  await h.resizeHost(376);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.style.paddingBottom, 0);
  assert.equal(h.renderer.root.findByProps({ testID: 'client-name-footer' }).parent.type, 'KeyboardAvoidingView');
  await h.change('first', 'Элдар');
  await h.change('last', 'Райымов');
  assert.equal(h.button().props.disabled, false);
  await h.keyboard(false);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.style.paddingBottom, 0);
  await h.submit();
  assert.equal(h.calls.length, 1);
});

test('iOS uses keyboard avoidance without an Android overlap lift', async t => {
  const h = await setup(t, { platform: 'ios' });
  await h.focus('last');
  await h.keyboard(true);
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.behavior, 'padding');
  assert.equal(h.renderer.root.findByType('KeyboardAvoidingView').props.style.paddingBottom, 0);
  await h.flushFrames();
  assert.ok(h.scrolls.length > 0);
});
