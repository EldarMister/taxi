// Exercise the real transport module with deterministic network/storage boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
function setup(fetch, options = {}) {
  const storage = { value: null };
  const store = {
    readTokens: async () => storage.value,
    writeTokens: async tokens => { storage.value = tokens; },
    clearTokens: async () => { storage.value = null; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    if (id === './native/sessionStore') return store;
    assert.equal(id, '../config/api.cjs');
    return require('../config/api.cjs');
  }, fetch, AbortController, setTimeout: options.setTimeout || setTimeout, clearTimeout,
  process: { env: options.env || { EXPO_PUBLIC_API_URL: 'http://test/api' } } });
  return { api: exports.api, storage };
}

test('cancelled route request propagates cancellation without marking connectivity offline', async () => {
  const events = [], started = deferred();
  const { api } = setup((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); started.resolve();
  }));
  api.subscribe(event => events.push(event));
  const controller = new AbortController();
  const pending = api.request('/routes', { method: 'POST', signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await started.promise; controller.abort(); await rejected;
  assert.equal(events.includes('offline'), false);
});

test('simultaneous 401 responses rotate once and both retry with the new token', async () => {
  const refreshStarted = deferred(), releaseRefresh = deferred(); let rotations = 0; const seen = [];
  const { api, storage } = setup(async (url, init) => {
    if (url.endsWith('/auth/refresh')) { rotations++; refreshStarted.resolve(); await releaseRefresh.promise; return reply(200, { accessToken: 'new', refreshToken: 'new-refresh' }); }
    seen.push(init.headers.Authorization);
    return init.headers.Authorization === 'Bearer old' ? reply(401, { message: 'expired' }) : reply(200, { ok: true });
  });
  await api.setTokens({ accessToken: 'old', refreshToken: 'old-refresh' });
  const first = api.request('/users/me'), second = api.request('/orders/active');
  await refreshStarted.promise; releaseRefresh.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(results.every(result => result.ok), true); assert.equal(rotations, 1);
  assert.equal(seen.filter(token => token === 'Bearer new').length, 2);
  assert.equal(storage.value.refreshToken, 'new-refresh');
});

test('logout fences an in-flight refresh and cannot restore cleared storage', async () => {
  const started = deferred(), release = deferred();
  const { api, storage } = setup(async () => { started.resolve(); await release.promise; return reply(200, { accessToken: 'late', refreshToken: 'late-refresh' }); });
  await api.setTokens({ accessToken: 'old', refreshToken: 'old-refresh' });
  const operation = api.refresh(); const rejected = assert.rejects(operation, error => error.status === 401);
  await started.promise; await api.clear(); release.resolve(); await rejected;
  assert.equal(api.getTokens(), null); assert.equal(storage.value, null);
});

test('an old account request never replays a mutation with a newly signed-in account', async () => {
  const started = deferred(), release = deferred(); let calls = 0;
  const { api } = setup(async () => { calls++; started.resolve(); await release.promise; return reply(401, { message: 'expired' }); });
  await api.setTokens({ accessToken: 'account-a', refreshToken: 'refresh-a' });
  const request = api.post('/orders/active/cancel'); const rejected = assert.rejects(request, error => error.status === 401);
  await started.promise; await api.clear(); await api.setTokens({ accessToken: 'account-b', refreshToken: 'refresh-b' }); release.resolve(); await rejected;
  assert.equal(calls, 1); assert.equal(api.getTokens().accessToken, 'account-b');
});

test('a network failure retains the refresh token for reconnection', async () => {
  const { api, storage } = setup(async () => { throw new Error('Network down'); });
  await api.setTokens({ accessToken: 'active', refreshToken: 'retained' });
  await assert.rejects(api.request('/users/me'), error => error.status === 0);
  assert.equal(api.getTokens().refreshToken, 'retained'); assert.equal(storage.value.refreshToken, 'retained');
});

test('refresh without a session does not poison a later login', async () => {
  const { api } = setup(async () => reply(200, { accessToken: 'rotated', refreshToken: 'rotated-refresh' }));
  await assert.rejects(api.refresh(), error => error.status === 401);
  await api.setTokens({ accessToken: 'active', refreshToken: 'refresh' });
  assert.equal((await api.refresh()).accessToken, 'rotated');
});

