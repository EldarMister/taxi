const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, overrides = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, AbortController, FormData, URL, setTimeout, clearTimeout, console, ...overrides });
  return exports;
}
const { createRestaurantApi, ApiError, StaleSessionError } = load('data/apiCore.ts');
const { can, permissions } = load('domain/types.ts');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const response = (status, payload) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) });
const member = id => ({ restaurantId: id, restaurantName: id, role: 'OWNER', permissions: [] });
const session = (token = 'one', memberships = [member('alpha'), member('beta')]) => ({ accessToken: `access-${token}`, refreshToken: `refresh-${token}`, expiresIn: 900, user: { id: 'owner', name: 'Owner', phone: '+996700123456' }, memberships });
function harness(transport, hooks = {}) {
  let stored = hooks.initial ?? null;
  const calls = [];
  const api = createRestaurantApi({ baseUrl: 'https://atlas.test/api', timeoutMs: 500,
    storage: {
      read: async () => { await hooks.read?.(); return stored; },
      write: async value => { await hooks.write?.(value); stored = value; },
      clear: async () => { await hooks.clear?.(); stored = null; },
    },
    transport: async (url, init) => { calls.push({ url, init }); return transport(url, init); },
  });
  return { api, calls, stored: () => stored };
}
const login = api => api.login('+996700123456', 'long-test-password');

test('owner and manager permission checks cannot expand a manager role', () => {
  for (const [permission] of permissions) assert.equal(can({ role: 'OWNER', permissions: [] }, permission), true);
  assert.equal(can(undefined, 'orders.read'), false);
  assert.equal(can({ role: 'MANAGER', permissions: ['orders.read'] }, 'orders.read'), true);
  assert.equal(can({ role: 'MANAGER', permissions: ['orders.read'] }, 'orders.manage'), false);
});

test('authentication persists only tokens and trims the login phone', async () => {
  const h = harness(async () => response(200, session()));
  await h.api.login(' +996700123456 ', 'long-test-password');
  assert.deepEqual(JSON.parse(h.stored()), { accessToken: 'access-one', refreshToken: 'refresh-one' });
  assert.equal(h.calls[0].url, 'https://atlas.test/api/restaurant/auth/login');
  assert.equal(JSON.parse(h.calls[0].init.body).phone, '+996700123456');
  assert.equal(h.api.snapshot().user.id, 'owner');
});

test('concurrent expired requests rotate once, including a later old-token rejection', async () => {
  const delayed = deferred();
  let refreshes = 0;
  const h = harness(async (url, init) => {
    if (url.endsWith('/login')) return response(200, session());
    if (url.endsWith('/refresh')) { refreshes++; return response(200, session('two')); }
    if (init.headers.Authorization === 'Bearer access-two') return response(200, { ok: true });
    if (url.endsWith('/beta')) await delayed.promise;
    return response(401, { message: 'Expired' });
  });
  await login(h.api);
  const second = h.api.request('/beta');
  assert.equal((await h.api.request('/alpha')).ok, true);
  delayed.resolve();
  assert.equal((await second).ok, true);
  assert.equal(refreshes, 1);
});

test('simultaneous 401 responses share a refresh request', async () => {
  const started = deferred(), release = deferred();
  let refreshes = 0;
  const h = harness(async (url, init) => {
    if (url.endsWith('/login')) return response(200, session());
    if (url.endsWith('/refresh')) { refreshes++; started.resolve(); await release.promise; return response(200, session('two')); }
    return response(init.headers.Authorization === 'Bearer access-two' ? 200 : 401, {});
  });
  await login(h.api);
  const first = h.api.request('/alpha'), second = h.api.request('/beta');
  await started.promise;
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(refreshes, 1);
});

test('a late successful read cannot repopulate data after logout', async () => {
  const started = deferred(), release = deferred();
  const h = harness(async url => {
    if (url.endsWith('/login')) return response(200, session());
    if (url.endsWith('/logout')) return response(200, {});
    started.resolve(); await release.promise; return response(200, { secret: 'previous merchant' });
  });
  await login(h.api);
  const pending = h.api.request('/alpha');
  const rejected = assert.rejects(pending, StaleSessionError);
  await started.promise;
  await h.api.logout();
  release.resolve();
  await rejected;
  assert.equal(h.api.snapshot(), null);
  assert.equal(h.stored(), null);
});

