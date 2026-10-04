import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { ContentService } from '../src/content';
import { DEMO_FOOD_RESTAURANTS } from '../src/food-catalog';

test('admin restaurant updates reject stale drafts inside the lock and accept current or legacy requests', async () => {
  const catalog = structuredClone(DEMO_FOOD_RESTAURANTS[0]);
  let row = { id: catalog.id, catalog, active: true, isDemo: false, sortOrder: 0, updatedAt: new Date('2026-10-04T10:00:00Z') };
  let writes = 0, auditCount = 0, eventCount = 0;
  const calls: string[] = [];
  const tx = {
    $executeRaw: async () => { calls.push('lock'); },
    foodRestaurant: {
      findUnique: async () => { calls.push('read'); return row; },
      update: async ({ data }: any) => { calls.push('write'); writes++; row = { ...row, ...data, updatedAt: new Date(row.updatedAt.getTime() + 1) }; return row; },
    },
  };
  const service = new ContentService({ $transaction: async (action: any) => action(tx) } as any,
    { record: async () => { auditCount++; } } as any,
    { adminChanged: () => { eventCount++; }, contentChanged: () => { eventCount++; } } as any, {} as any);
  const actor = { id: 'admin', role: 'ADMIN' } as any;
  await assert.rejects(() => service.saveRestaurant(actor, { catalog: { ...catalog, name: 'Stale restaurant name' }, updatedAt: '2026-10-04T09:00:00.000Z' }, catalog.id), ConflictException);
  assert.deepEqual(calls, ['lock', 'read']);
  assert.equal(writes, 0); assert.equal(auditCount, 0); assert.equal(eventCount, 0);
  const expected = row.updatedAt.toISOString();
  const saved = await service.saveRestaurant(actor, { catalog: { ...catalog, name: 'Updated restaurant' }, updatedAt: expected }, catalog.id);
  assert.equal((saved.catalog as unknown as { name: string }).name, 'Updated restaurant');
  assert.equal(writes, 1); assert.equal(auditCount, 1); assert.equal(eventCount, 2);
  await assert.rejects(() => service.saveRestaurant(actor, { catalog, updatedAt: expected }, catalog.id), ConflictException);
  assert.equal(writes, 1);
  await service.saveRestaurant(actor, { active: false }, catalog.id);
  assert.equal(writes, 2); assert.equal(row.active, false, 'older clients without a version retain partial-update compatibility');
});
