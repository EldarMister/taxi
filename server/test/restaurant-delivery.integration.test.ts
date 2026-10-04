import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { hashAdminPassword } from '../src/admin.security';
import { calculateFare } from '../src/domain';

// Nest requires the decorator metadata produced by the regular server build.
const { AppModule } = require('../dist/src/app.module.js');
const { apiValidation, ApiExceptionFilter } = require('../dist/src/http.js');
const { RoutingService } = require('../dist/src/routing.js');
const { BackgroundJobs } = require('../dist/src/jobs.js');
const { RestaurantAuthService } = require('../dist/src/restaurant-auth.js');
const db = new PrismaClient();
const runId = randomUUID();
const ids = { restaurant: `delivery-integration-${runId}`, client: randomUUID(), driver: randomUUID(), owner: randomUUID(), tariff: `000-delivery-integration-${runId}`, rideTariff: `ride-integration-${runId}` };
const digits = BigInt('0x' + runId.replaceAll('-', '').slice(0, 11)).toString().padStart(14, '0').slice(-11);
const ownerPhone = `+997${digits}`;
const pickup = { latitude: 40.56321, longitude: 73.04234, address: 'Тестовый ресторан Atlas, улица Ленина 12' };
const dropoff = { latitude: 40.58215, longitude: 73.06712, address: 'Тестовая доставка Atlas, улица Мира 25' };
const route = { distanceMeters: 3400, durationSeconds: 600, geometry: [pickup, dropoff], provider: 'osrm', steps: [] };
const catalog = { id: ids.restaurant, name: 'Atlas delivery integration fixture', rating: 0, reviewCount: 0, cuisine: 'Тест', categories: ['Тест'], etaMin: 20, etaMax: 30, deliveryFee: 80, freeDeliveryThreshold: 0, minimumOrder: 0,
  address: pickup.address, latitude: pickup.latitude, longitude: pickup.longitude, phone: ownerPhone, imageKey: '', heroImageKey: '', menuCategories: ['Основное'],
  dishes: [{ id: 'test-dish', name: 'Тестовое блюдо', category: 'Основное', description: 'Изолированная проверка доставки', portion: '1 шт.', weightGrams: 250, price: 500, imageKey: '', available: true, optionIds: [] }], options: [], isDemo: true, isOpen: true };
let app: any, api: ReturnType<typeof request>, clientToken: string, driverToken: string, ownerToken: string;
let safeDatabase = false, foodOrderId = '', deliveryId = '', routeCalls = 0;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function fixtureToken(userId: string) {
  const familyId = randomUUID();
  const session = await db.refreshSession.create({ data: { userId, familyId, tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), expiresAt: new Date(Date.now() + 60 * 60_000) } });
  return app.get(JwtService).signAsync({ sub: userId, sid: session.id, fid: familyId }, { secret: process.env.JWT_SECRET, expiresIn: 3600, issuer: 'taxi-api', audience: 'taxi-mobile' });
}

