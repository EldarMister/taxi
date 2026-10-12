import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { assertLoadTarget, validateLoadManifest } from '../load/target.mjs';
import { LOAD_ROLES, rolePlan, roleSlot, bookingActorIndex, validateRoleFixtures } from '../load/roles.mjs';
// Execute the actual k6 script against an in-memory protocol fixture. This does
// not replace a k6/API load run; it catches wrong routes, statuses and metrics.
test('k6 fixture exercises creation, identical retry, acceptance and completion for food and taxi', () => {
  const profile = { ...JSON.parse(readFileSync(resolve(import.meta.dirname, '../load/profile.example.json'), 'utf8')), durationSeconds: 120, resources: { host: { os: 'synthetic' }, api: { cpu: 1, memoryMiB: 256, replicas: 1 }, postgres: { cpu: 1, memoryMiB: 256, replicas: 1 }, generator: { cpu: 1, memoryMiB: 256, replicas: 1 } } };
  const fixture = { fixtureRunId: profile.fixtureRunId, clients: Array.from({ length: 40 }, (_, index) => ({ userId: `client-${index}`, token: `client-${index}`, restaurantId: 'fixture-restaurant', items: [{ dishId: 'fixture', quantity: 1, optionIds: [] }] })), drivers: Array.from({ length: 8 }, (_, index) => ({ userId: `driver-${index}`, token: `driver-${index}` })), restaurants: [{ accountId: 'owner', token: 'owner', restaurantId: 'fixture-restaurant' }, { accountId: 'owner2', token: 'owner2', restaurantId: 'fixture-restaurant2' }], pickup: {}, dropoff: {}, tariffId: 'fixture' };
  const values = {}; class Rate { constructor(name) { this.name = name; values[name] ||= []; } add(value) { values[this.name].push(Boolean(value)); } } class Counter { constructor(name) { this.name = name; values[name] ||= []; } add(value) { values[this.name].push(value); } }
  let food, taxi, now = 0, requests = 0; const keyed = new Map();
  const http = { post() { return { status: 200, json: () => ({ slot: 0 }) }; }, request(method, url, payload) {
    requests++;
    const data = payload ? JSON.parse(payload) : {}, path = url.replace(profile.target, ''); let body = {}, status = 200;
    if (method === 'POST' && ['/food/orders', '/orders'].includes(path)) {
      const key = data.requestId || data.idempotencyKey;
      if (!keyed.has(key)) { const order = { id: key, status: path === '/food/orders' ? 'PLACED' : 'SEARCHING' }; keyed.set(key, order); if (path === '/food/orders') food = order; else taxi = order; }
      body = keyed.get(key); status = 201;
    } else if (path === '/orders/quote') { body = { id: 'quote' }; status = 201; }
    else if (path === '/orders/active') body = taxi && taxi.status !== 'SEARCHING' ? taxi : {};
    else if (path === '/driver/offers') body = taxi && taxi.status === 'SEARCHING' ? [taxi] : [];
    else if (path.endsWith('/orders') && path.startsWith('/restaurant/')) body = { orders: food ? [food] : [] };
    else if (method === 'PATCH' && path.startsWith('/restaurant/')) { food.status = { ACCEPT: 'CONFIRMED', PREPARING: 'PREPARING', READY: 'READY', COMPLETE: 'COMPLETED' }[data.action]; body = food; }
    else if (method === 'POST' && path.startsWith('/orders/')) { const action = path.split('/').at(-1); taxi.status = { accept: 'ASSIGNED', arrive: 'ARRIVED', start: 'IN_PROGRESS', complete: 'COMPLETED' }[action]; body = taxi; status = 201; }
    return { status, json: () => JSON.parse(JSON.stringify(body)), error: '', error_code: 0 };
  } };
  const execution = { scenario: { iterationInTest: 0 } };
  const source = readFileSync(resolve(import.meta.dirname, '../load/http.k6.js'), 'utf8').replace(/^import .*;\n/gm, '').replaceAll('export ', '');
  function process(role) { const context = vm.createContext({ http, execution, crypto: { sha256: () => 'immutable' }, console: { log() {} }, Rate, Counter, SharedArray: class { constructor(_name, callback) { return callback(); } }, open: name => JSON.stringify(name === 'manifest' ? profile : fixture), assertLoadTarget, validateLoadManifest, LOAD_ROLES, rolePlan, roleSlot, bookingActorIndex, validateRoleFixtures, sleep() {}, __ENV: { LOAD_ROLE: role, LOAD_FIXTURE_DIGEST: 'immutable', LOAD_MANIFEST: 'manifest', LOAD_FIXTURES: 'fixtures' }, __VU: 1, __ITER: 0, Math, Date: class extends Date { static now() { return now; } } }); vm.runInContext(source + '\nthis.scenario={bookOrder,restaurantWork,driverWork};', context); return context; }
  const context = process('booking'), merchant = process('restaurants'), driver = process('drivers');
  context.scenario.bookOrder(); context.__ITER = 1; execution.scenario.iterationInTest = 1; context.scenario.bookOrder();
  for (let step = 0; step < 5; step++) { merchant.scenario.restaurantWork(); now += 13000; driver.scenario.driverWork(); }
  assert.equal(food.status, 'COMPLETED'); assert.equal(taxi.status, 'COMPLETED');
  assert.equal(values.orders_created.reduce((a, b) => a + b, 0), 2);
  assert.equal(values.orders_completed.reduce((a, b) => a + b, 0), 2);
  assert.equal(values.orders_accepted.reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(values.idempotent_retry_success, [true, true]);
  assert.ok(values.unexpected_responses.every(value => !value));
  const beforeBoundary = requests;
  execution.scenario.iterationInTest = 20;
  context.scenario.bookOrder();
  assert.equal(requests, beforeBoundary, 'an extra cutoff executor iteration cannot send a quote/create/retry request');
  assert.equal(values.orders_created.reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(values.executor_boundary_iterations, [1]);
});