test('logout fences late refresh and queues deletion after an in-progress secure write', async () => {
  const writing = deferred(), release = deferred();
  const h = harness(async (url, init) => {
    if (url.endsWith('/login')) return response(200, session());
    if (url.endsWith('/refresh')) return response(200, session('two'));
    if (url.endsWith('/logout')) return response(200, {});
    return response(init.headers.Authorization === 'Bearer access-two' ? 200 : 401, {});
  }, { write: async value => { if (JSON.parse(value).accessToken === 'access-two') { writing.resolve(); await release.promise; } } });
  await login(h.api);
  const pending = h.api.request('/alpha');
  const rejected = assert.rejects(pending, StaleSessionError);
  await writing.promise;
  const logout = h.api.logout();
  assert.equal(h.api.snapshot(), null);
  release.resolve();
  await Promise.all([logout, rejected]);
  assert.equal(h.stored(), null);
});

test('a new login cannot be overwritten by an older successful login', async () => {
  const started = deferred(), release = deferred();
  let attempts = 0;
  const h = harness(async () => { if (++attempts === 1) { started.resolve(); await release.promise; return response(200, session('old')); } return response(200, session('new')); });
  const old = login(h.api);
  const rejected = assert.rejects(old, StaleSessionError);
  await started.promise;
  await login(h.api);
  release.resolve();
  await rejected;
  assert.equal(h.api.snapshot().accessToken, 'access-new');
  assert.equal(JSON.parse(h.stored()).accessToken, 'access-new');
});

test('restore is single-flight, rotates stored tokens, and hydrates current memberships', async () => {
  const h = harness(async () => response(200, session('restored', [member('beta')])), { initial: JSON.stringify({ accessToken: 'expired', refreshToken: 'stored' }) });
  const values = await Promise.all([h.api.restore(), h.api.restore()]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url.endsWith('/auth/refresh'), true);
  assert.equal(values[0].memberships[0].restaurantId, 'beta');
  assert.equal(JSON.parse(h.stored()).refreshToken, 'refresh-restored');
});

test('offline restoration preserves credentials for retry; revoked sessions clear them', async () => {
  let online = false;
  const h = harness(async () => { if (!online) throw new Error('offline'); return response(401, { message: 'Войдите снова' }); }, { initial: JSON.stringify({ accessToken: 'old', refreshToken: 'stored' }) });
  await assert.rejects(h.api.restore(), error => error.code === 'NETWORK');
  assert.notEqual(h.stored(), null);
  online = true;
  assert.equal(await h.api.restore(), null);
  assert.equal(h.stored(), null);
});

test('restaurant paths block sibling and traversal access before any network call', async () => {
  const h = harness(async () => response(200, session()));
  await login(h.api);
  for (const route of ['/gamma/orders', '/alpha/../beta', '/alpha/%2E%2E/beta', '//atlas.test', '/alpha%2Fbeta', '/alpha\\beta']) {
    await assert.rejects(h.api.request(route), ApiError);
  }
  assert.equal(h.calls.length, 1);
});

test('ten-restaurant checkouts remain isolated and mixed-restaurant responses are rejected', async () => {
  const memberships = Array.from({ length: 10 }, (_, index) => member(`r${index}`));
  let mixed = false;
  const h = harness(async url => {
    if (url.endsWith('/login')) return response(200, session('one', memberships));
    const restaurantId = url.split('/').at(-2);
    return response(200, { orders: [{ id: `order-${restaurantId}`, restaurantId: mixed ? 'another' : restaurantId }] });
  });
  await login(h.api);
  const responses = await Promise.all(memberships.map(membership => h.api.orders(membership.restaurantId)));
  assert.equal(new Set(responses.map(result => result.orders[0].restaurantId)).size, 10);
  mixed = true;
  await assert.rejects(h.api.orders('r0'), error => error.code === 'SCOPE_MISMATCH');
});

test('a disposed restaurant scope discards its in-flight result', async () => {
  const release = deferred(), started = deferred();
  const h = harness(async url => { if (url.endsWith('/login')) return response(200, session()); started.resolve(); await release.promise; return response(200, {}); });
  await login(h.api);
  const scope = h.api.scope('alpha');
  const pending = scope.request();
  const rejected = assert.rejects(pending, error => error.code === 'STALE_SCOPE');
  await started.promise;
  scope.dispose(); release.resolve();
  await rejected;
});