before(async () => {
  const url = new URL(process.env.DATABASE_URL || 'http://invalid');
  if (process.env.TEST_DATABASE_RESET !== 'true' || process.env.NODE_ENV !== 'development' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/taxi_test') throw new Error('This test requires the disposable local 127.0.0.1:55432/taxi_test database.');
  safeDatabase = true;
  await db.foodRestaurant.create({ data: { id: ids.restaurant, catalog, active: true, isDemo: true } });
  const password = `delivery-fixture-${randomUUID()}`;
  await db.restaurantAccount.create({ data: { id: ids.owner, phone: ownerPhone, name: 'Delivery fixture owner', passwordHash: await hashAdminPassword(password), memberships: { create: { restaurantId: ids.restaurant, role: 'OWNER', permissions: [] } } } });
  await db.user.create({ data: { id: ids.client, phone: `+998${digits}`, name: 'Delivery fixture client', role: 'CLIENT' } });
  await db.user.create({ data: { id: ids.driver, phone: `+999${digits}`, name: 'Delivery fixture driver', role: 'DRIVER', driverProfile: { create: { verified: true, online: false, deposit: 1_000_000, transportClass: 'COMFORT', acceptsEconomy: false, acceptsComfort: false, acceptsDeliveryCar: true, acceptsDeliveryFood: true, acceptsDeliveryTruck: false,
    vehicle: { create: { make: 'Toyota fixture', color: 'Белый', plate: `TEST-${runId}` } } } } } });
  const tariff = { name: 'Isolated delivery integration', description: 'Only a test fixture', kind: 'DELIVERY_CAR' as const, requiredClass: 'ECONOMY' as const, basePrice: 50, pricePerKm: 10, pricePerMinute: 2, minimumPrice: 50, commissionBps: 1000, waitingGraceMinutes: 10, freeWaitingMinutes: 5, waitingPricePerMinute: 0 };
  await db.tariff.create({ data: { id: ids.tariff, ...tariff } });
  await db.tariff.create({ data: { id: ids.rideTariff, ...tariff, kind: 'RIDE' } });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RoutingService).useValue({ route: async () => { routeCalls++; return structuredClone(route); } })
    // This test must not dispatch or clean up orders belonging to other fixtures.
    .overrideProvider(BackgroundJobs).useValue({}).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(apiValidation()); app.useGlobalFilters(new ApiExceptionFilter());
  await app.init(); api = request(app.getHttpServer());
  clientToken = await fixtureToken(ids.client); driverToken = await fixtureToken(ids.driver);
  ownerToken = (await app.get(RestaurantAuthService).login(ownerPhone, password, `delivery-test-${runId}`)).accessToken;
  await api.patch('/api/driver/online').set(auth(driverToken)).send({ online: true }).expect(200);
  await api.patch('/api/driver/position').set(auth(driverToken)).send({ latitude: pickup.latitude, longitude: pickup.longitude, accuracyM: 5, measuredAtMs: Date.now() }).expect(200);
  const created = await api.post('/api/food/orders').set(auth(clientToken)).send({ requestId: randomUUID(), restaurantId: ids.restaurant, items: [{ dishId: 'test-dish', quantity: 2, optionIds: [] }], fulfillment: 'DELIVERY', address: dropoff.address, deliveryPoint: { latitude: dropoff.latitude, longitude: dropoff.longitude }, paymentMethod: 'CASH' }).expect(201);
  foodOrderId = created.body.id;
  for (const action of ['ACCEPT', 'PREPARING', 'READY']) await api.patch(`/api/restaurant/${ids.restaurant}/orders/${foodOrderId}`).set(auth(ownerToken)).send({ action }).expect(200);
});

after(async () => {
  await app?.close();
  if (safeDatabase) {
    // Only objects owned by this run's random IDs are eligible for deletion.
    const orders = await db.order.findMany({ where: { clientId: ids.client }, select: { id: true } });
    const orderIds = orders.map(order => order.id);
    const foodOrders = await db.foodOrder.findMany({ where: { restaurantId: ids.restaurant }, select: { id: true } });
    const foodIds = foodOrders.map(order => order.id);
    await db.$transaction(async tx => {
      await tx.pushJob.deleteMany({ where: { OR: [{ userId: { in: [ids.client, ids.driver] } }, { orderId: { in: [...orderIds, ...foodIds] } }] } });
      await tx.message.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.rating.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.clientRating.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.ledgerEntry.deleteMany({ where: { driverId: ids.driver } });
      await tx.orderOffer.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.statusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      await tx.quote.deleteMany({ where: { userId: ids.client } });
      await tx.foodStatusHistory.deleteMany({ where: { orderId: { in: foodIds } } });
      await tx.foodOrder.deleteMany({ where: { id: { in: foodIds } } });
      await tx.restaurantAccount.deleteMany({ where: { id: ids.owner } });
      await tx.foodRestaurant.deleteMany({ where: { id: ids.restaurant } });
      await tx.refreshSession.deleteMany({ where: { userId: { in: [ids.client, ids.driver] } } });
      await tx.vehicle.deleteMany({ where: { driverId: ids.driver } });
      await tx.driverProfile.deleteMany({ where: { userId: ids.driver } });
      await tx.user.deleteMany({ where: { id: { in: [ids.client, ids.driver] } } });
      await tx.tariff.deleteMany({ where: { id: { in: [ids.tariff, ids.rideTariff] } } });
      await tx.adminAudit.deleteMany({ where: { OR: [{ actorId: ids.owner }, { entityId: ids.restaurant }] } });
      await tx.rateLimit.deleteMany({ where: { key: { in: [`restaurant-login:ip:delivery-test-${runId}`, `restaurant-login:phone:${ownerPhone}`, `food:orders:${ids.client}`] } } });
    });
  }
  await db.$disconnect();
});

