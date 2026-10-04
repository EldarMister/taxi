const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function chatHarness(platform = 'android', isDark = true) {
  const source = fs.readFileSync(path.join(__dirname, '../src/Overlays.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const uploads = [], pickerCalls = [], posts = [], errors = [];
  const state = { keyboardDismisses: 0, inputBlurs: 0, closes: 0, frame: { y: 0, height: 900 }, deferMeasurement: false, measurements: [] };
  const keyboardListeners = new Map();
  class Form { fields = []; append(name, value) { this.fields.push([name, value]); } }
  const api = {
    baseUrl: 'https://example.test/api', getTokens: () => ({ accessToken: 'token' }),
    request: async () => [], upload: async (url, form) => {
      uploads.push({ url, form });
      return { id: 'photo-message', orderId: 'trip', senderId: 'me', text: '', createdAt: new Date().toISOString(),
        photoUrl: '/orders/trip/messages/photo-message/photo' };
    },
    post: async (url, body) => {
      posts.push({ url, body });
      return { id: `text-message-${posts.length}`, orderId: 'trip', senderId: 'me', text: body.text,
        createdAt: new Date().toISOString() };
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, FormData: Form, setInterval: () => 1, clearInterval: () => {},
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Keyboard: {
          dismiss: () => { state.keyboardDismisses++; },
          addListener: (event, listener) => { keyboardListeners.set(event, listener); return { remove: () => keyboardListeners.delete(event) }; },
        },
        KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Platform: { OS: platform },
        Pressable: 'Pressable', ScrollView: 'ScrollView', StyleSheet: { create: styles => styles,
          absoluteFillObject: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } },
        Text: 'Text', TextInput: 'TextInput', View: 'View',
      };
      if (id === 'expo-image-picker') return {
        UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
        requestCameraPermissionsAsync: async () => ({ granted: true }),
        launchCameraAsync: async () => { pickerCalls.push('camera'); return { canceled: false, assets: [{ uri: 'camera.jpg', width: 800, height: 600 }] }; },
        launchImageLibraryAsync: async () => { pickerCalls.push('library'); return { canceled: false, assets: [{ uri: 'library.jpg', width: 800, height: 600 }] }; },
      };
      if (id === 'expo-image-manipulator') return { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async () => ({ uri: 'prepared.jpg' }) };
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 20 }) };
      if (id === 'react-native-gesture-handler') return { GestureHandlerRootView: 'GestureHandlerRootView' };
      if (id === './BottomPanel') return { BottomPanel: 'BottomPanel' };
      if (id === './api') return { api, messageOf: error => String(error), requestId: () => 'client-message-id' };
      if (id === './design/theme') return { useTheme: () => ({ isDark, palette: isDark ? {
        background: '#050505', surface: '#111111', line: '#333333', ink: '#ffffff', muted: '#aaaaaa', accent: '#ffffff', accentText: '#000000',
      } : { background: '#F4F8FD', surface: '#FFFFFF', line: '#E5EDF6', ink: '#101D38', muted: '#63718D', accent: '#087FFF', accentText: '#FFFFFF' } }) };
      if (id === './ui') return { Icon: 'Icon', localize: (language, ru, ky) => language === 'ky' ? ky : ru };
      if (id === './AddressPicker') return { AddressPicker: 'AddressPicker' };
      throw Error(id);
    },
  });
  const user = { id: 'me', language: 'ru' };
  const props = { orderId: 'trip', user, incoming: null, onClose: () => { state.closes++; }, onError: error => { errors.push(error); } };
  const render = () => create(React.createElement(exports.ChatOverlay, props), { createNodeMock: node => {
    if (node.type === 'TextInput') return { blur: () => { state.inputBlurs++; } };
    if (node.props.testID === 'chat-keyboard-host') return { measureInWindow: callback => {
      const frame = { ...state.frame };
      const complete = () => callback(0, frame.y, 412, frame.height);
      if (state.deferMeasurement) state.measurements.push(complete); else complete();
    } };
    return null;
  } });
  return { api, exports, user, props, render, uploads, pickerCalls, posts, errors, state, keyboardListeners };
}

