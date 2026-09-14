const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/native/location.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
} }).outputText;
const plain = value => JSON.parse(JSON.stringify(value));

function setup(overrides = {}) {
  const calls = [];
  const location = {
    Accuracy: { High: 'high' },
    getForegroundPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
    requestForegroundPermissionsAsync: async () => ({ status: 'granted', canAskAgain: true }),
    hasServicesEnabledAsync: async () => true,
    enableNetworkProviderAsync: async () => { calls.push('enable-network'); },
    getLastKnownPositionAsync: async () => null,
    getCurrentPositionAsync: async options => {
      calls.push(['current', options]);
      return { timestamp: Date.now(), coords: { latitude: 42.87, longitude: 74.59, accuracy: 25 } };
    },
    ...overrides,
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, setTimeout, clearTimeout, Date,
    require: id => {
      if (id === 'expo-location') return location;
      if (id === 'react-native') return { Platform: { OS: 'android' }, Linking: {
        openSettings: async () => calls.push('settings'),
        sendIntent: async action => calls.push(['intent', action]),
      } };
      throw new Error(`Unexpected dependency ${id}`);
    },
  }, { filename: 'location.ts' });
  return { ...exports, calls };
}

test('permission request ignores a stale request result and re-reads Android grant state', async () => {
  let reads = 0, requests = 0;
  const api = setup({
    getForegroundPermissionsAsync: async () => ++reads === 1
      ? { status: 'denied', canAskAgain: true }
      : { status: 'granted', canAskAgain: true },
    requestForegroundPermissionsAsync: async () => {
      requests++;
      return { status: 'denied', canAskAgain: true };
    },
  });
  assert.deepEqual(plain(await api.requestLocationAccess()), { granted: true, canAskAgain: true, servicesEnabled: true });
  assert.equal(reads, 2);
  assert.equal(requests, 1);
});

test('an existing foreground grant never reopens the system permission prompt', async () => {
  let requests = 0;
  const api = setup({ requestForegroundPermissionsAsync: async () => { requests++; throw new Error('must not ask'); } });
  assert.deepEqual(plain(await api.requestLocationAccess()), { granted: true, canAskAgain: true, servicesEnabled: true });
  assert.equal(requests, 0);
});

test('a provider-status failure cannot turn an existing permission grant into a denial', async () => {
  const api = setup({ hasServicesEnabledAsync: async () => { throw new Error('provider unavailable'); } });
  assert.deepEqual(plain(await api.requestLocationAccess()), { granted: true, canAskAgain: true, servicesEnabled: false });
});

test('a recent accurate cached coordinate returns immediately without starting a fresh GPS fix', async () => {
  const cached = { timestamp: Date.now(), coords: { latitude: 42.8, longitude: 74.6, accuracy: 30 } };
  const api = setup({ getLastKnownPositionAsync: async () => cached });
  assert.deepEqual(plain(await api.getCurrentPosition()), { latitude: 42.8, longitude: 74.6, accuracy: 30 });
  assert.equal(api.calls.length, 0);
});

test('high-accuracy current lookup replaces a coarse cached coordinate', async () => {
  const cached = { timestamp: Date.now() - 120_000, coords: { latitude: 1, longitude: 2, accuracy: 180 } };
  const api = setup({ getLastKnownPositionAsync: async () => cached });
  assert.deepEqual(plain(await api.getCurrentPosition()), { latitude: 42.87, longitude: 74.59, accuracy: 25 });
  assert.equal(api.calls[0][1].accuracy, 'high');
  assert.equal(api.calls[0][1].mayShowUserSettingsDialog, true);
});

test('a usable cached coordinate survives a failed fresh lookup', async () => {
  const cached = { timestamp: Date.now() - 20_000, coords: { latitude: 42.81, longitude: 74.61, accuracy: 70 } };
  const api = setup({ getLastKnownPositionAsync: async () => cached, getCurrentPositionAsync: async () => { throw new Error('cold GPS'); } });
  assert.deepEqual(plain(await api.getCurrentPosition()), { latitude: 42.81, longitude: 74.61, accuracy: 70 });
});

test('stale or coarse fixes cannot recenter the map far from the driver', async () => {
  const cached = { timestamp: Date.now() - 120_000, coords: { latitude: 42.81, longitude: 74.61, accuracy: 150 } };
  const stale = setup({ getLastKnownPositionAsync: async () => cached, getCurrentPositionAsync: async () => { throw new Error('cold GPS'); } });
  await assert.rejects(stale.getCurrentPosition(), /точное местоположение/);
  const coarse = setup({ getCurrentPositionAsync: async () => ({ timestamp: Date.now(), coords: { latitude: 42.81, longitude: 74.61, accuracy: 180 } }) });
  await assert.rejects(coarse.getCurrentPosition(), /точное местоположение/);
});

test('permanently denied permission points to settings without reopening the system prompt', async () => {
  let requested = false;
  const api = setup({
    getForegroundPermissionsAsync: async () => ({ status: 'denied', canAskAgain: false }),
    requestForegroundPermissionsAsync: async () => { requested = true; return { status: 'denied', canAskAgain: false }; },
  });
  await assert.rejects(api.getCurrentPosition(), /настройках устройства/);
  assert.equal(requested, false);
});

test('Android asks to enable its network provider before giving up on disabled services', async () => {
  let enabled = false;
  const api = setup({
    hasServicesEnabledAsync: async () => enabled,
    enableNetworkProviderAsync: async () => { enabled = true; },
  });
  assert.deepEqual(plain(await api.getCurrentPosition()), { latitude: 42.87, longitude: 74.59, accuracy: 25 });
});

test('settings shortcut opens Android location controls when permission exists but GPS is off', async () => {
  const api = setup({ hasServicesEnabledAsync: async () => false });
  await api.openLocationSettings();
  assert.deepEqual(plain(api.calls), [['intent', 'android.settings.LOCATION_SOURCE_SETTINGS']]);
});

test('settings shortcut opens the app permission page after a permanent denial', async () => {
  const api = setup({
    getForegroundPermissionsAsync: async () => ({ status: 'denied', canAskAgain: false }),
    hasServicesEnabledAsync: async () => true,
  });
  await api.openLocationSettings();
  assert.deepEqual(plain(api.calls), ['settings']);
});
