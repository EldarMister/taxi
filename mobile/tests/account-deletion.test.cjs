const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function setup() {
  const values = new Map(), cache = new Map();
  let failDelete = false;
  const secure = { getItemAsync: async key => values.get(key) || null, setItemAsync: async (key, value) => values.set(key, value), deleteItemAsync: async key => { if (failDelete && key.startsWith('taxi.food')) throw Error('storage error'); values.delete(key); } };
  function load(relative) {
    const file = path.resolve(__dirname, '../src', relative);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(code, { exports, TextEncoder, require: id => {
      if (id === 'expo-secure-store') return secure;
      const dependency = path.resolve(path.dirname(file), id + '.ts');
      if (dependency.endsWith(path.join('native', 'push.ts'))) return { forgetPushNotifications: () => secure.deleteItemAsync('taxi.pushToken') };
      return load(dependency);
    } });
    return exports;
  }
  return { values, load, fail: () => { failDelete = true; } };
}

test('deletion erases device addresses, food and registration generations without allowing delayed writes to recreate them', async () => {
  const h = setup(), places = h.load('savedPlaces.ts'), food = h.load('food/storage.ts'), registration = h.load('registration/storage.ts'), deletion = h.load('accountDeletion.ts');
  const point = { latitude: 42.87, longitude: 74.57, address: 'Личный адрес' };
  const state = { restaurantId: null, lines: [], favorites: ['one'], favoriteDishes: [], address: point.address };
  for (const user of ['deleted', 'untouched']) {
    await places.writeSavedPlaces(user, { home: point }); await food.writeFoodState(user, state);
    await registration.writeRegistrationDraft(user, { id: user, data: { personal: { firstName: 'Личное имя'.repeat(400) } } });
  }
  h.values.set('taxi.pushToken', 'token'); h.values.set('taxi.lastOrderId', 'old-order'); h.values.set('taxi.permissionIntro.v1.deleted', 'done');
  const writes = [places.writeSavedPlaces('deleted', { work: point }), food.writeFoodState('deleted', state), registration.writeRegistrationDraft('deleted', { data: { personal: 'late' } })];
  const removed = deletion.clearAccountLocalData('deleted');
  const late = [places.writeSavedPlaces('deleted', { home: point }), food.writeFoodState('deleted', state), registration.writeRegistrationDraft('deleted', { data: { personal: 'later' } })];
  await Promise.all([...writes, removed, ...late]);
  assert.equal([...h.values.keys()].some(key => key.includes('deleted')), false);
  assert.equal(h.values.has('taxi.lastOrderId'), false); assert.equal(h.values.has('taxi.pushToken'), false);
  assert.ok(await places.readSavedPlaces('untouched')); assert.ok(await food.readFoodState('untouched')); assert.ok(await registration.readRegistrationDraft('untouched'));
  assert.equal(await food.readFoodState('deleted'), null);
});

test('a failed cache removal still attempts all other data categories and reports the device cleanup needed', async () => {
  const h = setup(); h.values.set('taxi.food.v1.deleted', 'private'); h.values.set('taxi.saved-places.v1.deleted', 'private'); h.values.set('taxi.pushToken', 'private'); h.fail();
  await assert.rejects(h.load('accountDeletion.ts').clearAccountLocalData('deleted'), /Очистите данные приложения/);
  assert.equal(h.values.has('taxi.saved-places.v1.deleted'), false); assert.equal(h.values.has('taxi.pushToken'), false);
});