test('a build without a local .env reaches the hosted API, including sockets', async () => {
  let requested;
  const { api } = setup(async url => { requested = url; return reply(200, { status: 'ok' }); }, { env: {} });
  await api.request('/health');
  assert.equal(requested, 'https://api-production-47be.up.railway.app/api/health');
  assert.equal(api.socketUrl, 'https://api-production-47be.up.railway.app');
});

test('an API origin or whitespace in .env resolves to the correct API path', () => {
  const { api } = setup(() => {}, { env: { EXPO_PUBLIC_API_URL: '  https://api.taxigo.test/  ' } });
  assert.equal(api.baseUrl, 'https://api.taxigo.test/api');
  assert.equal(api.socketUrl, 'https://api.taxigo.test');
});

test('URL normalization works with the read-only URL fields supplied by React Native', () => {
  class NativeUrl extends URL {
    get pathname() { return super.pathname; }
    set pathname(_) { throw new Error('pathname is read-only on React Native'); }
  }
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../config/api.cjs'), 'utf8'), { module, URL: NativeUrl });
  assert.equal(module.exports.resolveApiUrl('https://api.taxigo.test/'), 'https://api.taxigo.test/api');
  assert.equal(module.exports.resolveApiUrl('https://api.taxigo.test/api///'), 'https://api.taxigo.test/api');
});

test('release configuration rejects placeholder and device-local servers', () => {
  const { resolveApiUrl } = require('../config/api.cjs');
  for (const value of ['https://taxi.example.com/api', 'http://10.0.2.2:3000/api', 'https://localhost/api', 'invalid']) {
    assert.throws(() => resolveApiUrl(value, true));
  }
  assert.equal(resolveApiUrl('http://10.0.2.2:3000/api/', false), 'http://10.0.2.2:3000/api');
  assert.equal(resolveApiUrl(undefined, true), 'https://api-production-47be.up.railway.app/api');
});

test('server rejection is shown without reporting a lost network or replaying an SMS', async () => {
  let calls = 0; const events = [];
  const { api } = setup(async () => { calls++; return reply(429, { message: 'Слишком много запросов. Попробуйте позже.' }); });
  api.subscribe(event => events.push(event));
  await assert.rejects(api.post('/auth/request-code', { phone: '+996700123456' }),
    error => error.status === 429 && error.message.includes('Слишком много запросов'));
  assert.equal(calls, 1);
  assert.deepEqual(events, ['online']);
});

test('invalid successful server responses are not accepted as data or called a network outage', async () => {
  const events = [];
  const { api } = setup(async () => ({ ok: true, status: 200, text: async () => '<html>Maintenance</html>' }));
  api.subscribe(event => events.push(event));
  await assert.rejects(api.request('/config'), error => error.status === 502 && error.message.includes('некорректный ответ'));
  assert.deepEqual(events, ['online']);
});

test('a missing deployed route is explained without leaking internal paths or reporting a network outage', async () => {
  const events = [];
  const { api } = setup(async () => reply(404, { message: 'Cannot GET /api/food/orders/history', error: 'Not Found' }));
  api.subscribe(event => events.push(event));
  await assert.rejects(api.request('/food/orders/history'), error => {
    assert.equal(error.status, 404);
    assert.match(error.message, /раздел временно недоступен/);
    assert.doesNotMatch(error.message, /Cannot|\/api\//);
    return true;
  });
  assert.deepEqual(events, ['online']);
});

test('a timed-out request explains the server delay and leaves the session intact', async () => {
  const events = [];
  const { api, storage } = setup(async (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('Aborted')));
  }), { setTimeout: callback => setTimeout(callback, 0) });
  await api.setTokens({ accessToken: 'active', refreshToken: 'retained' });
  api.subscribe(event => events.push(event));
  await assert.rejects(api.request('/users/me'), error => error.status === 0 && error.message.includes('долго не отвечает'));
  assert.equal(storage.value.refreshToken, 'retained');
  assert.deepEqual(events, ['offline']);
});
