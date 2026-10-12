import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createActorSlots } from '../load/actor-slots.mjs';
import { assertOrderEvidence } from '../load/order-acceptance.mjs';
import { completeOrderEvidence } from './helpers/load-evidence.mjs';

test('interleaved global k6 VU IDs bind distinct cached foreground actors', () => {
  const slots = createActorSlots({ clients: 38, drivers: 8, restaurants: 2 });
  const ids = [1, 9, 2, 10, 3, 11, 4, 12];
  assert.equal(new Set(ids.map(id => (id - 1) % 8)).size, 4); // Old mapping loses four drivers.
  assert.deepEqual(ids.map(id => slots.bind('drivers', id)), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(slots.bind('drivers', 9), 1);
  assert.equal(slots.bind('restaurants', 9), 0);
  assert.throws(() => slots.bind('drivers', 13), /capacity/);
  assert.throws(() => slots.bind('admin', 1), /role/);
  assert.throws(() => slots.bind('clients', 0), /VU/);
});

test('DB evidence rejects inflated idempotent responses, incomplete work, foreign actors and duplicate commissions', () => {
  const counters = { created: 2, accepted: 2, completed: 2 };
  assert.equal(assertOrderEvidence(completeOrderEvidence(), counters).uniqueCompleted, 2);
  let evidence = completeOrderEvidence(); evidence.criticalOperations.push({ ...evidence.criticalOperations.at(-1) });
  assert.throws(() => assertOrderEvidence(evidence, { ...counters, completed: 3 }), /counter\/identity/);
  evidence = completeOrderEvidence(); evidence.taxi[0].status = 'IN_PROGRESS'; evidence.taxi[0].history.pop();
  assert.throws(() => assertOrderEvidence(evidence, counters), /Incomplete/);
  evidence = completeOrderEvidence(); evidence.commissions.push({ ...evidence.commissions[0] });
  assert.throws(() => assertOrderEvidence(evidence, counters), /commission count/);
  evidence = completeOrderEvidence(); evidence.food[0].history[1].actorId = 'foreign-merchant';
  assert.throws(() => assertOrderEvidence(evidence, counters), /membership/);
  evidence = completeOrderEvidence(); evidence.actors.drivers.allocated = 0;
  assert.throws(() => assertOrderEvidence(evidence, counters), /distinctly/);
  assert.throws(() => assertOrderEvidence(undefined, counters), /Missing/);
});

test('actual compiled candidate validation accepts empty modifier choice and rejects an omitted optionIds before seed', async () => {
  const requireServer = createRequire(resolve(import.meta.dirname, '../../server/package.json'));
  requireServer('reflect-metadata');
  const { CreateFoodOrderDto } = requireServer('./dist/src/food.dto.js');
  const { apiValidation } = requireServer('./dist/src/http.js');
  const body = { requestId: 'fixture-request', restaurantId: 'fixture-restaurant', fulfillment: 'PICKUP', paymentMethod: 'CASH', items: [{ dishId: 'meal', quantity: 1, optionIds: [] }] };
  const validated = await apiValidation().transform(body, { type: 'body', metatype: CreateFoodOrderDto });
  assert.deepEqual(validated.items[0].optionIds, []);
  delete body.items[0].optionIds;
  await assert.rejects(apiValidation().transform(body, { type: 'body', metatype: CreateFoodOrderDto }), error => error.getStatus() === 400 && error.getResponse().message.some(message => /optionIds/.test(message)));
});
