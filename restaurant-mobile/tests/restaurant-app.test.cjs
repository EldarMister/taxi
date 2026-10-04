const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/restaurant', file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const result = {};
  vm.runInNewContext(compiled, { exports: result, console, setTimeout, clearTimeout, AbortController, FormData, process: { env: {} }, ...extra });
  return result;
}
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
function session(fetch, storageHooks = {}) {
  const storage = new Map();
  const secure = { getItemAsync: async key => storage.get(key), setItemAsync: async (key, value) => { await storageHooks.beforeSet?.(key, value); storage.set(key, value); }, deleteItemAsync: async key => { await storageHooks.beforeDelete?.(key); storage.delete(key); } };
  const module = load('api.ts', { fetch, require: name => name === 'expo-secure-store' ? secure : { resolveApiUrl: () => 'https://example.invalid/api' } });
  return { ...module, storage };
}

test('standalone app retains its install identity regardless of taxi environment', () => {
  const file = path.join(__dirname, '../app.config.ts');
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const APP_VARIANT of ['client', 'driver', undefined]) {
    const result = {};
    vm.runInNewContext(compiled, { exports: result, process: { env: { APP_VARIANT, EXPO_PUBLIC_EAS_PROJECT_ID: 'taxi-project', DRIVER_GOOGLE_SERVICES_FILE: 'taxi.json' } }, require: () => require('../config/api.cjs') });
    assert.equal(result.default.name, 'Atlas Restaurant');
    assert.equal(result.default.android.package, 'kg.taxigo.restaurant');
    assert.equal(result.default.ios.bundleIdentifier, 'kg.taxigo.restaurant');
    assert.equal(result.default.extra.eas, undefined);
    assert.equal(result.default.android.googleServicesFile, undefined);
  }
});

test('all application source imports and dependencies belong to this project', () => {
  const root = path.resolve(__dirname, '..');
  function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
  }
  const files = [path.join(root, 'App.tsx'), path.join(root, 'index.ts'), path.join(root, 'app.config.ts'), ...walk(path.join(root, 'src'))];
  const pkg = require('../package.json');
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    for (const match of code.matchAll(/(?:from\s*|require\(\s*)['"]([^'"]+)['"]/g)) {
      const name = match[1];
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(file), name);
        assert.ok(resolved.startsWith(root + path.sep), `${file}: external import ${name}`);
        assert.ok(['', '.ts', '.tsx', '.js', '.cjs'].some(ext => fs.existsSync(resolved + ext)), `${file}: missing ${name}`);
      } else {
        const dep = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
        assert.ok(pkg.dependencies[dep], `Undeclared dependency ${dep}`);
        assert.ok(require.resolve(dep, { paths: [root] }).startsWith(path.join(root, 'node_modules') + path.sep), `Dependency outside project: ${dep}`);
      }
    }
  }
  for (const spec of Object.values(pkg.dependencies)) assert.ok(!/^(file:|link:|workspace:)/.test(spec));
});
test('manager access follows assigned permissions while owner can use every section', () => {
  const { can, permissions } = load('types.ts');
  const manager = { role: 'MANAGER', permissions: ['orders.read', 'orders.manage'] };
  assert.equal(can(manager, 'orders.manage'), true);
  for (const permission of ['menu.manage', 'restaurant.manage', 'delivery.manage', 'promotions.manage', 'staff.manage', 'stats.read']) assert.equal(can(manager, permission), false);
  for (const [permission] of permissions) assert.equal(can({ role: 'OWNER', permissions: [] }, permission), true);
  assert.equal(can({ ...manager, permissions: [...manager.permissions, 'menu.manage'] }, 'menu.manage'), true);
  assert.equal(can(undefined, 'orders.read'), false);
});
test('editing a promotion preserves its Bishkek calendar date across saves', () => {
  const { restaurantDateInput, restaurantDateValue } = load('editorState.ts');
  for (const day of ['2026-01-01', '2026-10-04', '2028-02-29']) {
    assert.equal(restaurantDateInput(restaurantDateValue(day)), day);
    assert.equal(restaurantDateInput(restaurantDateValue(day, true)), day);
  }
  assert.equal(restaurantDateValue('2026-10-04'), '2026-10-03T18:00:00.000Z');
  assert.equal(restaurantDateInput(null), '');
  assert.throws(() => restaurantDateValue('2026-02-30'));
  assert.throws(() => restaurantDateValue('04.10.2026'));
});
test('restaurant login stores only merchant tokens in an independent secure key', async () => {
  const calls = [];
  const { restaurantApi, storage } = session(async (url, init) => {
    calls.push({ url, init });
    return response(200, { accessToken: 'merchant-access', refreshToken: 'merchant-refresh', user: { name: 'Owner' }, memberships: [] });
  });
  await restaurantApi.login('+996700000000', 'test-password-only');
  assert.equal(calls[0].url, 'https://example.invalid/api/restaurant/auth/login');
  assert.equal(JSON.parse(calls[0].init.body).phone, '+996700000000');
  assert.deepEqual(JSON.parse(storage.get('atlas.restaurant.session.v1')), { accessToken: 'merchant-access', refreshToken: 'merchant-refresh' });
});
test('concurrent expired merchant requests rotate once and retry with the new token', async () => {
  let refreshes = 0;
  const { restaurantApi } = session(async (url, init) => {
    if (url.endsWith('/login')) return response(200, { accessToken: 'old-access', refreshToken: 'old-refresh' });
    if (url.endsWith('/refresh')) { refreshes++; await new Promise(resolve => setTimeout(resolve, 5)); return response(200, { accessToken: 'new-access', refreshToken: 'new-refresh' }); }
    return init.headers.Authorization === 'Bearer new-access' ? response(200, { ok: true }) : response(401, { message: 'Expired' });
  });
  await restaurantApi.login('+996700000000', 'test-password-only');
  const results = await Promise.all([restaurantApi.request('/one'), restaurantApi.request('/two')]);
  assert.equal(refreshes, 1);
  assert.equal(results.every(result => result.ok), true);
});
test('logout clears tokens before the server response and cannot be undone by a late refresh', async () => {
  let releaseRefresh;
  let startedRefresh;
  const began = new Promise(resolve => { startedRefresh = resolve; });
  const { restaurantApi, storage } = session(async (url) => {
    if (url.endsWith('/login')) return response(200, { accessToken: 'old', refreshToken: 'old-refresh' });
    if (url.endsWith('/refresh')) { startedRefresh(); await new Promise(resolve => { releaseRefresh = resolve; }); return response(200, { accessToken: 'late', refreshToken: 'late-refresh' }); }
    if (url.endsWith('/logout')) return response(200, { ok: true });
    return response(401, { message: 'Expired' });
  });
  await restaurantApi.login('+996700000000', 'test-password-only');
  const pending = restaurantApi.request('/one');
  const rejected = assert.rejects(pending, /Сессия завершена/);
  await began;
  await restaurantApi.logout();
  releaseRefresh();
  await rejected;
  assert.equal(storage.size, 0);
  await assert.rejects(restaurantApi.request('/one'), /Войдите/);
});

