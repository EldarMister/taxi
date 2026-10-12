import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { LOAD_ROLES, rolePlan, roleSlot, bookingActorIndex, assertRoleAllocations } from '../load/roles.mjs';
import { createStartupBarrier } from '../load/startup-barrier.mjs';
import { mergeRoleMetrics, assertHttpThresholds } from '../load/merge-metrics.mjs';
import { errorDiagnostic } from '../load/error-diagnostics.mjs';
const profile = { activeUsers: 50, durationSeconds: 120, fixtureRunId: 'owned-synthetic', candidate: { commit: 'commit', sourceDigest: 'sha256:fixture' } };
const startAt = '2026-01-01T00:00:00.000Z', finishedAt = '2026-01-01T00:02:01.000Z';
test('Socket.IO TransportError and fetch cause retain useful codes while tokens remain redacted', () => {
  const result = errorDiagnostic({ name: 'TransportError', message: 'websocket error', description: { error: { code: 'ECONNREFUSED', message: 'connect failed ?token=private-token' } }, cause: { code: 'UND_ERR_CONNECT_TIMEOUT', message: 'Bearer private-token' }, data: { code: 'session_unavailable', message: 'access check unavailable' }, secret: 'must-not-be-copied' });
  assert.equal(result.transportErrorCode, 'ECONNREFUSED'); assert.equal(result.causeCode, 'UND_ERR_CONNECT_TIMEOUT');
  assert.equal(result.serverErrorCode, 'session_unavailable');
  assert.ok(!JSON.stringify(result).includes('private-token')); assert.ok(!JSON.stringify(result).includes('must-not-be-copied'));
});
function fixtures() { return { fixtureRunId: profile.fixtureRunId, clients: Array.from({ length: 40 }, (_, i) => ({ userId: 'client-' + i, token: 'synthetic' })), drivers: Array.from({ length: 8 }, (_, i) => ({ userId: 'driver-' + i, token: 'synthetic' })), restaurants: Array.from({ length: 2 }, (_, i) => ({ accountId: 'owner-' + i, token: 'synthetic' })) }; }
test('role-local VUs have exact immutable boundaries and booking iterations cannot collide or exceed budget', () => {
  const plan = rolePlan(profile), fixture = fixtures(), records = [];
  for (const role of LOAD_ROLES.filter(x => x !== 'booking')) for (let vu = 1; vu <= plan[role]; vu++) records.push({ kind: 'actor', role, vu, slot: roleSlot(role, vu, plan), actorId: fixture[role][vu - 1].userId || fixture[role][vu - 1].accountId });
  for (let iteration = 0; iteration < 20; iteration++) records.push({ kind: 'booking-actor', role: 'booking', iteration, actorId: fixture.clients[bookingActorIndex(iteration, profile)].userId });
  assert.deepEqual(Object.values(assertRoleAllocations(records, fixture, profile)).map(x => x.allocated), [38, 8, 2]);
  assert.equal(bookingActorIndex(20, profile), null);
  assert.throws(() => roleSlot('drivers', 9, plan), /quota/);
  assert.throws(() => roleSlot('drivers', 0, plan), /quota/);
  assert.throws(() => roleSlot('booking', 1, plan), /quota/);
  assert.throws(() => assertRoleAllocations([...records, records.at(-1)], fixture, profile), /booking/);
  const wrong = structuredClone(records); wrong[0].actorId = 'driver-0';
  assert.throws(() => assertRoleAllocations(wrong, fixture, profile), /identity/);
  fixture.clients[1].userId = fixture.clients[0].userId;
  assert.throws(() => assertRoleAllocations(records, fixture, profile), /distinct/);
});
test('startup barrier cannot release before all four authenticated quota and fixture reports', async () => {
  let released = 0;
  const plan = rolePlan(profile), barrier = await createStartupBarrier({ plan, fixtureDigest: 'immutable', candidate: profile.candidate, onReady() { released++; } });
  const request = role => fetch(barrier.url + '/ready', { method: 'POST', headers: { 'X-Load-Startup-Key': barrier.key }, body: JSON.stringify({ role, quota: plan[role], fixtureDigest: 'immutable', sourceDigest: profile.candidate.sourceDigest }) });
  try {
    for (const role of LOAD_ROLES.slice(0, 3)) assert.equal((await request(role)).status, 202);
    assert.equal(released, 0); assert.throws(() => barrier.assertReady(), /incomplete/);
    const last = await request('booking'); assert.equal(last.status, 200); assert.ok(Number.isSafeInteger((await last.json()).startAt));
    assert.equal(released, 1); assert.ok(barrier.assertReady());
    await request('booking'); assert.equal(released, 1, 'idempotent readiness cannot start a second profile');
  } finally { await barrier.close(); }
});
function rawInputs(directory) {
  return LOAD_ROLES.map((role, i) => {
    const counts = i === 0 ? 100 : 1, values = {}, rows = [];
    const add = (name, type, value, tags = {}) => { if (!values[name]) { values[name] = []; rows.push({ type: 'Metric', metric: name, data: { name, type } }); } values[name].push(value); rows.push({ type: 'Point', metric: name, data: { time: finishedAt, value, tags } }); };
    for (let index = 0; index < counts; index++) { add('http_reqs', 'counter', 1, { phase: 'profile' }); add('http_req_duration', 'trend', role === 'drivers' ? 2000 : 10, { phase: 'profile', operation: role === 'booking' ? 'create' : 'read' }); add('unexpected_429', 'rate', 0); add('request_timeouts', 'rate', 0); add('unexpected_responses', 'rate', 0); }
    add('http_reqs', 'counter', 1, { phase: 'startup' }); add('http_req_duration', 'trend', 5, { phase: 'startup', operation: 'harness' });
    if (role === 'booking') for (const name of ['order_create_success', 'order_accept_success', 'order_process_success', 'idempotent_retry_success']) add(name, 'rate', 1);
    const summaryPath = join(directory, role + '.json'), rawPath = join(directory, role + '.ndjson');
    writeFileSync(summaryPath, JSON.stringify({ role, profile, measuredStartAt: startAt, completedAt: finishedAt, metrics: { http_reqs: { values: { count: counts + 1 } } } }));
    writeFileSync(rawPath, rows.map(r => JSON.stringify(r)).join('\n') + '\n'); return { role, summaryPath, rawPath };
  });
}
async function workspace(action) {
  const parent = resolve(tmpdir()), directory = mkdtempSync(join(parent, 'atlas-load-roles-'));
  try { await action(directory); } finally { if (dirname(resolve(directory)) !== parent || !basename(directory).startsWith('atlas-load-roles-')) throw new Error('Unsafe test cleanup'); rmSync(directory, { recursive: true, force: true }); }
}
test('all four raw streams merge counts and weighted percentiles without averaging role p95 or suppressing startup', () => workspace(async directory => {
  const inputs = rawInputs(directory), result = await mergeRoleMetrics({ inputs, profile, startAt, finishedAt });
  assert.equal(result.metrics.http_reqs.values.count, 103); assert.equal(result.startupMetrics.http_reqs.values.count, 4);
  assert.equal(result.metrics['http_req_duration{operation:read}'].values['p(95)'], 10);
  assert.equal(result.metrics.http_req_duration.values.max, 2000); assert.equal(result.thresholdsPassed, true); assertHttpThresholds(result);
  result.metrics.request_timeouts.values.rate = 1 / 103;
  assert.throws(() => assertHttpThresholds(result), /request_timeouts/);
  result.metrics.request_timeouts.values.rate = 0; result.metrics.idempotent_retry_success.values.rate = .99;
  assert.throws(() => assertHttpThresholds(result), /idempotent_retry_success/);
}));
test('missing role, truncated raw stream, early role completion and absent success metric cannot pass', () => workspace(async directory => {
  const inputs = rawInputs(directory);
  await assert.rejects(mergeRoleMetrics({ inputs: inputs.slice(1), profile, startAt, finishedAt }), /four/);
  const original = readFileSync(inputs[0].rawPath, 'utf8');
  // Key order is stable in this fixture; remove a duration point explicitly.
  const parsed = original.trim().split('\n').map(JSON.parse), index = parsed.findIndex(r => r.type === 'Point' && r.metric === 'http_req_duration'); parsed.splice(index, 1); writeFileSync(inputs[0].rawPath, parsed.map(JSON.stringify).join('\n'));
  await assert.rejects(mergeRoleMetrics({ inputs, profile, startAt, finishedAt }), /Incomplete mandatory raw/);
  writeFileSync(inputs[0].rawPath, original);
  const report = JSON.parse(readFileSync(inputs[1].summaryPath)); report.completedAt = '2026-01-01T00:00:45.000Z'; writeFileSync(inputs[1].summaryPath, JSON.stringify(report));
  await assert.rejects(mergeRoleMetrics({ inputs, profile, startAt, finishedAt }), /role duration/);
  report.completedAt = finishedAt; writeFileSync(inputs[1].summaryPath, JSON.stringify(report));
  const result = await mergeRoleMetrics({ inputs, profile, startAt, finishedAt }); delete result.metrics.order_process_success;
  assert.throws(() => assertHttpThresholds(result), /order_process_success/);
}));
