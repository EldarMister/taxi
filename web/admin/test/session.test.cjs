const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../dist/api.js'), 'utf8').replace(/export /g, '');
const KEY = 'taxigo.control.session', LOGOUT = 'taxigo.control.logout';
const saved = token => ({ user: { role: 'ADMIN', id: 'owner' }, accessToken: 'access-' + token, refreshToken: token });
const fresh = token => ({ user: { role: 'ADMIN', id: 'owner', name: 'Test Admin' }, accessToken: 'access-' + token, expiresIn: 900 });
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function browser(local, fetch, options = {}) {
  const events = new Map(), jar = options.jar || new Map();
  const temporary = options.temporary || storage();
  const document = {};
  Object.defineProperty(document, 'cookie', {
    get: () => [...jar.entries()].map(([key, value]) => key + '=' + value).join('; '),
    set: value => { const pair = value.split(';')[0], split = pair.indexOf('='), key = pair.slice(0, split); if (/Max-Age=0(?:;|$)/.test(value)) jar.delete(key); else jar.set(key, pair.slice(split + 1)); },
  });
  const window = { location: { origin: 'https://atlas.example' }, localStorage: local, sessionStorage: temporary,
    addEventListener: (name, callback) => events.set(name, callback), dispatchEvent: event => events.get(event.type)?.(event),
    ...(options.BroadcastChannel ? { BroadcastChannel: options.BroadcastChannel } : {}) };
  const context = vm.createContext({ window, document, navigator: { locks: options.locks }, fetch, Event, FormData, AbortController, setTimeout, clearTimeout, URL });
  vm.runInContext(source + '\nglobalThis.panel = { refresh, restoreSession, session, signIn, signOut, clearSession, logoutPending, api, apiBlob, mediaUrl };', context);
  return { panel: context.panel, events, window, document, jar, temporary };
}
const response = (status, value) => ({ ok: status >= 200 && status < 300, status, json: async () => value, blob: async () => ({ synthetic: true }), headers: { get: () => 'application/pdf' } });
const login = tab => tab.panel.signIn('admin', 'test-password-only');

test('uploaded and external photos resolve without doubling the API prefix', () => {
  const { panel } = browser(storage(), async () => response(200, {}));
  assert.equal(panel.mediaUrl('/api/content/media/current-photo'), 'https://atlas.example/api/content/media/current-photo');
  assert.equal(panel.mediaUrl('/content/media/legacy-photo'), 'https://atlas.example/api/content/media/legacy-photo');
  assert.equal(panel.mediaUrl('https://images.example/current.jpg'), 'https://images.example/current.jpg');
  for (const value of ['', 'javascript:alert(1)', 'data:image/svg+xml,test', '//unknown.example/image', 'https://user:password@example.com/image']) assert.equal(panel.mediaUrl(value), '');
});

test('cookie login sends remember and CSRF header while only username preferences persist', async () => {
  const local = storage(), calls = [];
  const tab = browser(local, async (url, options) => { calls.push({ url, options }); return response(201, { ...fresh('new'), refreshToken: 'must-never-be-kept' }); });
  await tab.panel.signIn('admin', 'test-password-only', true);
  assert.equal(calls[0].url, 'https://atlas.example/api/admin/auth/browser/login');
  assert.equal(calls[0].options.credentials, 'same-origin');
  assert.equal(calls[0].options.headers['X-Atlas-Admin'], '1');
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { username: 'admin', password: 'test-password-only', remember: true });
  assert.equal(tab.panel.session().refreshToken, undefined);
  assert.equal(local.getItem(KEY), null);
  assert.equal(tab.temporary.getItem(KEY), null);
  assert.equal(local.getItem('taxigo.control.username'), 'admin');
  assert.equal(local.getItem('taxigo.control.remember'), '1');
  assert.equal([...local.values.values()].some(value => /access-|refreshToken|password/.test(value)), false);
});

test('remember false uses server session cookie preference without persisting credentials', async () => {
  const local = storage(); local.setItem('taxigo.control.username', 'previous');
  const tab = browser(local, async (_url, options) => { assert.equal(JSON.parse(options.body).remember, false); return response(201, fresh('new')); });
  await tab.panel.signIn('admin', 'test-password-only', false);
  assert.equal(local.getItem(KEY), null); assert.equal(tab.temporary.getItem(KEY), null);
  assert.equal(local.getItem('taxigo.control.username'), null);
  assert.equal(local.getItem('taxigo.control.remember'), '0');
});

