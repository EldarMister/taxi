const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
const content = require('../src/legalDocumentsContent.json');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function load(options = {}) {
  const links = [];
  const keyboard = { dismissed: false };
  const native = {
    ...Object.fromEntries(['Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name])),
    Modal: ({ visible, children, ...props }) => visible ? React.createElement('Modal', props, children) : null,
    Linking: { openURL: async url => { links.push(url); } }, Alert: { alert() {} },
    Keyboard: { dismiss: () => { keyboard.dismissed = true; } },
    StyleSheet: { create: value => value, hairlineWidth: 1 },
  };
  const output = {};
  const source = fs.readFileSync(path.join(__dirname, '../src/LegalDocumentLink.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(compiled, { exports: output, AbortController, URL, process: { env: options.remote ? { EXPO_PUBLIC_PRIVACY_URL: 'https://atlas.example/privacy/' } : {} },
    fetch: options.fetch || (() => { throw new Error('Unexpected network access'); }), require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView' };
      if (id === './design/theme') return { useTheme: () => ({ palette: { ink: '#101D38', surface: '#FFF', muted: '#63718D', accent: '#087FFF', accentText: '#FFF', elevated: '#F3F7FF', line: '#E5EDF6' } }) };
      if (id === './design/typography') return { fonts: {} };
      if (id === './legalDocumentsContent.json') return content;
      throw new Error('Unmocked module ' + id);
    } });
  return { ...output, links, keyboard };
}
const textOf = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join(' ') : textOf(node?.children || node?.props?.children || []);

test('legal link opens the full document inside the app; document navigation and Android back keep browser closed', async t => {
  const { LegalDocumentLink, links, keyboard } = load();
  let renderer;
  await act(async () => { renderer = create(React.createElement(LegalDocumentLink, { document: 'privacy', language: 'ru' }, 'Политика')); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  assert.equal(renderer.root.findAllByType('Modal').length, 0);
  await act(async () => renderer.root.findByType('Pressable').props.onPress());
  assert.equal(keyboard.dismissed, true);
  assert.equal(renderer.root.findAllByType('Modal').length, 1);
  const policy = textOf(renderer.toJSON());
  assert.match(policy, /Местоположение и адреса/);
  assert.match(policy, /Atlas не продаёт персональные данные/);
  assert.match(policy, /9\. Сайт, дети и изменения/);
  assert.doesNotMatch(policy, /Проект документов до коммерческого запуска/);
  const terms = renderer.root.findAllByType('Pressable').find(button => textOf(button.props.children) === 'Условия');
  await act(async () => terms.props.onPress());
  assert.match(textOf(renderer.toJSON()), /11\. Редакция и изменения/);
  await act(async () => renderer.root.findByType('Modal').props.onRequestClose());
  assert.match(textOf(renderer.toJSON()), /Местоположение и адреса/);
  const deletion = renderer.root.findAllByType('Pressable').find(button => textOf(button.props.children) === 'Удаление аккаунта');
  await act(async () => deletion.props.onPress());
  assert.match(textOf(renderer.toJSON()), /Что удаляется, что может сохраниться/);
  assert.match(textOf(renderer.toJSON()), /Написать запрос на удаление/);
  const email = renderer.root.findAllByType('Text').find(node => node.props.onPress && textOf(node.props.children).includes('Написать запрос'));
  await act(async () => email.props.onPress());
  assert.equal(links.length, 1);
  assert.ok(links[0].startsWith('mailto:atlas.delivery.kg@gmail.com?subject='));
  await act(async () => renderer.root.findAllByType('Pressable').find(button => button.props.accessibilityLabel === 'Закрыть').props.onPress());
  assert.equal(renderer.root.findAllByType('Modal').length, 0);
});

test('unavailable or invalid online content keeps the complete offline document', async t => {
  for (const response of [null, { ok: true, json: async () => ({ privacy: null }) }]) {
    const { LegalDocumentReader } = load({ remote: true, fetch: async () => { if (!response) throw new Error('offline'); return response; } });
    let renderer;
    await act(async () => { renderer = create(React.createElement(LegalDocumentReader, { initialDocument: 'terms', language: 'ru', onClose() {} })); });
    assert.match(textOf(renderer.toJSON()), /11\. Редакция и изменения/);
    await act(async () => renderer.unmount());
  }
});

test('reader uses updated online documents and cancels pending fetch when closed', async t => {
  let request;
  const updated = JSON.parse(JSON.stringify(content));
  updated.privacy.title = 'Обновлённая политика';
  const { LegalDocumentReader } = load({ remote: true, fetch: async (url, options) => {
    request = { url, ...options };
    return { ok: true, json: async () => updated };
  } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(LegalDocumentReader, { initialDocument: 'privacy', language: 'ru', onClose() {} })); });
  assert.equal(request.url, 'https://atlas.example/legal-documents.json');
  assert.match(textOf(renderer.toJSON()), /Обновлённая политика/);
  await act(async () => renderer.unmount());
  assert.equal(request.signal.aborted, true);
});