test('Atlas restaurant delivery uses one real car order, synchronizes driver status and stays out of client taxi orders', async t => {
  const path = `/api/restaurant/${ids.restaurant}/orders/${foodOrderId}`;
  let expectedPrice = 0;
  await t.test('real PostgreSQL indexes distinguish restaurant deliveries from an ordinary active taxi order', async () => {
    const indexes = await db.$queryRaw<Array<{ indexname: string; indexdef: string }>>`SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='Order' AND indexname IN ('Order_one_active_client','Order_foodOrderId_key')`;
    assert.equal(indexes.length, 2);
    assert.match(indexes.find(index => index.indexname === 'Order_one_active_client')!.indexdef, /foodOrderId.*IS NULL/);
    assert.match(indexes.find(index => index.indexname === 'Order_foodOrderId_key')!.indexdef, /UNIQUE INDEX/);
  });
  await t.test('delivery quote has no Order or Quote write and an old expected price is rejected without writes', async () => {
    const beforeOrders = await db.order.count({ where: { clientId: ids.client } });
    const beforeQuotes = await db.quote.count({ where: { userId: ids.client } });
    const quote = await api.post(`${path}/dispatch-quote`).set(auth(ownerToken)).send({ method: 'ATLAS_CAR' }).expect(201);
    const selectedTariff = await db.tariff.findFirstOrThrow({ where: { kind: 'DELIVERY_CAR', active: true }, orderBy: { id: 'asc' } });
    expectedPrice = calculateFare(selectedTariff, route.distanceMeters, route.durationSeconds).price;
    assert.equal(quote.body.price, expectedPrice); assert.equal(quote.body.deliveryPayer, 'RESTAURANT');
    assert.equal(await db.order.count({ where: { clientId: ids.client } }), beforeOrders);
    assert.equal(await db.quote.count({ where: { userId: ids.client } }), beforeQuotes);
    await api.post(`${path}/dispatch`).set(auth(ownerToken)).send({ method: 'ATLAS_CAR', expectedPrice: expectedPrice + 1 }).expect(409);
    assert.equal(await db.order.count({ where: { clientId: ids.client } }), beforeOrders);
    assert.equal(await db.quote.count({ where: { userId: ids.client } }), beforeQuotes);
    const food = await db.foodOrder.findUniqueOrThrow({ where: { id: foodOrderId } });
    assert.equal(food.status, 'READY'); assert.equal(food.deliveryMethod, null);
  });
  await t.test('concurrent dispatch calls create exactly one DELIVERY_CAR and one assignment offer', async () => {
    const responses = await Promise.all(Array.from({ length: 4 }, () => api.post(`${path}/dispatch`).set(auth(ownerToken)).send({ method: 'ATLAS_CAR', expectedPrice })));
    for (const response of responses) assert.equal(response.status, 201, JSON.stringify(response.body));
    const returnedIds = new Set(responses.map(response => response.body.atlasDelivery?.id));
    assert.equal(returnedIds.size, 1); assert.ok(!returnedIds.has(undefined));
    deliveryId = [...returnedIds][0];
    const deliveries = await db.order.findMany({ where: { foodOrderId } });
    assert.equal(deliveries.length, 1); assert.equal(deliveries[0].id, deliveryId); assert.equal(deliveries[0].kind, 'DELIVERY_CAR');
    assert.equal(deliveries[0].price, expectedPrice);
    assert.equal(await db.quote.count({ where: { userId: ids.client } }), 1);
    const offer = await db.orderOffer.findMany({ where: { orderId: deliveryId, skipped: false } });
    assert.equal(offer.length, 1); assert.equal(offer[0].driverId, ids.driver);
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: foodOrderId } })).status, 'READY');
    assert.equal((await api.get('/api/orders/active').set(auth(clientToken)).expect(200)).body, null);
    const foodActive = (await api.get('/api/food/orders/active-all').set(auth(clientToken)).expect(200)).body;
    assert.ok(foodActive.some((order: any) => order.id === foodOrderId));
  });
  await t.test('food preference persists independently and turning it off rejects an already offered restaurant trip', async () => {
    const disabled = await api.patch('/api/driver/preferences').set(auth(driverToken)).send({ acceptsDeliveryFood: false }).expect(200);
    assert.equal(disabled.body.driverProfile.acceptsDeliveryCar, true);
    assert.equal(disabled.body.driverProfile.acceptsDeliveryFood, false);
    const restored = await api.get('/api/users/me').set(auth(driverToken)).expect(200);
    assert.equal(restored.body.driverProfile.acceptsDeliveryFood, false);
    assert.equal((await db.driverProfile.findUniqueOrThrow({ where: { userId: ids.driver } })).acceptsDeliveryFood, false);
    assert.ok(!(await api.get('/api/driver/offers').set(auth(driverToken)).expect(200)).body.some((order: any) => order.id === deliveryId));
    await api.post(`/api/orders/${deliveryId}/accept`).set(auth(driverToken)).expect(403);
    await api.patch('/api/driver/preferences').set(auth(driverToken)).send({ acceptsDeliveryFood: true }).expect(200);
    const foodOnly = await api.patch('/api/driver/preferences').set(auth(driverToken)).send({ acceptsDeliveryCar: false }).expect(200);
    assert.equal(foodOnly.body.driverProfile.acceptsDeliveryCar, false);
    assert.equal(foodOnly.body.driverProfile.acceptsDeliveryFood, true);
    const saved = await db.driverProfile.findUniqueOrThrow({ where: { userId: ids.driver } });
    assert.equal(saved.acceptsDeliveryCar, false);
    assert.equal(saved.acceptsDeliveryFood, true);
  });
  await t.test('driver acceptance and arrival keep food ready; beginning delivery moves it to DELIVERING', async () => {
    const offer = (await api.get('/api/driver/offers').set(auth(driverToken)).expect(200)).body.find((order: any) => order.id === deliveryId);
    assert.ok(offer); assert.equal(offer.kind, 'DELIVERY_CAR'); assert.equal(offer.deliveryDetails.deliveryPayer, 'RESTAURANT');
    assert.equal(offer.deliveryDetails.cashToCollect, 1080);
    const accepted = await api.post(`/api/orders/${deliveryId}/accept`).set(auth(driverToken)).expect(201);
    assert.equal(accepted.body.status, 'ASSIGNED');
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: foodOrderId } })).status, 'READY');
    await api.post(`/api/orders/${deliveryId}/arrive`).set(auth(driverToken)).expect(201);
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: foodOrderId } })).status, 'READY');
    const started = await api.post(`/api/orders/${deliveryId}/start`).set(auth(driverToken)).expect(201);
    assert.equal(started.body.status, 'IN_PROGRESS');
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: foodOrderId } })).status, 'DELIVERING');
    assert.equal((await api.get('/api/orders/active').set(auth(clientToken)).expect(200)).body, null);
  });
  await t.test('an ordinary active taxi can coexist without the food delivery replacing its client screen', async () => {
    const quote = await db.quote.create({ data: { userId: ids.client, tariffId: ids.rideTariff, kind: 'RIDE', pickup, dropoff, geometry: route.geometry, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, price: 100, commission: 10, routeProvider: 'osrm', expiresAt: new Date(Date.now() + 60_000) } });
    const ride = await db.order.create({ data: { clientId: ids.client, quoteId: quote.id, kind: 'RIDE', idempotencyKey: randomUUID(), status: 'SEARCHING', dispatchAfter: new Date(Date.now() + 60_000), pickup, dropoff, geometry: route.geometry, distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, price: 100, commission: 10, searchExpiresAt: new Date(Date.now() + 120_000) } });
    assert.equal((await api.get('/api/orders/active').set(auth(clientToken)).expect(200)).body.id, ride.id);
    await db.order.update({ where: { id: ride.id }, data: { status: 'CANCELLED' } });
  });
  await t.test('driver completion atomically completes food once and charges commission once', async () => {
    const before = await db.driverProfile.findUniqueOrThrow({ where: { userId: ids.driver } });
    const first = await api.post(`/api/orders/${deliveryId}/complete`).set(auth(driverToken)).expect(201);
    assert.equal(first.body.status, 'COMPLETED');
    await api.post(`/api/orders/${deliveryId}/complete`).set(auth(driverToken)).expect(201);
    const food = await db.foodOrder.findUniqueOrThrow({ where: { id: foodOrderId } });
    assert.equal(food.status, 'COMPLETED'); assert.ok(food.completedAt);
    assert.equal(await db.foodStatusHistory.count({ where: { orderId: foodOrderId, status: 'DELIVERING' } }), 1);
    assert.equal(await db.foodStatusHistory.count({ where: { orderId: foodOrderId, status: 'COMPLETED' } }), 1);
    assert.equal(await db.ledgerEntry.count({ where: { orderId: deliveryId, kind: 'COMMISSION' } }), 1);
    const delivery = await db.order.findUniqueOrThrow({ where: { id: deliveryId } });
    const after = await db.driverProfile.findUniqueOrThrow({ where: { userId: ids.driver } });
    assert.equal(after.deposit, before.deposit - delivery.commission);
    assert.equal((await api.get('/api/orders/active').set(auth(clientToken)).expect(200)).body, null);
    assert.ok(!(await api.get('/api/orders/history?period=all').set(auth(clientToken)).expect(200)).body.some((order: any) => order.id === deliveryId));
    assert.ok((await api.get('/api/food/orders/history').set(auth(clientToken)).expect(200)).body.some((order: any) => order.id === foodOrderId && order.status === 'COMPLETED'));
    assert.equal(await db.pushJob.count({ where: { userId: ids.client, orderId: deliveryId } }), 0, 'food customers receive food state rather than taxi assignment pushes');
    assert.ok(routeCalls >= 2, 'all routing requests used the deterministic provider override');
  });
});
