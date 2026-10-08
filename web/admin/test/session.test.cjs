const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const source = readFileSync(require('node:path').join(__dirname, '../dist/api.js'), 'utf8').replace(/export /g, '');
const KEY = 'taxigo.control.session';
const saved = token => ({ user: { role: 'ADMIN', id: 'owner' }, accessToken: `access-${token}`, refreshToken: token });
function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
function browser(local, fetch, locks) {
  const events = new Map();
  const window = { location: { origin: 'https://atlas.example' }, localStorage: local, sessionStorage: storage(), addEventListener: (name, callback) => events.set(name, callback), dispatchEvent: event => events.get(event.type)?.(event) };
  const context = vm.createContext({ window, navigator: { locks }, fetch, Event, FormData, AbortController, setTimeout, clearTimeout, URL });
  vm.runInContext(source + '\nglobalThis.panel = { refresh, session, signIn, api };', context);
  return { panel: context.panel, events, window };
}
const response = (status, value) => ({ ok: status < 400, status, json: async () => value });

test('two tabs rotate a shared refresh token exactly once', async () => {
  const local = storage(); local.setItem(KEY, JSON.stringify(saved('old')));
  let calls = 0, queue = Promise.resolve();
  const locks = { request(_name, action) { const next = queue.then(action); queue = next.catch(() => {}); return next; } };
  const fetch = async (url, options) => { calls++; assert.equal(url, 'https://atlas.example/api/auth/refresh'); assert.equal(JSON.parse(options.body).refreshToken, 'old'); await new Promise(resolve => setTimeout(resolve, 10)); return response(201, saved('new')); };
  const first = browser(local, fetch, locks), second = browser(local, fetch, locks);
  await Promise.all([first.panel.refresh(), second.panel.refresh()]);
  assert.equal(calls, 1);
  assert.equal(first.panel.session().refreshToken, 'new');
  assert.equal(second.panel.session().refreshToken, 'new');
});

test('network failure keeps the session, while rejected refresh clears it', async () => {
  const local = storage(); local.setItem(KEY, JSON.stringify(saved('old')));
  const offline = browser(local, async () => { throw new Error('offline'); });
  await assert.rejects(offline.panel.refresh(), /Нет соединения/);
  assert.equal(offline.panel.session().refreshToken, 'old');
  const expired = browser(local, async () => response(401, { message: 'expired' }));
  await assert.rejects(expired.panel.refresh(), /expired/);
  assert.equal(expired.panel.session(), null);
  assert.equal(local.getItem(KEY), null);
});

test('blocked storage does not prevent login and API access during this page session', async () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const tab = browser(blocked, async url => response(201, url.endsWith('/login') ? saved('new') : { ok: true }));
  await tab.panel.signIn('admin', 'test-password-only');
  assert.equal(tab.panel.session().refreshToken, 'new');
  assert.equal((await tab.panel.api('/admin/me')).ok, true);
});

test('logout in another tab closes this tab, but queued removal during a new login does not erase it', () => {
  const local = storage(); local.setItem(KEY, JSON.stringify(saved('old')));
  const tab = browser(local, async () => response(200, {}));
  const event = { storageArea: local, key: KEY, newValue: null };
  local.setItem(KEY, JSON.stringify(saved('new')));
  tab.events.get('storage')(event);
  assert.ok(tab.panel.session());
  local.removeItem(KEY);
  tab.events.get('storage')(event);
  assert.equal(tab.panel.session(), null);
});