test('duplicate dispatch shares one request and conflicting order actions are blocked', async () => {
  const release = deferred(), started = deferred();
  const h = harness(async url => { if (url.endsWith('/login')) return response(200, session()); started.resolve(); await release.promise; return response(200, {}); });
  await login(h.api);
  const first = h.api.dispatch('alpha', 'order', { method: 'ATLAS_CAR', expectedPrice: 150 });
  const second = h.api.dispatch('alpha', 'order', { method: 'ATLAS_CAR', expectedPrice: 150 });
  await started.promise;
  await assert.rejects(h.api.action('alpha', 'order', 'CANCEL'), error => error.code === 'MUTATION_PENDING');
  release.resolve();
  await Promise.all([first, second]);
  assert.equal(h.calls.filter(call => call.url.endsWith('/dispatch')).length, 1);
});

test('ambiguous network failure never automatically repeats a critical mutation', async () => {
  const h = harness(async url => { if (url.endsWith('/login')) return response(200, session()); throw new Error('connection closed after server write'); });
  await login(h.api);
  await assert.rejects(h.api.dispatch('alpha', 'order', { method: 'ATLAS_CAR', expectedPrice: 150 }), error => error.code === 'NETWORK');
  assert.equal(h.calls.filter(call => call.url.endsWith('/dispatch')).length, 1);
});

test('catalog writes require a matching restaurant and an optimistic version', async () => {
  const h = harness(async () => response(200, session()));
  await login(h.api);
  await assert.rejects(h.api.saveCatalog('alpha', { id: 'beta' }, 'version'), error => error.code === 'MISSING_VERSION');
  await assert.rejects(h.api.saveCatalog('alpha', { id: 'alpha' }, ''), error => error.code === 'MISSING_VERSION');
  assert.equal(h.calls.length, 1);
});

test('profile refresh immediately publishes revoked rights and prevents removed restaurant requests', async () => {
  const h = harness(async url => url.endsWith('/login') ? response(200, session()) : response(200, { user: session().user, memberships: [{ ...member('alpha'), role: 'MANAGER', permissions: ['orders.read'] }] }));
  await login(h.api);
  let notified;
  h.api.subscribe(value => { notified = value; });
  await h.api.me();
  assert.equal(notified.accessToken, 'access-one');
  assert.equal(can(notified.memberships[0], 'orders.manage'), false);
  await assert.rejects(h.api.request('/beta'), error => error.status === 403);
  assert.equal(h.calls.length, 2);
});

test('web adapter keeps tokens in memory and never calls SecureStore or browser persistent storage', async () => {
  let secureCalls = 0;
  const core = load('data/apiCore.ts');
  const { api, mediaUrl } = load('data/api.ts', {
    process: { env: {} },
    fetch: async () => response(200, session()),
    require: name => {
      if (name === 'react-native') return { Platform: { OS: 'web' } };
      if (name === 'expo-secure-store') return new Proxy({}, { get: () => () => { secureCalls++; throw new Error('unexpected secure call'); } });
      if (name === '../../config/api.cjs') return { resolveApiUrl: () => 'https://atlas.test/api' };
      if (name === './apiCore') return core;
      throw new Error(name);
    },
  });
  await login(api);
  assert.equal(secureCalls, 0);
  assert.equal(mediaUrl('/api/content/media/photo'), 'https://atlas.test/api/content/media/photo');
  assert.equal(mediaUrl('javascript:alert(1)'), undefined);
});

test('photo preparation cannot upload into a session that logged in after the photo was selected', async () => {
  const started = deferred(), release = deferred();
  let uploads = 0;
  const { api } = load('data/api.ts', {
    process: { env: {} },
    fetch: async url => {
      if (url === 'blob:photo') { started.resolve(); await release.promise; return { blob: async () => new Blob(['photo'], { type: 'image/jpeg' }) }; }
      if (url.endsWith('/media')) uploads++;
      return response(200, session());
    },
    require: name => name === 'react-native' ? { Platform: { OS: 'web' } } : name === 'expo-secure-store' ? {} : name === '../../config/api.cjs' ? { resolveApiUrl: () => 'https://atlas.test/api' } : load('data/apiCore.ts'),
  });
  await login(api);
  const pending = api.upload('alpha', { uri: 'blob:photo' });
  const rejected = assert.rejects(pending, error => error.code === 'STALE_SESSION');
  await started.promise;
  await api.logout();
  await login(api);
  release.resolve();
  await rejected;
  assert.equal(uploads, 0);
});