test('logout during the SecureStore refresh write queues deletion after that write and fences memory', async () => {
  let releaseWrite;
  let enteredWrite;
  const entered = new Promise(resolve => { enteredWrite = resolve; });
  const { restaurantApi, storage } = session(async (url, init) => {
    if (url.endsWith('/login')) return response(200, { accessToken: 'old', refreshToken: 'old-refresh' });
    if (url.endsWith('/refresh')) return response(200, { accessToken: 'rotated', refreshToken: 'rotated-refresh' });
    if (url.endsWith('/logout')) return response(200, { ok: true });
    return init.headers.Authorization === 'Bearer rotated' ? response(200, { ok: true }) : response(401, { message: 'Expired' });
  }, {
    beforeSet: async (_key, value) => {
      if (JSON.parse(value).accessToken === 'rotated') { enteredWrite(); await new Promise(resolve => { releaseWrite = resolve; }); }
    },
  });
  await restaurantApi.login('+996700000000', 'test-password-only');
  const pending = restaurantApi.request('/one');
  const rejected = assert.rejects(pending, /Сессия завершена/);
  await entered;
  const logout = restaurantApi.logout();
  await assert.rejects(restaurantApi.request('/one'), /Войдите/);
  releaseWrite();
  await Promise.all([logout, rejected]);
  assert.equal(storage.size, 0);
  await assert.rejects(restaurantApi.request('/one'), /Войдите/);
});

test('a queued logout deletion never notifies a newer login or deletes its tokens', async () => {
  let releaseDelete;
  let enteredDelete;
  let completedLoginRequest;
  let logins = 0;
  const deleted = new Promise(resolve => { enteredDelete = resolve; });
  const secondLoginResponded = new Promise(resolve => { completedLoginRequest = resolve; });
  const { restaurantApi, storage } = session(async (url, init) => {
    if (url.endsWith('/login')) {
      logins++;
      if (logins === 2) completedLoginRequest();
      return response(200, { accessToken: `access-${logins}`, refreshToken: `refresh-${logins}` });
    }
    if (url.endsWith('/logout')) return response(200, { ok: true });
    return response(200, { authorization: init.headers.Authorization });
  }, { beforeDelete: async () => { enteredDelete(); await new Promise(resolve => { releaseDelete = resolve; }); } });
  await restaurantApi.login('+996700000000', 'test-password-only');
  let notifications = 0;
  restaurantApi.subscribe(() => { notifications++; });
  const logout = restaurantApi.logout();
  await deleted;
  const nextLogin = restaurantApi.login('+996700000001', 'another-test-password');
  await secondLoginResponded;
  // Let login consume the JSON response and increment the session generation.
  await new Promise(resolve => setTimeout(resolve, 0));
  releaseDelete();
  await Promise.all([logout, nextLogin]);
  assert.equal(notifications, 0);
  assert.equal(JSON.parse(storage.get('atlas.restaurant.session.v1')).accessToken, 'access-2');
  assert.equal((await restaurantApi.request('/one')).authorization, 'Bearer access-2');
});
