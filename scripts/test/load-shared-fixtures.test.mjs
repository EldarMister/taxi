import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { sharedRoleFixtures, validateFullFixtures } from '../load/shared-fixtures.mjs';
import { assertLoadTarget, validateLoadManifest } from '../load/target.mjs';
import { roleSlot, bookingActorIndex } from '../load/roles.mjs';

function fixtures(profile) {
  return { fixtureRunId: profile.fixtureRunId, clients: Array.from({ length: 800 }, (_, i) => ({ userId: `c-${i}`, token: `token-c-${i}`, items: [{ dishId: 'synthetic-dish', quantity: 1, optionIds: [] }] })), drivers: Array.from({ length: 150 }, (_, i) => ({ userId: `d-${i}`, token: `token-d-${i}` })), restaurants: Array.from({ length: 50 }, (_, i) => ({ accountId: `r-${i}`, token: `token-r-${i}`, restaurantId: `restaurant-${i}` })), pickup: { latitude: 43.2, longitude: 76.9 }, dropoff: { latitude: 43.3, longitude: 77 }, tariffId: 'economy' };
}
const profile = { ...JSON.parse(readFileSync(new URL('../load/profile.example.json', import.meta.url), 'utf8')), activeUsers: 1000, durationSeconds: 120, resources: { host: { os: 'synthetic' }, api: { cpu: 1, memoryMiB: 256, replicas: 1 }, postgres: { cpu: 1, memoryMiB: 256, replicas: 1 }, generator: { cpu: 1, memoryMiB: 256, replicas: 1 } } };
const sha256 = text => createHash('sha256').update(text).digest('hex');

// Model k6's JSON-per-element storage and copy-on-get, including rejection of
// bulk traversal. This catches eager fixture copies across independent VUs.
function sharedRuntime(fixture) {
  const stored = new Map(), gets = [], text = JSON.stringify(fixture), digest = sha256(text);
  let inside = false, opens = 0, hashes = 0;
  class SharedArray {
    constructor(name, callback) {
      if (!stored.has(name)) {
        inside = true;
        try { stored.set(name, callback().map(JSON.stringify)); } finally { inside = false; }
      }
      const rows = stored.get(name);
      return new Proxy({}, { get(_target, key) {
        if (key === 'length') return rows.length;
        if (typeof key === 'string' && /^\d+$/.test(key)) { const row = rows[Number(key)]; gets.push({ name, index: Number(key), chars: row?.length }); return row === undefined ? undefined : JSON.parse(row); }
        throw new Error('Bulk SharedArray access is forbidden by the regression fixture.');
      } });
    }
  }
  return { SharedArray, digest, gets, stored, get opens() { return opens; }, get hashes() { return hashes; },
    open() { assert.equal(inside, true, 'full fixture must only open inside a shared callback'); opens++; return text; },
    sha256(value) { assert.equal(inside, true, 'fixture SHA must only run inside a shared callback'); hashes++; return sha256(value); } };
}

test('1000-actor fixture stays shared while VUs receive bounded metadata and only their actor', () => {
  const fixture = fixtures(profile), runtime = sharedRuntime(fixture);
  for (let slot = 0; slot < 760; slot++) {
    const view = sharedRoleFixtures({ ...runtime, path: 'fixtures', expectedDigest: runtime.digest, role: 'clients', profile });
    assert.deepEqual(Object.keys(view.groups), ['clients']);
    assert.equal(view.groups.clients[slot].userId, fixture.clients[slot].userId);
    assert.equal(view.metadata.plan.clients, 760);
    assert.ok(!JSON.stringify(view.metadata).includes('token-'));
  }
  assert.equal(runtime.opens, 2, 'metadata and actor array load once per process, independent of VU count');
  assert.equal(runtime.hashes, 2);
  assert.equal(runtime.gets.filter(g => g.name.endsWith('-clients')).length, 760);
  assert.equal(runtime.gets.filter(g => g.name.endsWith('-metadata')).length, 760);
  assert.ok(runtime.gets.filter(g => g.name.endsWith('-metadata')).every(g => g.chars < 4096));
  assert.ok([...runtime.stored.values()].every(rows => rows.every(row => row.length < 4096)));
  const small = validateFullFixtures(fixture, { ...profile, activeUsers: 50 }, runtime.digest);
  const large = validateFullFixtures(fixture, profile, runtime.digest);
  assert.ok(Math.abs(JSON.stringify(small).length - JSON.stringify(large).length) < 10, 'metadata does not grow with actor payloads');
});