test('page reload restores through HttpOnly cookie and never reads access tokens from storage', async () => {
  const local = storage(), calls = [];
  const first = browser(local, async () => response(201, fresh('login')));
  await login(first);
  const reloaded = browser(local, async (url, options) => { calls.push({ url, options }); return response(201, fresh('reloaded')); });
  assert.equal(reloaded.panel.session(), null);
  await reloaded.panel.restoreSession();
  assert.equal(reloaded.panel.session().accessToken, 'access-reloaded');
  assert.equal(calls[0].url, 'https://atlas.example/api/admin/auth/browser/refresh');
  assert.deepEqual(JSON.parse(calls[0].options.body), {});
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(local.getItem(KEY), null);
});

test('legacy saved session migrates once and erases both token stores only after success', async () => {
  const local = storage(), temporary = storage(), gate = deferred(), started = deferred(), calls = [];
  local.setItem(KEY, JSON.stringify(saved('legacy-refresh-token')));
  temporary.setItem(KEY, JSON.stringify(saved('older-temporary-token')));
  const tab = browser(local, async (url, options) => { calls.push({ url, options }); started.resolve(); await gate.promise; return response(201, fresh('migrated')); }, { temporary });
  const migration = tab.panel.restoreSession(); await started.promise;
  assert.notEqual(local.getItem(KEY), null);
  assert.equal(tab.panel.session(), null);
  gate.resolve(); await migration;
  assert.equal(calls[0].url, 'https://atlas.example/api/admin/auth/browser/migrate');
  assert.deepEqual(JSON.parse(calls[0].options.body), { refreshToken: 'legacy-refresh-token', remember: true });
  assert.equal(local.getItem(KEY), null); assert.equal(temporary.getItem(KEY), null);
  assert.equal(tab.panel.session().refreshToken, undefined);
});

test('failed migration retains legacy credentials but yields no unverified protected session', async () => {
  const local = storage(), legacy = JSON.stringify(saved('legacy-refresh-token')); local.setItem(KEY, legacy);
  let calls = 0;
  const tab = browser(local, async () => { calls++; return response(503, { message: 'database unavailable' }); });
  await assert.rejects(tab.panel.restoreSession(), error => error.status === 503);
  assert.equal(local.getItem(KEY), legacy); assert.equal(tab.panel.session(), null);
  await assert.rejects(tab.panel.api('/admin/dashboard'), error => error.code === 'STALE_SESSION');
  assert.equal(calls, 1);
});

test('a lost migration response body recovers through its checked HttpOnly cookie on the next attempt', async () => {
  const local = storage(), legacy = JSON.stringify(saved('legacy-refresh-token')), calls = [];
  local.setItem(KEY, legacy);
  let migratedCookie = false;
  const tab = browser(local, async (url, options) => {
    calls.push(url);
    if (url.endsWith('/migrate')) {
      if (migratedCookie) return response(401, { message: 'old migration token already consumed' });
      migratedCookie = true;
      return { ...response(201, {}), json: async () => { throw new Error('lost response body after Set-Cookie'); } };
    }
    assert.equal(url.endsWith('/browser/refresh'), true);
    assert.equal(options.headers.Authorization, undefined); assert.equal(options.credentials, 'same-origin');
    return response(migratedCookie ? 201 : 401, migratedCookie ? fresh('committed-cookie') : {});
  });
  await assert.rejects(tab.panel.restoreSession());
  assert.equal(local.getItem(KEY), legacy); assert.equal(tab.panel.session(), null);
  await tab.panel.restoreSession();
  assert.equal(tab.panel.session().accessToken, 'access-committed-cookie');
  assert.equal(local.getItem(KEY), null);
  assert.deepEqual(calls.map(url => url.split('/').at(-1)), ['migrate', 'migrate', 'refresh']);
});

test('unavailable cookie fallback retains legacy storage and denies protected bootstrap until retry', async () => {
  const local = storage(), legacy = JSON.stringify(saved('legacy-refresh-token')); local.setItem(KEY, legacy);
  let outage = true, calls = 0;
  const tab = browser(local, async url => {
    calls++;
    if (url.endsWith('/migrate')) return response(401, { message: 'old migration token already consumed' });
    return outage ? response(503, { message: 'cookie validation unavailable' }) : response(201, fresh('checked-cookie'));
  });
  await assert.rejects(tab.panel.restoreSession(), error => error.status === 503);
  assert.equal(local.getItem(KEY), legacy); assert.equal(tab.panel.session(), null);
  await assert.rejects(tab.panel.api('/admin/dashboard'), error => error.code === 'STALE_SESSION');
  assert.equal(calls, 2);
  outage = false; await tab.panel.restoreSession();
  assert.equal(tab.panel.session().accessToken, 'access-checked-cookie'); assert.equal(local.getItem(KEY), null);
});

