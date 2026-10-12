import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RestaurantService } from '../src/restaurant';

test('merchant orders project scoped chronological history and only useful courier contacts', async () => {
  let query: any;
  const db: any = {
    restaurantMembership: { findUnique: async ({ where }: any) => {
      assert.deepEqual(where, { accountId_restaurantId: { accountId: 'merchant', restaurantId: 'alpha' } });
      return { active: true, role: 'MANAGER', permissions: ['orders.read'], account: { active: true, sessionVersion: 2 } };
    } },
    foodOrder: { findMany: async (value: any) => { query = value; return [{ id: 'order', restaurantId: 'alpha', deliveryPoint: { latitude: 42, longitude: 74 }, atlasDelivery: { id: 'trip', status: 'ASSIGNED', price: 120, driver: { name: 'Курьер', phone: '+996700123456' } }, history: [{ id: 'event', status: 'PLACED', reason: null, createdAt: new Date(0) }] }]; } },
  };
  const service = new RestaurantService(db, {} as any, {} as any, {} as any, {} as any);
  const result = await service.orders({ id: 'merchant', sessionId: 'session', sessionVersion: 2 }, 'alpha');
  assert.deepEqual(query.where, { restaurantId: 'alpha' });
  assert.equal(query.take, 200);
  assert.deepEqual(query.include.history, { select: { id: true, status: true, reason: true, createdAt: true }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(query.include.atlasDelivery.select.driver, { select: { name: true, phone: true } });
  assert.equal(result.orders[0].history[0].status, 'PLACED');
  assert.equal(result.orders[0].atlasDelivery.driver.phone, '+996700123456');
  assert.equal(result.orders[0].deliveryLat, 42);
  assert.equal(result.orders[0].atlasOrderId, 'trip');
});

test('revoked order-reading permission never queries order history or courier contacts', async () => {
  let reads = 0;
  const db: any = {
    restaurantMembership: { findUnique: async () => ({ active: true, role: 'MANAGER', permissions: ['menu.manage'], account: { active: true, sessionVersion: 2 } }) },
    foodOrder: { findMany: async () => { reads++; return []; } },
  };
  const service = new RestaurantService(db, {} as any, {} as any, {} as any, {} as any);
  await assert.rejects(service.orders({ id: 'merchant', sessionId: 'session', sessionVersion: 2 }, 'alpha'), /не предоставил доступ/);
  assert.equal(reads, 0);
});