test('full validation rejects changed SHA, unselected invalid actors, cross-role collisions and oversized metadata', () => {
  const fixture = fixtures(profile);
  function load(input, expectedDigest) {
    const runtime = sharedRuntime(input);
    return sharedRoleFixtures({ ...runtime, path: 'fixtures', expectedDigest: expectedDigest || runtime.digest, role: 'clients', profile: { ...profile, activeUsers: 50 } });
  }
  assert.throws(() => load(fixture, 'different'), /digest mismatch/);
  const badToken = structuredClone(fixture); badToken.clients[799].token = '';
  assert.throws(() => load(badToken), /ownership/);
  const collision = structuredClone(fixture); collision.restaurants[49].accountId = fixture.drivers[149].userId;
  assert.throws(() => load(collision), /ownership/);
  const hugeMetadata = structuredClone(fixture); hugeMetadata.pickup = { accidentalPayload: 'x'.repeat(4096) };
  assert.throws(() => load(hugeMetadata), /bounded size/);
});

test('actual k6 scenario keeps actor routes, quota, booking indices and request mix without bulk copies', () => {
  const fixture = fixtures(profile), source = readFileSync(new URL('../load/http.k6.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
  const requests = [], logs = [], execution = { scenario: { iterationInTest: 0 } };
  class Metric { add() {} }
  function process(role) {
    const runtime = sharedRuntime(fixture);
    return { runtime, vu(vu) {
      const context = vm.createContext({ SharedArray: runtime.SharedArray, sharedRoleFixtures, crypto: { sha256: runtime.sha256 }, open: name => name === 'manifest' ? JSON.stringify(profile) : runtime.open(), assertLoadTarget, validateLoadManifest, roleSlot, bookingActorIndex, execution, Rate: Metric, Counter: Metric, sleep() {}, __VU: vu, __ITER: 0, __ENV: { LOAD_ROLE: role, LOAD_FIXTURE_DIGEST: runtime.digest, LOAD_MANIFEST: 'manifest', LOAD_FIXTURES: 'fixtures' }, console: { log: line => logs.push(JSON.parse(line)) }, http: { request(method, url, body, options) {
        requests.push({ method, path: new URL(url).pathname, body: body ? JSON.parse(body) : null, token: options.headers.Authorization, timeout: options.timeout });
        return { status: method === 'POST' ? 201 : 200, error_code: 0, error: '', json: () => method === 'POST' ? { id: 'synthetic-order' } : {} };
      } } });
      vm.runInContext(source + '\nthis.scenario={clientRead,driverWork,restaurantWork,bookOrder};', context);
      return context;
    } };
  }
  const clients = process('clients');
  for (const vu of [1, 380, 760]) {
    const context = clients.vu(vu), before = requests.length;
    context.scenario.clientRead(); context.scenario.clientRead();
    assert.deepEqual(requests.slice(before).map(r => r.path), ['/api/orders/active', '/api/food/orders/active-all', '/api/food/catalog', '/api/orders/active', '/api/food/orders/active-all', '/api/food/catalog']);
    assert.ok(requests.slice(before).every(r => r.token === `Bearer token-c-${vu - 1}` && r.timeout === '18s'));
  }
  assert.equal(clients.runtime.opens, 2);
  assert.equal(clients.runtime.gets.filter(g => g.name.endsWith('-clients')).length, 3, 'actor element is cached once per closed-role VU');
  assert.throws(() => clients.vu(761).scenario.clientRead(), /quota/);
  const driver = process('drivers').vu(150); driver.scenario.driverWork();
  assert.equal(requests.at(-1).token, 'Bearer token-d-149');
  const merchant = process('restaurants').vu(50); merchant.scenario.restaurantWork();
  assert.equal(requests.at(-1).path, '/api/restaurant/restaurant-49/orders');
  const booking = process('booking'), context = booking.vu(1);
  for (const iteration of [0, 1, 399]) {
    execution.scenario.iterationInTest = iteration; const before = requests.length; context.scenario.bookOrder();
    const made = requests.slice(before), expected = (760 + iteration) % 800;
    assert.ok(made.every(r => r.token === `Bearer token-c-${expected}`));
    assert.deepEqual(made.map(r => r.path), iteration % 2 ? ['/api/orders/quote', '/api/orders', '/api/orders'] : ['/api/food/orders', '/api/food/orders']);
    if (!iteration) assert.equal(made[0].body.restaurantId, 'restaurant-0');
  }
  const before = requests.length; execution.scenario.iterationInTest = 400; context.scenario.bookOrder();
  assert.equal(requests.length, before, 'boundary iteration must perform no HTTP');
  assert.equal(booking.runtime.opens, 3);
  assert.equal(booking.runtime.gets.filter(g => g.name.endsWith('-clients')).length, 3);
  assert.deepEqual(logs.filter(x => x.kind === 'booking-actor').map(x => x.actorId), ['c-760', 'c-761', 'c-359']);
});