test('chat attachment can send a photo while the send button stays hidden for empty content', async () => {
  const { exports, user, render, uploads, pickerCalls, state, errors } = chatHarness();
  let renderer;
  await act(async () => { renderer = render(); });
  const buttons = label => renderer.root.findAllByProps({ accessibilityLabel: label });
  const finishAttachmentClose = async () => { await act(async () => renderer.root.findByType('BottomPanel').props.onClose()); };
  const avoiding = renderer.root.findByType('KeyboardAvoidingView');
  assert.equal(avoiding.props.enabled, false, 'Android measures the modal overlap instead of assuming a native resize');
  assert.equal(avoiding.props.behavior, undefined, 'built-in padding does not compound native resize or measured overlap');
  assert.equal(buttons('Отправить сообщение').length, 0);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Сообщение' }).props.onChangeText('Привет'));
  assert.equal(buttons('Отправить сообщение').length, 1);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Сообщение' }).props.onChangeText('   '));
  assert.equal(buttons('Отправить сообщение').length, 0, 'whitespace is not a message');
  await act(async () => { buttons('Прикрепить фото')[0].props.onPress(); });
  assert.equal(renderer.root.findAllByProps({ testID: 'chat-photo-sheet' }).length, 1);
  assert.equal(buttons('Сделать фото').length, 1);
  assert.equal(buttons('Выбрать из галереи').length, 1);
  assert.equal(state.keyboardDismisses, 1);
  assert.equal(state.inputBlurs, 1);
  const attachment = renderer.root.findByType('BottomPanel');
  assert.equal(attachment.props.expanded, undefined, 'photo choices size to their content');
  assert.equal(attachment.props.bottomPadding, 38);
  assert.equal(attachment.props.handlePlacement, 'inside');
  let ancestor = attachment.parent;
  while (ancestor && ancestor.type !== 'GestureHandlerRootView') ancestor = ancestor.parent;
  assert.ok(ancestor && ancestor.parent.type === 'Modal', 'native modal owns its gesture root');
  assert.equal(avoiding.props.accessibilityElementsHidden, true);
  await act(async () => renderer.root.findAllByType('Modal')[0].props.onRequestClose());
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true);
  assert.equal(renderer.root.findAllByProps({ testID: 'chat-photo-sheet' }).length, 1, 'close waits for the shared exit transition');
  await finishAttachmentClose();
  assert.equal(renderer.root.findAllByProps({ testID: 'chat-photo-sheet' }).length, 0);
  assert.equal(avoiding.props.accessibilityElementsHidden, false);
  await act(async () => { buttons('Прикрепить фото')[0].props.onPress(); });
  await act(async () => { buttons('Сделать фото')[0].props.onPress(); });
  assert.deepEqual(pickerCalls, [], 'native camera opens only after the card finishes closing');
  assert.equal(buttons('Сделать фото')[0].props.disabled, true);
  await finishAttachmentClose();
  assert.deepEqual(pickerCalls, ['camera']);
  assert.equal(renderer.root.findAllByProps({ testID: 'chat-photo-sheet' }).length, 0);
  assert.equal(buttons('Отправить сообщение').length, 1, 'a selected camera photo is sendable without a caption');
  await act(async () => { buttons('Отправить сообщение')[0].props.onPress(); });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].url, '/orders/trip/messages/photo');
  assert.deepEqual(uploads[0].form.fields.map(([name]) => name), ['image', 'text', 'clientMessageId']);
  assert.equal(buttons('Отправить сообщение').length, 0, 'the button disappears after a successful send');
  assert.equal(buttons('Открыть фотографию').length, 1);
  assert.equal(state.keyboardDismisses, 3, 'a successful photo send dismisses any composer keyboard');
  assert.equal(state.inputBlurs, 3);
  await act(async () => { buttons('Прикрепить фото')[0].props.onPress(); });
  await act(async () => { buttons('Выбрать из галереи')[0].props.onPress(); });
  assert.deepEqual(pickerCalls, ['camera']);
  await finishAttachmentClose();
  assert.deepEqual(pickerCalls, ['camera', 'library']);
  await act(async () => { buttons('Прикрепить фото')[0].props.onPress(); });
  await act(async () => renderer.root.findAllByType('Modal')[0].props.onRequestClose());
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true, 'Android back closes the attachment card first');
  assert.equal(state.closes, 0, 'chat stays open behind its attachment card');
  await finishAttachmentClose();
  assert.deepEqual(pickerCalls, ['camera', 'library'], 'closing without selecting does not launch a photo picker');
  await act(async () => { buttons('Назад')[0].props.onPress(); });
  assert.equal(state.closes, 1);
  assert.ok(state.keyboardDismisses >= 3);
  await act(async () => renderer.update(React.createElement(exports.ChatOverlay,
    { orderId: 'trip', user: { ...user, role: 'DRIVER' }, peerName: 'Имя клиента', incoming: null,
      onClose: () => { state.closes++; }, onError: error => { throw Error(error); } })));
  assert.equal(renderer.root.findByProps({ testID: 'chat-peer-title' }).children.join(''), 'Пассажир');
  await act(async () => renderer.update(React.createElement(exports.ChatOverlay,
    { orderId: 'trip', user: { ...user, role: 'CLIENT' }, peerName: 'Имя водителя', incoming: null,
      onClose: () => { state.closes++; }, onError: error => { throw Error(error); } })));
  assert.equal(renderer.root.findByProps({ testID: 'chat-peer-title' }).children.join(''), 'Имя водителя');
  assert.deepEqual(errors, []);
  await act(async () => renderer.unmount());
});

