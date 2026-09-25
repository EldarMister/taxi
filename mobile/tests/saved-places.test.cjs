const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/savedPlaces.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const values = new Map();
const moduleExports = {};
vm.runInNewContext(compiled, {
  exports: moduleExports,
  require: name => name === 'expo-secure-store' ? {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
  } : (() => { throw Error(name); })(),
});

test('home and work survive restart and stay private to each account', async () => {
  const home = { latitude: 42.87, longitude: 74.59, address: 'ул. Манаса, 10' };
  const work = { latitude: 42.9, longitude: 74.61, address: 'ул. Киевская, 50' };
  await moduleExports.writeSavedPlaces('client-a', { home, work });
  assert.deepEqual(JSON.parse(JSON.stringify(await moduleExports.readSavedPlaces('client-a'))), { home, work });
  assert.deepEqual(JSON.parse(JSON.stringify(await moduleExports.readSavedPlaces('client-b'))), {});
});

test('damaged storage cannot put an invalid destination into a taxi order', async () => {
  values.set('taxi.saved-places.v1.bad', JSON.stringify({ home: { latitude: 999, longitude: 74, address: 'wrong' }, work: { latitude: 42.9, longitude: 74.6, address: 'Работа' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(await moduleExports.readSavedPlaces('bad'))), { work: { latitude: 42.9, longitude: 74.6, address: 'Работа' } });
  values.set('taxi.saved-places.v1.broken', '{');
  assert.deepEqual(JSON.parse(JSON.stringify(await moduleExports.readSavedPlaces('broken'))), {});
});
