import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DriverService } from '../src/driver';
import { driverCanTake } from '../src/driver-eligibility';
import { OrdersService } from '../src/orders';

const actor = { id: 'driver', role: 'DRIVER' } as any;
function fixture(overrides: Record<string, unknown> = {}) {
  const profile: any = { userId: actor.id, transportClass: 'ECONOMY', acceptsEconomy: true, acceptsComfort: false, acceptsDeliveryCar: true, acceptsDeliveryTruck: false, courierModes: [], verified: true, online: true, vehicle: {}, deposit: 1000, ...overrides };
  const tx: any = {
    $queryRaw: async () => [], performerApplication: { findUnique: async () => null },
    driverProfile: { findUnique: async () => profile, update: async ({ data }: any) => Object.assign(profile, data) },
    order: { findFirst: async () => null },
  };
  const db: any = { ...tx, $transaction: async (work: any) => work(tx) };
  const service = () => new DriverService(db, { minimumDeposit: 0 } as any, { user: async () => ({ driverProfile: { ...profile } }) } as any, {} as any, { adminChanged() {} } as any);
  return { profile, tx, db, service };
}

test('partial preference saves preserve car delivery and food defaults only when missing', async () => {
  const h = fixture();
  let user = await h.service().preferences(actor, { acceptsComfort: false });
  assert.equal(user.driverProfile.acceptsDeliveryCar, true);
  assert.equal(user.driverProfile.acceptsDeliveryFood, false);
  user = await h.service().preferences(actor, { acceptsDeliveryFood: true });
  assert.equal(user.driverProfile.acceptsDeliveryCar, true);
  assert.equal(user.driverProfile.acceptsDeliveryFood, true);
  // A fresh service reads persisted values, as after an application restart.
  user = await h.service().preferences(actor, { acceptsDeliveryCar: false });
  assert.equal(user.driverProfile.acceptsDeliveryCar, false);
  assert.equal(user.driverProfile.acceptsDeliveryFood, true);
  user = await h.service().preferences(actor, { acceptsDeliveryFood: false });
  assert.equal(user.driverProfile.acceptsDeliveryCar, false);
  assert.equal(user.driverProfile.acceptsDeliveryFood, false);
});

test('food-only drivers can go online while Comfort remains limited to the assigned class', async () => {
  const h = fixture({ acceptsEconomy: false, acceptsDeliveryCar: false, acceptsDeliveryFood: true });
  await h.service().online(actor, true);
  assert.equal(h.profile.online, true);
  await assert.rejects(h.service().preferences(actor, { acceptsComfort: true }), /Категория автомобиля/);
  assert.equal(h.profile.acceptsComfort, false);
  const truck = fixture({ transportClass: 'TRUCK', acceptsEconomy: false, acceptsDeliveryCar: false, acceptsDeliveryTruck: true });
  await assert.rejects(truck.service().preferences(actor, { acceptsDeliveryFood: true }), /Категория автомобиля/);
});

test('food and ordinary car delivery eligibility are independent for every saved combination', () => {
  for (const car of [false, true]) for (const food of [false, true]) {
    const { profile } = fixture({ acceptsDeliveryCar: car, acceptsDeliveryFood: food });
    assert.equal(driverCanTake(profile, 'DELIVERY_CAR', 'ECONOMY'), car);
    assert.equal(driverCanTake(profile, 'DELIVERY_CAR', 'ECONOMY', true), food);
    assert.equal(driverCanTake({ ...profile, transportClass: 'TRUCK' }, 'DELIVERY_CAR', 'ECONOMY', true), false);
  }
  assert.equal(driverCanTake(fixture().profile, 'DELIVERY_CAR', 'ECONOMY', true), false);
});

test('taxi and delivery approval enables delivery preferences and revoked approvals cannot be restored', async () => {
  const h = fixture({ registrationManaged: true, acceptsDeliveryCar: false });
  h.tx.performerApplication.findUnique = async () => ({ id: 'application' });
  h.tx.performerApplicationRole = { findMany: async () => [] };
  await assert.rejects(h.service().preferences(actor, { acceptsDeliveryFood: true }), /одобренные направления/);
  h.tx.performerApplicationRole.findMany = async () => [{ role: 'TAXI_DRIVER' }];
  h.profile.courierModes = ['CAR'];
  await h.service().preferences(actor, { acceptsDeliveryFood: true });
  assert.equal(h.profile.acceptsDeliveryFood, true);
  assert.equal(h.profile.acceptsDeliveryCar, false);
});

test('turning food off hides both linked and legacy restaurant offers and rejects stale acceptance', async () => {
  const h = fixture({ acceptsDeliveryFood: false });
  const ordinary = { id: 'car', kind: 'DELIVERY_CAR', quote: { tariff: { requiredClass: 'ECONOMY' } } };
  const food = { ...ordinary, id: 'food', foodOrderId: 'meal', status: 'SEARCHING', quoteId: 'quote' };
  const legacy = { ...food, id: 'legacy', foodOrderId: null, idempotencyKey: 'restaurant-food:meal:1' };
  h.tx.orderOffer = { findMany: async () => [ordinary, food, legacy].map(order => ({ orderId: order.id, order, expiresAt: new Date(Date.now() + 60000) })) };
  h.db.orderOffer = h.tx.orderOffer;
  h.tx.quote = { findUniqueOrThrow: async () => food.quote };
  const orders = new OrdersService(h.db, { minimumDeposit: 0 } as any, {} as any, {} as any, {} as any, {} as any);
  orders.serialize = async (id: string) => ({ id } as any);
  (orders as any).lockOrder = async () => food;
  assert.deepEqual((await orders.offers(actor)).map(value => value.id), ['car']);
  await assert.rejects(orders.accept(actor, food.id), /не разрешён/);
  h.profile.acceptsDeliveryCar = false;
  h.profile.acceptsDeliveryFood = true;
  assert.deepEqual((await orders.offers(actor)).map(value => value.id), ['food', 'legacy']);
});
