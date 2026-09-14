const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/native/push.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function setup(options = {}) {
  let permission = options.permission ?? { status: 'undetermined', canAskAgain: true };
  let tokenAttempts = 0, permissionRequests = 0;
  const calls = [], storage = new Map(), timers = new Map();
  const native = {
    getPermissionsAsync: async () => { if (options.unsupported) throw new Error('Native module unavailable'); return permission; },
    requestPermissionsAsync: async () => { permissionRequests++; permission = options.answer ?? { status: 'granted', canAskAgain: true }; return permission; },
    getExpoPushTokenAsync: async () => { tokenAttempts++; return options.token ? options.token(tokenAttempts) : { data: 'ExpoPushToken[test]' }; },
    setNotificationChannelAsync: async () => {}, setNotificationHandler: () => {}, AndroidImportance: { HIGH: 4 }, AndroidAudioUsage: { NOTIFICATION: 5 }, AndroidAudioContentType: { SONIFICATION: 4 },
  };
  const api = { getTokens: () => ({ accessToken: 'signed-in' }), request: async (url, init) => { calls.push({ url, ...init }); if (options.network) return options.network(url, init); } };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    process: { env: {} },
    require: id => {
      if (id === 'expo-notifications') return native;
      if (id === 'expo-device') return { isDevice: options.isDevice ?? true };
      if (id === 'expo-constants') return { expoConfig: { extra: { eas: { projectId: options.noProject ? undefined : 'configured-project' } } } };
      if (id === 'expo-secure-store') return { setItemAsync: async (key, value) => storage.set(key, value), getItemAsync: async key => storage.get(key), deleteItemAsync: async key => storage.delete(key) };
      if (id === 'react-native') return { Platform: { OS: options.os ?? 'android' }, Linking: { openSettings: async () => {} } };
      if (id === './driverSounds') return { driverSounds: { isDriver: () => false } };
      if (id === '../api') return { api };
      throw new Error(`Unexpected dependency: ${id}`);
    },
  });
  return { ...exports, calls, storage, timers, get tokenAttempts() { return tokenAttempts; }, get permissionRequests() { return permissionRequests; } };
}

test('allowing notifications completes from the OS result without waiting for a push provider', async () => {
  const provider = deferred();
  const h = setup({ token: () => provider.promise });
  const permission = await h.requestNotificationAccess();
  assert.equal(permission.granted, true);
  assert.equal(h.permissionRequests, 1);
  assert.equal(h.tokenAttempts, 0);
  assert.equal(h.calls.length, 0);
});

test('denied permission never registers a device or repeatedly opens the system prompt', async () => {
  const h = setup({ answer: { status: 'denied', canAskAgain: false } });
  const permission = await h.requestNotificationAccess();
  assert.equal(permission.granted, false); assert.equal(permission.canAskAgain, false);
  assert.equal(await h.registerPushNotifications(), null);
  assert.equal(h.permissionRequests, 1); assert.equal(h.tokenAttempts, 0); assert.equal(h.calls.length, 0);
});

test('unsupported native notifications return capability state instead of a raw SDK error', async () => {
  const h = setup({ unsupported: true });
  const permission = await h.requestNotificationAccess();
  assert.equal(permission.supported, false);
  assert.equal(permission.granted, false);
  assert.equal(await h.registerPushNotifications(), null);
  assert.equal(h.calls.length, 0);
});

test('provider failure leaves permission intact and a later retry registers successfully', async () => {
  const h = setup({ permission: { status: 'granted', canAskAgain: true }, token: attempt => {
    if (attempt === 1) throw new Error('Firebase SDK unavailable');
    return { data: 'ExpoPushToken[retry]' };
  } });
  assert.equal(await h.registerPushNotifications(), null);
  assert.equal((await h.getNotificationPermissionState()).granted, true);
  assert.equal(await h.registerPushNotifications(), 'ExpoPushToken[retry]');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, '/users/me/push-token');
  assert.equal(h.calls[0].method, 'POST');
  assert.equal(h.timers.size, 0);
});

test('missing configuration or an emulator does not produce a fake successful token', async () => {
  for (const options of [{ noProject: true }, { isDevice: false }]) {
    const h = setup({ ...options, permission: { status: 'granted', canAskAgain: true } });
    assert.equal(await h.registerPushNotifications(), null);
    assert.equal(h.tokenAttempts, 0); assert.equal(h.calls.length, 0);
  }
});

test('logout fences an in-flight provider response and never attaches it to a later account', async () => {
  const provider = deferred();
  const h = setup({ permission: { status: 'granted', canAskAgain: true }, token: () => provider.promise });
  const first = h.registerPushNotifications();
  const second = h.registerPushNotifications();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.tokenAttempts, 1);
  await h.unregisterPushNotifications();
  provider.resolve({ data: 'ExpoPushToken[late]' });
  assert.equal(await first, null); assert.equal(await second, null);
  assert.equal(h.calls.length, 0); assert.equal(h.storage.size, 0); assert.equal(h.timers.size, 0);
});

test('an unavailable registration endpoint is retriable without changing user notification preferences', async () => {
  let failed = true;
  const h = setup({ permission: { status: 'granted', canAskAgain: true }, network: () => { if (failed) throw new Error('Cannot POST /api/users/me/push-token'); } });
  assert.equal(await h.registerPushNotifications(), null);
  failed = false;
  assert.equal(await h.registerPushNotifications(), 'ExpoPushToken[test]');
  assert.equal(h.calls.every(call => call.url === '/users/me/push-token'), true);
});
