const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('chat attachment can send a photo while the send button stays hidden for empty content', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/Overlays.tsx'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const uploads = [], pickerCalls = [];
  let keyboardDismisses = 0, inputBlurs = 0, closes = 0;
  class Form { fields = []; append(name, value) { this.fields.push([name, value]); } }
  const api = {
    baseUrl: 'https://example.test/api', getTokens: () => ({ accessToken: 'token' }),
    request: async () => [], upload: async (url, form) => {
      uploads.push({ url, form });
      return { id: 'photo-message', orderId: 'trip', senderId: 'me', text: '', createdAt: new Date().toISOString(),
        photoUrl: '/orders/trip/messages/photo-message/photo' };
    },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, FormData: Form, setInterval: () => 1, clearInterval: () => {},
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator', Image: 'Image', Keyboard: { dismiss: () => { keyboardDismisses++; } },
        KeyboardAvoidingView: 'KeyboardAvoidingView', Modal: 'Modal', Platform: { OS: 'android' },
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
      if (id === './api') return { api, messageOf: error => String(error), requestId: () => 'client-message-id' };
      if (id === './design/theme') return { useTheme: () => ({ isDark: true, palette: {
        background: '#050505', surface: '#111111', line: '#333333', ink: '#ffffff', muted: '#aaaaaa', accent: '#ffffff', accentText: '#000000',
      } }) };
      if (id === './ui') return { Icon: 'Icon', localize: (language, ru, ky) => language === 'ky' ? ky : ru };
      if (id === './AddressPicker') return { AddressPicker: 'AddressPicker' };
      throw Error(id);
    },
  });
  const user = { id: 'me', language: 'ru' };
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.ChatOverlay,
    { orderId: 'trip', user, incoming: null, onClose: () => { closes++; }, onError: error => { throw Error(error); } }),
    { createNodeMock: node => node.type === 'TextInput' ? { blur: () => { inputBlurs++; } } : null }); });
  const buttons = label => renderer.root.findAllByProps({ accessibilityLabel: label });
  assert.equal(renderer.root.findByType('KeyboardAvoidingView').props.behavior, 'padding',
    'the chat composer moves above the Android keyboard');
  assert.equal(buttons('Отправить сообщение').length, 0);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Сообщение' }).props.onChangeText('Привет'));
  assert.equal(buttons('Отправить сообщение').length, 1);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Сообщение' }).props.onChangeText('   '));
  assert.equal(buttons('Отправить сообщение').length, 0, 'whitespace is not a message');
  await act(async () => { buttons('Прикрепить фото')[0].props.onPress(); });
  assert.equal(renderer.root.findAllByProps({ testID: 'chat-photo-sheet' }).length, 1);
  assert.equal(buttons('Сделать фото').length, 1);
  assert.equal(buttons('Выбрать из галереи').length, 1);
  assert.equal(keyboardDismisses, 1);
  assert.equal(inputBlurs, 1);
  await act(async () => { buttons('Закрыть выбор фото')[0].props.onPress(); });
  assert.equal(renderer.root.findAllByProps({ testID: 'chat-photo-sheet' }).length, 0);
  await act(async () => { buttons('Прикрепить фото')[0].props.onPress(); });
  await act(async () => { buttons('Сделать фото')[0].props.onPress(); });
  assert.deepEqual(pickerCalls, ['camera']);
  assert.equal(renderer.root.findAllByProps({ testID: 'chat-photo-sheet' }).length, 0);
  assert.equal(buttons('Отправить сообщение').length, 1, 'a selected camera photo is sendable without a caption');
  await act(async () => { buttons('Отправить сообщение')[0].props.onPress(); });
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].url, '/orders/trip/messages/photo');
  assert.deepEqual(uploads[0].form.fields.map(([name]) => name), ['image', 'text', 'clientMessageId']);
  assert.equal(buttons('Отправить сообщение').length, 0, 'the button disappears after a successful send');
  assert.equal(buttons('Открыть фотографию').length, 1);
  await act(async () => { buttons('Прикрепить фото')[0].props.onPress(); });
  await act(async () => { buttons('Выбрать из галереи')[0].props.onPress(); });
  assert.deepEqual(pickerCalls, ['camera', 'library']);
  await act(async () => { buttons('Назад')[0].props.onPress(); });
  assert.equal(closes, 1);
  assert.ok(keyboardDismisses >= 3);
  await act(async () => renderer.update(React.createElement(exports.ChatOverlay,
    { orderId: 'trip', user: { ...user, role: 'DRIVER' }, peerName: 'Имя клиента', incoming: null,
      onClose: () => { closes++; }, onError: error => { throw Error(error); } })));
  assert.equal(renderer.root.findByProps({ testID: 'chat-peer-title' }).children.join(''), 'Пассажир');
  await act(async () => renderer.update(React.createElement(exports.ChatOverlay,
    { orderId: 'trip', user: { ...user, role: 'CLIENT' }, peerName: 'Имя водителя', incoming: null,
      onClose: () => { closes++; }, onError: error => { throw Error(error); } })));
  assert.equal(renderer.root.findByProps({ testID: 'chat-peer-title' }).children.join(''), 'Имя водителя');
  await act(async () => renderer.unmount());
});
