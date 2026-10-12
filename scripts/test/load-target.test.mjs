import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertLoadTarget, validateLoadManifest } from '../load/target.mjs';
import { assertLoadResults } from '../load/assert-results.mjs';
import { completeOrderEvidence } from './helpers/load-evidence.mjs';
test('load target is loopback or precisely authorized staging and never auto-follows production', () => {
  assert.equal(assertLoadTarget('http://127.0.0.1:3000/api'), 'http://127.0.0.1:3000/api');
  assert.equal(assertLoadTarget('https://atlas-staging.example/api', 'https://atlas-staging.example'), 'https://atlas-staging.example/api');
  for (const value of ['https://api-production.railway.app/api', 'https://api.example/api', 'http://localhost:3000/api', 'http://127.0.0.1:3000/api?target=production']) assert.throws(() => assertLoadTarget(value));
  assert.throws(() => assertLoadTarget('https://production.example/api', 'https://production.example'));
  assert.throws(() => validateLoadManifest({}));
});
test('load acceptance rejects unprocessed orders and dropped or failed requests', () => {
  const profile = { candidate: { commit: 'a', sourceDigest: 'b' }, fixtureRunId: 'fixture', activeUsers: 5, durationSeconds: 120 };
  const http = { profile, metrics: Object.fromEntries(['order_create_success', 'order_accept_success', 'order_process_success', 'idempotent_retry_success'].map(name => [name, { values: { rate: 1 } }])) };
  for (const name of ['orders_created', 'orders_accepted', 'orders_completed']) http.metrics[name] = { values: { count: 2 } };
  const socket = { profile, passed: true };
  assert.equal(assertLoadResults(http, socket, completeOrderEvidence()).completionRatio, 1);
  http.metrics.orders_completed.values.count = 1;
  assert.throws(() => assertLoadResults(http, socket, completeOrderEvidence()), /completion/);
  http.metrics.orders_completed.values.count = 2;
  http.metrics.dropped_iterations = { values: { count: 1 } };
  assert.throws(() => assertLoadResults(http, socket, completeOrderEvidence()), /dropped_iterations/);
  http.metrics.dropped_iterations.values.count = 0;
  http.metrics.executor_boundary_iterations = { values: { count: 2 } };
  assert.throws(() => assertLoadResults(http, socket, completeOrderEvidence()), /executor boundary iterations/);
});
