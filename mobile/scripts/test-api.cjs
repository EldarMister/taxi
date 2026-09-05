// Exercise the real transport module with deterministic network/storage boundaries.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { test } = require('node:test');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
function setup(fetch) {
  const storage = { value: null };
  const store = {
    readTokens: async () => storage.value,
    writeTokens: async tokens => { storage.value = tokens; },
    clearTokens: async () => { storage.value = null; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/api.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => { assert.equal(id, './native/sessionStore'); return store; }, fetch, AbortController, setTimeout, clearTimeout, process: { env: { EXPO_PUBLIC_API_URL: 'http://test/api' } } });
  return { api: exports.api, storage };
}

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