test('successful text send releases the composer and failed send keeps the draft for retry', async () => {
  const h = chatHarness();
  let renderer;
  await act(async () => { renderer = h.render(); });
  const input = () => renderer.root.findByProps({ accessibilityLabel: 'Сообщение' });
  const send = () => renderer.root.findByProps({ accessibilityLabel: 'Отправить сообщение' }).props.onPress();
  await act(async () => input().props.onChangeText('  Привет  '));
  await act(async () => send());
  assert.equal(h.posts[0].url, '/orders/trip/messages');
  assert.equal(h.posts[0].body.text, 'Привет');
  assert.equal(input().props.value, '');
  assert.equal(h.state.inputBlurs, 1);
  assert.equal(h.state.keyboardDismisses, 1, 'the input returns to its resting position after success');

  const successfulPost = h.api.post;
  let retryId;
  h.api.post = async (_url, body) => { retryId = body.clientMessageId; throw Error('Нет сети'); };
  await act(async () => input().props.onChangeText('Повторить'));
  await act(async () => send());
  assert.equal(input().props.value, 'Повторить');
  assert.equal(h.state.inputBlurs, 1, 'failed send leaves the draft focused');
  assert.equal(h.state.keyboardDismisses, 1);
  assert.equal(h.errors.length, 1);
  h.api.post = successfulPost;
  await act(async () => send());
  assert.equal(h.posts[1].body.clientMessageId, retryId, 'retry preserves the request identity');
  assert.equal(input().props.value, '');
  assert.equal(h.state.inputBlurs, 2);
  assert.equal(h.state.keyboardDismisses, 2);
  await act(async () => renderer.unmount());
});

test('iOS chat retains keyboard padding compensation', async () => {
  const h = chatHarness('ios');
  let renderer;
  await act(async () => { renderer = h.render(); });
  const avoiding = renderer.root.findByType('KeyboardAvoidingView');
  assert.equal(avoiding.props.enabled, true);
  assert.equal(avoiding.props.behavior, 'padding');
  assert.equal(h.keyboardListeners.size, 0, 'iOS leaves keyboard avoidance to the native component');
  assert.equal(renderer.root.findByType('ScrollView').props.keyboardDismissMode, 'interactive');
  await act(async () => renderer.unmount());
});