test('origin or CSRF rejection never triggers a cookie fallback', async () => {
  for (const status of [403, 419]) {
    const local = storage(), legacy = JSON.stringify(saved('legacy-refresh-token')); local.setItem(KEY, legacy);
    let calls = 0;
    const tab = browser(local, async url => { calls++; assert.equal(url.endsWith('/migrate'), true); return response(status, { message: 'origin rejected' }); });
    await assert.rejects(tab.panel.restoreSession(), error => error.status === status);
    assert.equal(calls, 1); assert.equal(local.getItem(KEY), legacy); assert.equal(tab.panel.session(), null);
  }
});

test('migration 401 from an earlier auth epoch cannot fall back into a newer login', async () => {
  const local = storage(), started = deferred(), gate = deferred(), calls = [];
  local.setItem(KEY, JSON.stringify(saved('legacy-refresh-token')));
  const tab = browser(local, async url => {
    calls.push(url);
    if (url.endsWith('/migrate')) { started.resolve(); await gate.promise; return response(401, {}); }
    assert.equal(url.endsWith('/login'), true); return response(201, fresh('new-login'));
  });
  const migration = tab.panel.restoreSession(), rejected = assert.rejects(migration, error => error.code === 'STALE_SESSION');
  await started.promise; const newLogin = login(tab); gate.resolve();
  await Promise.all([rejected, newLogin]);
  assert.equal(tab.panel.session().accessToken, 'access-new-login');
  assert.equal(calls.some(url => url.endsWith('/refresh')), false);
});

test('two tabs refresh the stable cookie independently without sharing or rotating a stored token', async () => {
  const local = storage(); let calls = 0;
  const fetch = async (url, options) => { calls++; assert.equal(url, 'https://atlas.example/api/admin/auth/browser/refresh'); assert.deepEqual(JSON.parse(options.body), {}); return response(201, fresh('cookie-' + calls)); };
  const first = browser(local, fetch), second = browser(local, fetch);
  await Promise.all([first.panel.restoreSession(), second.panel.restoreSession()]);
  await Promise.all([first.panel.refresh(), second.panel.refresh()]);
  assert.equal(calls, 4);
  assert.equal(first.panel.session().refreshToken, undefined);
  assert.equal(second.panel.session().refreshToken, undefined);
  assert.equal(local.getItem(KEY), null);
});

test('concurrent protected 401 responses share one cookie refresh within a tab', async () => {
  let refreshes = 0;
  const tab = browser(storage(), async (url, options) => {
    if (url.endsWith('/login')) return response(201, fresh('old'));
    if (url.endsWith('/refresh')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 10)); return response(201, fresh('new')); }
    return response(options.headers.Authorization === 'Bearer access-new' ? 200 : 401, { ok: true });
  });
  await login(tab);
  const results = await Promise.all([tab.panel.api('/admin/dashboard'), tab.panel.api('/admin/drivers')]);
  assert.equal(refreshes, 1); assert.equal(results.every(result => result.ok), true);
});

test('network and database refresh failures preserve checked memory session; revoked cookie clears it', async () => {
  let failure;
  const tab = browser(storage(), async url => url.endsWith('/login') ? response(201, fresh('active')) : failure());
  await login(tab);
  failure = () => { throw new Error('offline'); };
  await assert.rejects(tab.panel.refresh(), /Нет соединения/);
  assert.equal(tab.panel.session().accessToken, 'access-active');
  failure = () => response(503, { message: 'database unavailable' });
  await assert.rejects(tab.panel.refresh(), error => error.status === 503);
  assert.equal(tab.panel.session().accessToken, 'access-active');
  failure = () => response(401, { message: 'expired' });
  await assert.rejects(tab.panel.refresh(), /expired/);
  assert.equal(tab.panel.session(), null);
});

