const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function setup() {
  const source = fs.readFileSync(path.join(__dirname, '../src/native/driverAvailability.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const storage = new Map(), uploads = [];
  let task, started = false, permission = true;
  const location = {
    Accuracy: { High: 4 }, getBackgroundPermissionsAsync: async () => ({ granted: permission }),
    getForegroundPermissionsAsync: async () => ({ granted: true, android: { accuracy: 'fine' } }),
    hasStartedLocationUpdatesAsync: async () => started,
    startLocationUpdatesAsync: async (_name, config) => { assert.equal(config.foregroundService.killServiceOnDestroy, false); started = true; },
    stopLocationUpdatesAsync: async () => { started = false; },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Date, require: id => ({
    'expo-location': location,
    'expo-task-manager': { defineTask: (_name, handler) => { task = handler; } },
    'expo-secure-store': { getItemAsync: async key => storage.get(key), setItemAsync: async (key, value) => storage.set(key, value), deleteItemAsync: async key => storage.delete(key) },
    'react-native': { Platform: { OS: 'android' } },
    '../api': { ApiError: class ApiError extends Error {}, api: { getTokens: () => true, patch: async (url, value) => uploads.push({ url, value }) } },
    '../appVariant': { isRoleAllowed: () => true },
  })[id] });
  return { ...exports, uploads, storage, setPermission: value => { permission = value; },
    get started() { return started; }, run: value => task({ data: { locations: value }, error: null }) };
}

test('online driver keeps a foreground location service and uploads fresh background fixes', async () => {
  const h = setup();
  assert.equal(await h.setDriverAvailability(true, 'driver'), true);
  assert.equal(h.started, true);
  await h.run([{ timestamp: Date.now(), coords: { latitude: 42.87, longitude: 74.6, accuracy: 12 } }]);
  assert.equal(h.uploads.length, 1);
  assert.equal(h.uploads[0].url, '/driver/position');
  await h.setDriverAvailability(false);
  assert.equal(h.started, false);
  await h.run([{ timestamp: Date.now(), coords: { latitude: 42.87, longitude: 74.6, accuracy: 12 } }]);
  assert.equal(h.uploads.length, 1);
});

test('background tracking does not start without background location permission', async () => {
  const h = setup(); h.setPermission(false);
  assert.equal(await h.setDriverAvailability(true, 'driver'), false);
  assert.equal(h.started, false);
  assert.equal(h.storage.size, 0);
});