test('Android composer lifts above the keyboard, follows resize, and resets after send and keyboard hide', async () => {
  const h = chatHarness();
  let renderer;
  await act(async () => { renderer = h.render(); });
  const lift = () => renderer.root.findByType('KeyboardAvoidingView').props.style.paddingBottom;
  const layout = () => renderer.root.findByProps({ testID: 'chat-keyboard-host' }).props.onLayout();
  const show = screenY => h.keyboardListeners.get('keyboardDidShow')({ endCoordinates: { screenY } });
  const hide = () => h.keyboardListeners.get('keyboardDidHide')();
  assert.equal(lift(), 0);
  assert.equal(renderer.root.findAllByType('Modal')[0].props.statusBarTranslucent, true, 'modal and keyboard use the same screen coordinate origin');
  await act(async () => show(600));
  assert.equal(lift(), 300, 'unresized modal lifts the input out of the keyboard');
  h.state.frame.height = 750;
  await act(async () => layout());
  assert.equal(lift(), 150, 'partial native resize needs only the remaining overlap');
  h.state.frame.height = 600;
  await act(async () => layout());
  assert.equal(lift(), 0, 'complete native resize does not lift the input twice');
  await act(async () => hide());
  h.state.frame.height = 900;
  await act(async () => { layout(); show(620); });
  assert.equal(lift(), 280, 'the next keyboard opening still lifts the input');
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Сообщение' }).props.onChangeText('Привет'));
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Отправить сообщение' }).props.onPress());
  assert.equal(h.state.inputBlurs, 1);
  assert.equal(h.state.keyboardDismisses, 1);
  await act(async () => hide());
  assert.equal(lift(), 0, 'the composer returns to its resting position after the keyboard closes');
  await act(async () => renderer.unmount());
  assert.equal(h.keyboardListeners.size, 0);
});

test('late Android measurements cannot relift the composer after keyboard hide or unmount', async () => {
  const h = chatHarness(); h.state.deferMeasurement = true;
  let renderer;
  await act(async () => { renderer = h.render(); });
  await act(async () => h.keyboardListeners.get('keyboardDidShow')({ endCoordinates: { screenY: 600 } }));
  await act(async () => h.keyboardListeners.get('keyboardDidHide')());
  await act(async () => h.state.measurements.shift()());
  assert.equal(renderer.root.findByType('KeyboardAvoidingView').props.style.paddingBottom, 0);
  await act(async () => h.keyboardListeners.get('keyboardDidShow')({ endCoordinates: { screenY: 600 } }));
  await act(async () => renderer.unmount());
  await act(async () => h.state.measurements.shift()());
  assert.equal(h.keyboardListeners.size, 0);
});

test('photo chooser uses two equal graphite cards with readable light and dark themes', async () => {
  for (const isDark of [false, true]) {
    const h = chatHarness('android', isDark);
    let renderer;
    await act(async () => { renderer = h.render(); });
    await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Прикрепить фото' }).props.onPress());
    const sheet = renderer.root.findByProps({ testID: 'chat-photo-sheet' });
    const options = renderer.root.findByProps({ testID: 'chat-photo-options' });
    assert.equal(options.props.style.flexDirection, 'row');
    assert.equal(options.findAllByType('Pressable').length, 2);
    assert.deepEqual(sheet.findAllByType('Text').map(node => node.children.join('')), ['Добавить фото', 'Камера', 'Галерея']);
    assert.deepEqual(sheet.findAllByType('Icon').map(node => node.props.name), ['camera-outline', 'image-outline']);
    for (const card of options.findAllByType('Pressable')) {
      const style = Object.assign({}, ...card.props.style({ pressed: false }));
      assert.equal(style.flex, 1);
      assert.ok(style.minHeight >= 104);
      assert.equal(style.backgroundColor, isDark ? '#242526' : '#F4F4F4');
      assert.equal(card.findByType('Icon').props.color, isDark ? '#ECEDEF' : '#25282C');
      assert.equal(card.findByType('Text').props.style.at(-1).color, isDark ? '#ffffff' : '#101D38');
      assert.ok(Object.assign({}, ...card.props.style({ pressed: true })).opacity < style.opacity);
    }
    await act(async () => renderer.unmount());
  }
});