test('failed explicit logout clears memory immediately and reload retries logout before any bootstrap', async () => {
  const local = storage(), jar = new Map(), calls = []; let outage = true;
  const transport = async url => {
    calls.push(url);
    if (url.endsWith('/login')) return response(201, fresh('active'));
    return response(outage ? 503 : 201, outage ? { message: 'database unavailable' } : { ok: true });
  };
  const tab = browser(local, transport, { jar }); await login(tab);
  const pending = tab.panel.signOut();
  assert.equal(tab.panel.session(), null);
  await assert.rejects(pending, error => error.logoutPending && error.status === 503);
  const reload = browser(local, transport, { jar });
  await assert.rejects(reload.panel.restoreSession(), error => error.logoutPending);
  assert.equal(reload.panel.session(), null);
  assert.equal(calls.some(url => url.endsWith('/refresh')), false);
  outage = false;
  assert.equal(await reload.panel.restoreSession(), null);
  assert.equal(reload.panel.logoutPending(), false);
  assert.equal(jar.has('atlas.admin.logout-pending'), false);
});

test('blocked persistent storage retains offline logout intent using a nonsecret cookie marker', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }, jar = new Map();
  const fetch = async url => url.endsWith('/login') ? response(201, fresh('active')) : response(503, { message: 'offline' });
  const tab = browser(blocked, fetch, { jar }); await login(tab);
  await assert.rejects(tab.panel.signOut(), error => error.logoutPending);
  assert.equal(jar.has('atlas.admin.logout-pending'), true);
  assert.equal([...jar.values()].some(value => /accessToken|refreshToken|password/.test(decodeURIComponent(value))), false);
  const reload = browser(blocked, fetch, { jar });
  await assert.rejects(reload.panel.restoreSession(), error => error.logoutPending);
  assert.equal(reload.panel.session(), null);
});

test('cross-tab logout closes every tab and a queued older marker cannot erase a newer login', async () => {
  const local = storage(), jar = new Map();
  const transport = async url => response(201, url.endsWith('/login') || url.endsWith('/refresh') ? fresh('active') : { ok: true });
  const first = browser(local, transport, { jar }), second = browser(local, transport, { jar });
  await login(first); await second.panel.restoreSession();
  await first.panel.signOut();
  const event = { key: LOGOUT, newValue: local.getItem(LOGOUT) };
  second.events.get('storage')(event);
  assert.equal(second.panel.session(), null);
  await login(second);
  second.events.get('storage')(event);
  assert.equal(second.panel.session().accessToken, 'access-active');
});

test('protected JSON and blob success arriving after logout never repopulate data', async () => {
  for (const kind of ['json', 'blob']) {
    const started = deferred(), gate = deferred();
    const tab = browser(storage(), async url => {
      if (url.endsWith('/login')) return response(201, fresh('active'));
      if (url.endsWith('/logout')) return response(201, { ok: true });
      started.resolve(); await gate.promise; return response(200, { private: true });
    });
    await login(tab);
    const operation = kind === 'json' ? tab.panel.api('/admin/dashboard') : tab.panel.apiBlob('/admin/private-file');
    const rejection = assert.rejects(operation, error => error.code === 'STALE_SESSION');
    await started.promise; await tab.panel.signOut(); gate.resolve(); await rejection;
    assert.equal(tab.panel.session(), null);
  }
});

test('late refresh cannot resurrect a logged-out session', async () => {
  const started = deferred(), gate = deferred();
  const tab = browser(storage(), async url => {
    if (url.endsWith('/login')) return response(201, fresh('active'));
    if (url.endsWith('/logout')) return response(201, { ok: true });
    started.resolve(); await gate.promise; return response(201, fresh('late'));
  });
  await login(tab);
  const operation = tab.panel.refresh(), rejected = assert.rejects(operation, error => error.code === 'STALE_SESSION');
  await started.promise; await tab.panel.signOut(); gate.resolve(); await rejected;
  assert.equal(tab.panel.session(), null);
});

test('a superseded login result cannot commit after logout and a later login', async () => {
  const started = deferred(), gate = deferred(); let logins = 0;
  const tab = browser(storage(), async url => {
    if (url.endsWith('/login')) { logins++; if (logins === 1) { started.resolve(); await gate.promise; } return response(201, fresh('login-' + logins)); }
    return response(201, { ok: true });
  });
  const first = login(tab), rejected = assert.rejects(first, error => error.code === 'STALE_SESSION');
  await started.promise;
  const out = tab.panel.signOut(), next = login(tab); gate.resolve();
  await Promise.all([rejected, out, next]);
  assert.equal(tab.panel.session().accessToken, 'access-login-2');
});

test('blocked storage does not prevent current-page cookie login and checked API access', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const tab = browser(blocked, async url => response(201, url.endsWith('/login') ? fresh('active') : { ok: true }));
  await login(tab);
  assert.equal(tab.panel.session().refreshToken, undefined);
  assert.equal((await tab.panel.api('/admin/dashboard')).ok, true);
});
