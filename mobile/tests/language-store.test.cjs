const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/auth/languageStore.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function load(storage) {
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => {
    if (id === 'expo-secure-store') return { getItemAsync: async key => storage[key] || null, setItemAsync: async (key, value) => { storage[key] = value; } };
    if (id === '../appVariant') return { appVariant: 'client' };
    throw new Error(id);
  } });
  return exports;
}

test('English interface language survives a new app session and overlays the server profile', async () => {
  const storage = {};
  const first = load(storage);
  assert.equal(await first.readSelectedLanguage(), 'ru');
  await first.writeSelectedLanguage('en');
  const restored = load(storage);
  assert.equal(await restored.readSelectedLanguage(), 'en');
  const serverProfile = { id: 'client', language: 'ru' };
  assert.equal(restored.withSelectedLanguage(serverProfile).language, 'en');
  assert.equal(serverProfile.language, 'ru', 'server language remains unchanged');
  await restored.writeSelectedLanguage('ky');
  assert.equal(restored.withSelectedLanguage({ id: 'client', language: 'ky' }).language, 'ky');
});
