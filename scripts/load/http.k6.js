import http from 'k6/http';
import { sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import execution from 'k6/execution';
import crypto from 'k6/crypto';
import { assertLoadTarget, validateLoadManifest } from './target.mjs';
import { roleSlot, bookingActorIndex } from './roles.mjs';
import { sharedRoleFixtures } from './shared-fixtures.mjs';
const profile = validateLoadManifest(JSON.parse(open(__ENV.LOAD_MANIFEST)));
const base = assertLoadTarget(profile.target, profile.approvedStagingOrigin);
const role = __ENV.LOAD_ROLE;
const { metadata: fixtures, groups } = sharedRoleFixtures({ SharedArray, open, sha256: text => crypto.sha256(text, 'hex'), path: __ENV.LOAD_FIXTURES, expectedDigest: __ENV.LOAD_FIXTURE_DIGEST, role, profile });
const { fixtureDigest, plan } = fixtures;
const clients = Math.floor(profile.activeUsers * .8), drivers = Math.round(profile.activeUsers * .15), restaurants = profile.activeUsers - clients - drivers;
const booking = Math.max(1, Math.floor(clients * .05)), browse = clients - booking;
const clientAccounts = groups.clients, driverAccounts = groups.drivers, merchantAccounts = groups.restaurants;
const bad429 = new Rate('unexpected_429'), timeouts = new Rate('request_timeouts'), unexpected = new Rate('unexpected_responses');
const created = new Rate('order_create_success'), accepted = new Rate('order_accept_success'), processed = new Rate('order_process_success');
const completed = new Counter('orders_completed'), orderCount = new Counter('orders_created'), acceptedCount = new Counter('orders_accepted'), operations = new Counter('critical_operations'), duplicate = new Rate('idempotent_retry_success');
const executorBoundary = new Counter('executor_boundary_iterations');
if (profile.durationSeconds < 120) throw new Error('Need at least 120s including the fixed 60s completion drain.');
export const options = {
  setupTimeout: '50s', scenarios: Object.fromEntries(Object.entries({
    clients: { executor: 'constant-vus', vus: browse, duration: `${profile.durationSeconds}s`, exec: 'clientRead' },
    drivers: { executor: 'constant-vus', vus: drivers, duration: `${profile.durationSeconds}s`, exec: 'driverWork' },
    restaurants: { executor: 'constant-vus', vus: restaurants, duration: `${profile.durationSeconds}s`, exec: 'restaurantWork' },
    booking: { executor: 'constant-arrival-rate', rate: clients, timeUnit: '120s', duration: `${profile.durationSeconds - 60}s`, preAllocatedVUs: booking, maxVUs: booking, exec: 'bookOrder' },
  }).filter(([name]) => name === role)),
  // The coordinator applies the unchanged thresholds to merged raw streams.
  // A per-role percentile must not replace the aggregate percentile.
  thresholds: {},
};
export function setup() {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(__ENV.LOAD_STARTUP_URL || '') || !__ENV.LOAD_STARTUP_KEY) throw new Error('Missing scoped local startup barrier.');
  const data = JSON.stringify({ role, quota: plan[role], fixtureDigest, sourceDigest: profile.candidate.sourceDigest }), deadline = Date.now() + 45000;
  let path = '/ready';
  while (Date.now() < deadline) {
    const response = http.post(__ENV.LOAD_STARTUP_URL + path, data, { timeout: '5s', redirects: 0, headers: { 'Content-Type': 'application/json', 'X-Load-Startup-Key': __ENV.LOAD_STARTUP_KEY }, tags: { operation: 'harness', phase: 'startup' } });
    if (![200, 202].includes(response.status)) throw new Error('Startup readiness request failed: ' + response.status + ' ' + response.error_code + ' ' + response.error);
    const result = response.json();
    if (result.role !== role || result.fixtureDigest !== fixtureDigest || result.sourceDigest !== profile.candidate.sourceDigest) throw new Error('Startup readiness identity mismatch.');
    if (Number.isSafeInteger(result.startAt)) { if (result.startAt < Date.now() - 1000) throw new Error('Missed measured profile start.'); sleep(Math.max(0, result.startAt - Date.now()) / 1000); return { startAt: new Date(result.startAt).toISOString() }; }
    path = '/status'; sleep(.1);
  }
  throw new Error('Four-role startup readiness deadline exceeded.');
}
function call(account, method, path, data, statuses = [200], operation = 'read') {
  const response = http.request(method, base + path, data ? JSON.stringify(data) : null, { timeout: '18s', redirects: 0, headers: { Authorization: `Bearer ${account.token}`, 'Content-Type': 'application/json', 'X-Atlas-Capabilities': account.capabilities || '' }, tags: { operation, phase: 'profile' } });
  bad429.add(response.status === 429); timeouts.add(response.error_code === 1050 || /timeout/i.test(response.error || ''));
  const ok = statuses.includes(response.status); unexpected.add(!ok);
  if (!ok) console.log(JSON.stringify({ kind: 'http-failure', at: new Date().toISOString(), role, operation, method, path, httpStatus: response.status, errorCode: response.error_code, error: String(response.error || '').slice(0, 240) }));
  let body; try { body = response.json(); } catch { body = {}; }
  if (['create', 'retry', 'accept', 'process'].includes(operation)) console.log(JSON.stringify({ kind: 'critical', at: new Date().toISOString(), operation, actorId: account.userId || account.accountId, method, path, httpStatus: response.status, orderId: body?.id || null, orderStatus: body?.status || null, failure: ok ? undefined : String(body?.message || response.error || '').slice(0, 240) }));
  return { ok, body, status: response.status };
}
const actorBindings = {};
function account(group, role) {
  if (actorBindings[role] === undefined) {
    if (role !== __ENV.LOAD_ROLE) throw new Error('Cross-role actor access.');
    const slot = roleSlot(role, __VU, plan);
    const actor = group[slot];
    actorBindings[role] = actor;
    console.log(JSON.stringify({ kind: 'actor', role, vu: __VU, slot, actorId: actor.userId || actor.accountId }));
  }
  return actorBindings[role];
}
function uuid() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); }); }
export function clientRead() {
  const actor = account(clientAccounts, 'clients');
  call(actor, 'GET', '/orders/active'); call(actor, 'GET', '/food/orders/active-all');
  if (__ITER % 5 === 0) call(actor, 'GET', '/food/catalog');
  sleep(profile.intervalsSeconds.clientSync);
}
export function bookOrder() {
  // A scenario-global iteration is unique even when different VUs execute it.
  // During the fixed 60s booking window each request uses a distinct customer.
  const iteration = execution.scenario.iterationInTest;
  // An executor tick at the exact duration boundary can race its stop timer.
  // Record it explicitly; the declared booking budget permits no extra HTTP.
  const index = bookingActorIndex(iteration, profile);
  if (index === null) { executorBoundary.add(1); return; }
  const actor = clientAccounts[index], food = iteration % 2 === 0;
  console.log(JSON.stringify({ kind: 'booking-actor', role, iteration, actorId: actor.userId }));
  let first, retry;
  if (food) {
    const data = { requestId: uuid(), restaurantId: merchantAccounts[Math.floor(iteration / 2) % restaurants].restaurantId, fulfillment: 'PICKUP', paymentMethod: 'CASH', items: actor.items };
    first = call(actor, 'POST', '/food/orders', data, [201], 'create');
    retry = call(actor, 'POST', '/food/orders', data, [201], 'retry');
  } else {
    const quote = call(actor, 'POST', '/orders/quote', { pickup: fixtures.pickup, dropoff: fixtures.dropoff, tariffId: fixtures.tariffId }, [201], 'quote');
    if (!quote.ok) { created.add(false); return; }
    const data = { quoteId: quote.body.id, idempotencyKey: uuid() };
    first = call(actor, 'POST', '/orders', data, [201], 'create'); retry = call(actor, 'POST', '/orders', data, [201], 'retry');
  }
  created.add(first.ok); if (first.ok) orderCount.add(1); operations.add(1); duplicate.add(first.ok && retry.ok && first.body.id === retry.body.id);
}
let nextGps = 0, nextDriverSync = 0;
export function driverWork() {
  const actor = account(driverAccounts, 'drivers');
  if (Date.now() >= nextGps) {
    call(actor, 'PATCH', '/driver/position', { latitude: fixtures.pickup.latitude, longitude: fixtures.pickup.longitude, accuracyM: 8, measuredAtMs: Date.now() }, [200], 'gps');
    nextGps = Date.now() + profile.intervalsSeconds.driverGps * 1000;
  }
  if (Date.now() >= nextDriverSync) {
    const active = call(actor, 'GET', '/orders/active');
    if (active.body?.id) {
      const action = { ASSIGNED: 'arrive', ARRIVED: 'start', IN_PROGRESS: 'complete' }[active.body.status];
      if (action) { const result = call(actor, 'POST', `/orders/${active.body.id}/${action}`, {}, [201], 'process'); const valid = result.ok && result.body?.id === active.body.id && result.body?.status === { arrive: 'ARRIVED', start: 'IN_PROGRESS', complete: 'COMPLETED' }[action]; processed.add(valid); if (valid && action === 'complete') completed.add(1); }
    } else {
      const offers = call(actor, 'GET', '/driver/offers'); const offer = (Array.isArray(offers.body) ? offers.body : offers.body.orders || [])[0];
      if (offer?.id) { const result = call(actor, 'POST', `/orders/${offer.id}/accept`, {}, [201, 409], 'accept'); if (result.body?.status === 'ASSIGNED') { accepted.add(true); acceptedCount.add(1); } else if (!result.ok) accepted.add(false); }
    }
    nextDriverSync = Date.now() + profile.intervalsSeconds.driverOffers * 1000;
  }
  sleep(.5);
}
export function restaurantWork() {
  const actor = account(merchantAccounts, 'restaurants'), response = call(actor, 'GET', `/restaurant/${actor.restaurantId}/orders`);
  for (const order of (response.body.orders || []).filter(item => item.status !== 'COMPLETED' && item.status !== 'CANCELLED').slice(0, 10)) {
    const action = { PLACED: 'ACCEPT', CONFIRMED: 'PREPARING', PREPARING: 'READY', READY: 'COMPLETE' }[order.status];
    if (action) { const result = call(actor, 'PATCH', `/restaurant/${actor.restaurantId}/orders/${order.id}`, { action }, [200], action === 'ACCEPT' ? 'accept' : 'process'); const valid = result.ok && result.body?.id === order.id && result.body?.status === { ACCEPT: 'CONFIRMED', PREPARING: 'PREPARING', READY: 'READY', COMPLETE: 'COMPLETED' }[action]; (action === 'ACCEPT' ? accepted : processed).add(valid); if (valid && action === 'ACCEPT') acceptedCount.add(1); if (valid && action === 'COMPLETE') completed.add(1); }
  }
  sleep(profile.intervalsSeconds.restaurantOrders);
}
export function handleSummary(data) { return { [__ENV.LOAD_RESULT || '.local/load/http-summary.json']: JSON.stringify({ profile, role, measuredStartAt: data.setup_data?.startAt, metrics: data.metrics, root_group: data.root_group, completedAt: new Date().toISOString(), productionReady: false }, null, 2) }; }
