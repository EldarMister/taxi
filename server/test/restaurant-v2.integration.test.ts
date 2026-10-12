import { requireTestDatabase } from './test-database';
requireTestDatabase();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { hashAdminPassword } from '../src/admin.security';

// Run after npm run build; Nest needs TypeScript's emitted decorator metadata.
const { AppModule } = require('../dist/src/app.module.js');
const { apiValidation, ApiExceptionFilter } = require('../dist/src/http.js');
const { RoutingService } = require('../dist/src/routing.js');
const { BackgroundJobs } = require('../dist/src/jobs.js');
const { RestaurantAuthService } = require('../dist/src/restaurant-auth.js');
const db = new PrismaClient();
const runId = randomUUID();
const digits = BigInt('0x' + runId.replaceAll('-', '').slice(0, 11)).toString().padStart(10, '0').slice(-10);
const restaurantIds = Array.from({ length: 10 }, (_, index) => `v2-${runId}-${index}`);
const ownerIds = restaurantIds.map(() => randomUUID());
const ownerPhones = ownerIds.map((_, index) => `+997${digits.slice(0, 8)}${String(index).padStart(2, '0')}`);
const clientId = randomUUID(), driverId = randomUUID(), tariffId = `000-v2-${runId}`;
const password = `v2-fixture-${randomUUID()}`;
const pickup = { latitude: 40.56321, longitude: 73.04234, address: 'Изолированный ресторан, Ленина 12' };
const dropoff = { latitude: 40.58215, longitude: 73.06712, address: 'Изолированная доставка, Мира 25' };
const route = { distanceMeters: 3400, durationSeconds: 600, geometry: [pickup, dropoff], provider: 'osrm', steps: [] };
let safeDatabase = false, app: any, api: ReturnType<typeof request>, clientToken: string, driverToken: string, managerId = '', mediaId = '';
const ownerTokens: string[] = [];
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const merchant = (index: number, suffix = '') => `/api/restaurant/${restaurantIds[index]}${suffix}`;
const clientOrder = (index: number, fulfillment = 'DELIVERY') => ({
  requestId: randomUUID(), restaurantId: restaurantIds[index], fulfillment, paymentMethod: 'CASH',
  items: [{ dishId: 'meal', quantity: 2, optionIds: index === 0 ? ['sauce'] : [] }],
  ...(fulfillment === 'DELIVERY' ? { address: dropoff.address, deliveryPoint: { latitude: dropoff.latitude, longitude: dropoff.longitude } } : {}),
  comment: 'Позвоните по прибытии',
});

async function fixtureToken(userId: string) {
  const familyId = randomUUID();
  const session = await db.refreshSession.create({ data: { userId, familyId, tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), expiresAt: new Date(Date.now() + 3_600_000) } });
  return app.get(JwtService).signAsync({ sub: userId, sid: session.id, fid: familyId }, { secret: process.env.JWT_SECRET, expiresIn: 3600, issuer: 'taxi-api', audience: 'taxi-mobile' });
}
async function progress(index: number, orderId: string) {
  for (const action of ['ACCEPT', 'PREPARING', 'READY']) {
    await api.patch(merchant(index, `/orders/${orderId}`)).set(auth(ownerTokens[index])).send({ action }).expect(200);
  }
}

before(async () => {
  safeDatabase = true;
  const passwordHash = await hashAdminPassword(password);
  for (const [index, id] of restaurantIds.entries()) {
    await db.foodRestaurant.create({ data: { id, active: true, isDemo: true, catalog: {
      id, name: `V2 isolated fixture ${index}`, rating: 0, reviewCount: 0, cuisine: 'Тест', categories: ['Тест'],
      etaMin: 20, etaMax: 30, deliveryFee: 80, freeDeliveryThreshold: 0, minimumOrder: 0,
      ...pickup, phone: ownerPhones[index], imageKey: '', heroImageKey: '', menuCategories: ['Основное'],
      dishes: index === 0 ? [] : [{ id: 'meal', name: 'Блюдо', category: 'Основное', description: '', portion: '1 порция', weightGrams: 250, price: 500, imageKey: '', available: true, optionIds: [] }],
      options: [], isDemo: true, isOpen: true,
    } } });
    await db.restaurantAccount.create({ data: { id: ownerIds[index], phone: ownerPhones[index], name: `Owner ${index}`, passwordHash, memberships: { create: { restaurantId: id, role: 'OWNER', permissions: [] } } } });
  }
  await db.user.create({ data: { id: clientId, phone: `+998${digits}`, name: 'V2 client fixture', role: 'CLIENT' } });
  await db.user.create({ data: { id: driverId, phone: `+999${digits}`, name: 'V2 courier fixture', role: 'DRIVER', driverProfile: { create: { verified: true, online: false, deposit: 1_000_000, transportClass: 'COMFORT', acceptsEconomy: false, acceptsComfort: false, acceptsDeliveryCar: true, acceptsDeliveryFood: true, acceptsDeliveryTruck: false,
    vehicle: { create: { make: 'Toyota fixture', color: 'Белый', plate: `V2-${runId}` } } } } } });
  await db.tariff.create({ data: { id: tariffId, name: 'V2 isolated car fixture', description: 'Integration only', kind: 'DELIVERY_CAR', requiredClass: 'ECONOMY', basePrice: 50, pricePerKm: 10, pricePerMinute: 2, minimumPrice: 50, commissionBps: 1000, waitingGraceMinutes: 10, freeWaitingMinutes: 5, waitingPricePerMinute: 0 } });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RoutingService).useValue({ route: async () => structuredClone(route) })
    .overrideProvider(BackgroundJobs).useValue({}).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(apiValidation()); app.useGlobalFilters(new ApiExceptionFilter());
  await app.init(); api = request(app.getHttpServer());
  clientToken = await fixtureToken(clientId); driverToken = await fixtureToken(driverId);
  for (const [index, phone] of ownerPhones.entries()) ownerTokens[index] = (await app.get(RestaurantAuthService).login(phone, password, `v2-fixture-${runId}-${index}`)).accessToken;
  await api.patch('/api/driver/online').set(auth(driverToken)).send({ online: true }).expect(200);
  await api.patch('/api/driver/position').set(auth(driverToken)).send({ latitude: pickup.latitude, longitude: pickup.longitude, accuracyM: 5, measuredAtMs: Date.now() }).expect(200);
});

after(async () => {
  await app?.close();
  if (safeDatabase) {
    const tripIds = (await db.order.findMany({ where: { clientId }, select: { id: true } })).map(row => row.id);
    const foodIds = (await db.foodOrder.findMany({ where: { restaurantId: { in: restaurantIds } }, select: { id: true } })).map(row => row.id);
    const accountIds = [...ownerIds, ...(managerId ? [managerId] : [])];
    await db.$transaction(async tx => {
      await tx.pushJob.deleteMany({ where: { OR: [{ userId: { in: [clientId, driverId] } }, { orderId: { in: [...tripIds, ...foodIds] } }] } });
      await tx.message.deleteMany({ where: { orderId: { in: tripIds } } });
      await tx.rating.deleteMany({ where: { orderId: { in: tripIds } } });
      await tx.clientRating.deleteMany({ where: { orderId: { in: tripIds } } });
      await tx.ledgerEntry.deleteMany({ where: { driverId } });
      await tx.orderOffer.deleteMany({ where: { orderId: { in: tripIds } } });
      await tx.statusHistory.deleteMany({ where: { orderId: { in: tripIds } } });
      await tx.order.deleteMany({ where: { id: { in: tripIds } } });
      await tx.quote.deleteMany({ where: { userId: clientId } });
      await tx.foodStatusHistory.deleteMany({ where: { orderId: { in: foodIds } } });
      await tx.foodOrder.deleteMany({ where: { id: { in: foodIds } } });
      await tx.restaurantAccount.deleteMany({ where: { id: { in: accountIds } } });
      await tx.foodRestaurant.deleteMany({ where: { id: { in: restaurantIds } } });
      await tx.refreshSession.deleteMany({ where: { userId: { in: [clientId, driverId] } } });
      await tx.vehicle.deleteMany({ where: { driverId } });
      await tx.driverProfile.deleteMany({ where: { userId: driverId } });
      await tx.user.deleteMany({ where: { id: { in: [clientId, driverId] } } });
      await tx.tariff.deleteMany({ where: { id: tariffId } });
      await tx.adminAudit.deleteMany({ where: { OR: [{ actorId: { in: accountIds } }, { entityId: { in: restaurantIds } }] } });
      if (mediaId) await tx.mediaAsset.deleteMany({ where: { id: mediaId } });
      await tx.rateLimit.deleteMany({ where: { key: { in: [...ownerPhones.map(phone => `restaurant-login:phone:${phone}`), ...ownerPhones.map((_, index) => `restaurant-login:ip:v2-fixture-${runId}-${index}`), `restaurant-login:phone:+995${digits}`, `restaurant:media:${ownerIds[0]}`, `food:orders:${clientId}`] } } });
    });
  }
  await db.$disconnect();
});

test('Restaurant V2 real API journey: menu, promotions, permissions, grouped orders and both deliveries', async t => {
  let photoUrl = '', ownOrderId = '', batch: any[] = [];
  await t.test('owner uploads a real photo and creates a dish with required modifiers and nutrition', async () => {
    const image = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#E4AE71' } }).jpeg().toBuffer();
    const uploaded = await api.post(merchant(0, '/media')).set(auth(ownerTokens[0])).attach('file', image, { filename: 'fixture.jpg', contentType: 'image/jpeg' }).expect(201);
    photoUrl = uploaded.body.url; mediaId = photoUrl.split('/').at(-1)!;
    const detail = (await api.get(merchant(0)).set(auth(ownerTokens[0])).expect(200)).body;
    detail.catalog.options = [{ id: 'sauce', name: 'Соус', price: 50, imageKey: '', priceScope: 'PER_PORTION' }];
    detail.catalog.dishes = [{ id: 'meal', name: 'Блюдо с соусом', category: 'Основное', description: 'Описание блюда', portion: '1 порция', weightGrams: 250, price: 500, imageKey: '', imageUrl: photoUrl, available: true, optionIds: ['sauce'], optionGroups: [{ id: 'sauces', name: 'Соус', optionIds: ['sauce'], minSelected: 1, maxSelected: 1 }], defaultOptionIds: ['sauce'], ingredients: 'Рис, овощи', nutritionPer100g: { calories: 130, protein: 3, fat: 2, carbohydrates: 22 } }];
    const saved = await api.put(merchant(0, '/catalog')).set(auth(ownerTokens[0])).send({ catalog: detail.catalog, updatedAt: detail.updatedAt }).expect(200);
    assert.notEqual(saved.body.updatedAt, detail.updatedAt);
    await api.put(merchant(0, '/catalog')).set(auth(ownerTokens[0])).send({ catalog: detail.catalog, updatedAt: detail.updatedAt }).expect(409);
    const publicCatalog = (await api.get('/api/food/catalog').set('X-Atlas-Capabilities','food-modifiers-v2').expect(200)).body.restaurants.find((row: any) => row.id === restaurantIds[0]);
    assert.equal(publicCatalog.dishes[0].imageUrl, photoUrl);
    assert.equal(publicCatalog.dishes[0].optionGroups[0].minSelected, 1);
    await api.get(photoUrl).expect(200);
  });
  await t.test('owner promotions propagate to client price and cash order snapshots preserve additions', async () => {
    const detail = (await api.get(merchant(0)).set(auth(ownerTokens[0]))).body;
    detail.catalog.promotions = [{ id: 'launch', title: 'Скидка 20%', type: 'PERCENT', value: 20, minSubtotal: 0, dishIds: ['meal'], active: true, startsAt: null, endsAt: null }];
    await api.put(merchant(0, '/catalog')).set(auth(ownerTokens[0])).send({ catalog: detail.catalog, updatedAt: detail.updatedAt }).expect(200);
    const publicCatalog = (await api.get('/api/food/catalog').set('X-Atlas-Capabilities','food-modifiers-v2')).body.restaurants.find((row: any) => row.id === restaurantIds[0]);
    assert.equal(publicCatalog.dishes[0].price, 400);
    await api.post('/api/food/orders').set(auth(clientToken)).send({ ...clientOrder(0), items: [{ dishId: 'meal', quantity: 1, optionIds: [] }] }).expect(400);
    await api.post('/api/food/orders').set(auth(clientToken)).send({ ...clientOrder(0), paymentMethod: 'CARD' }).expect(400);
    const order = (await api.post('/api/food/orders').set(auth(clientToken)).send(clientOrder(0)).expect(201)).body;
    ownOrderId = order.id;
    assert.equal(order.total, 980); assert.equal(order.items[0].options[0].name, 'Соус'); assert.equal(order.items[0].options[0].price, 50);
    assert.equal(order.items[0].unitPrice, 400); assert.equal(order.paymentMethod, 'CASH');
  });
  await t.test('manager restrictions remain enforced and own-courier lifecycle reaches history and statistics', async () => {
    const staff = (await api.post(merchant(0, '/staff')).set(auth(ownerTokens[0])).send({ phone: `+995${digits}`, password, name: 'Restricted manager', permissions: ['orders.read'] }).expect(201)).body;
    managerId = staff.id;
    const managerToken = (await api.post('/api/restaurant/auth/login').send({ phone: `+995${digits}`, password }).expect(201)).body.accessToken;
    await api.get(merchant(0, '/orders')).set(auth(managerToken)).expect(200);
    await api.get(merchant(1, '/orders')).set(auth(managerToken)).expect(403);
    await api.get(merchant(0, '/stats')).set(auth(managerToken)).expect(403);
    await api.patch(merchant(0, `/orders/${ownOrderId}`)).set(auth(managerToken)).send({ action: 'ACCEPT' }).expect(403);
    const detail = (await api.get(merchant(0)).set(auth(managerToken))).body;
    detail.catalog.dishes[0].price = 999;
    await api.put(merchant(0, '/catalog')).set(auth(managerToken)).send({ catalog: detail.catalog, updatedAt: detail.updatedAt }).expect(403);
    await progress(0, ownOrderId);
    const path = merchant(0, `/orders/${ownOrderId}`);
    await api.post(`${path}/dispatch`).set(auth(ownerTokens[0])).send({ method: 'OWN', courierName: 'Свой курьер', courierPhone: '+996700123456' }).expect(201);
    await api.post(`${path}/dispatch`).set(auth(ownerTokens[0])).send({ method: 'OWN' }).expect(201);
    const customer = (await api.get(`/api/food/orders/${ownOrderId}`).set(auth(clientToken)).expect(200)).body;
    assert.equal(customer.status, 'DELIVERING'); assert.equal(customer.courierName, 'Свой курьер');
    await api.patch(path).set(auth(ownerTokens[0])).send({ action: 'COMPLETE' }).expect(200);
    const order = (await api.get(merchant(0, '/orders')).set(auth(ownerTokens[0]))).body.orders.find((row: any) => row.id === ownOrderId);
    assert.deepEqual(order.history.map((event: any) => event.status), ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED']);
    assert.ok(order.history.every((event: any) => event.actorId === undefined && event.orderId === undefined));
    const stats = (await api.get(merchant(0, '/stats?period=day')).set(auth(ownerTokens[0])).expect(200)).body;
    assert.equal(stats.completedOrders, 1); assert.equal(stats.revenue, 980); assert.equal(stats.averageOrder, 980);
    await api.delete(merchant(0, `/staff/${managerId}`)).set(auth(ownerTokens[0])).expect(200);
    await api.get(merchant(0, '/orders')).set(auth(managerToken)).expect(403);
  });
  await t.test('ten restaurant checkout is atomic, retry-safe and visible only to each matching owner', async () => {
    const body = { orders: restaurantIds.map((_, index) => clientOrder(index, index < 2 ? 'DELIVERY' : 'PICKUP')) };
    batch = (await api.post('/api/food/orders/batch').set(auth(clientToken)).send(body).expect(201)).body.orders;
    assert.equal(batch.length, 10);
    const retry = (await api.post('/api/food/orders/batch').set(auth(clientToken)).send(body).expect(201)).body.orders;
    assert.deepEqual(retry.map((row: any) => row.id), batch.map(row => row.id));
    const active = (await api.get('/api/food/orders/active-all').set(auth(clientToken)).expect(200)).body;
    assert.equal(active.length, 10);
    for (const [index, restaurantId] of restaurantIds.entries()) {
      const own = (await api.get(merchant(index, '/orders')).set(auth(ownerTokens[index])).expect(200)).body.orders;
      assert.ok(own.every((row: any) => row.restaurantId === restaurantId));
      assert.ok(own.some((row: any) => row.id === batch[index].id));
      await api.get(merchant((index + 1) % 10, '/orders')).set(auth(ownerTokens[index])).expect(403);
      await api.patch(merchant(index, `/orders/${batch[(index + 1) % 10].id}`)).set(auth(ownerTokens[index])).send({ action: 'CANCEL' }).expect(404);
    }
    await api.patch(merchant(2, `/orders/${batch[2].id}`)).set(auth(ownerTokens[2])).send({ action: 'CANCEL', reason: 'Нет ингредиентов' }).expect(200);
    assert.equal((await db.foodOrder.findUniqueOrThrow({ where: { id: batch[1].id } })).status, 'PLACED');
  });
  await t.test('Atlas quotes precede dispatch, duplicate calls share one car and driver statuses synchronize', async () => {
    const orderId = batch[1].id;
    await progress(1, orderId);
    await api.patch('/api/driver/position').set(auth(driverToken)).send({ latitude: pickup.latitude, longitude: pickup.longitude, accuracyM: 5, measuredAtMs: Date.now() }).expect(200);
    const path = merchant(1, `/orders/${orderId}`);
    const before = await db.order.count({ where: { clientId } });
    const quote = (await api.post(`${path}/dispatch-quote`).set(auth(ownerTokens[1])).send({ method: 'ATLAS_CAR' }).expect(201)).body;
    assert.equal(quote.deliveryPayer, 'RESTAURANT'); assert.ok(quote.price > 0);
    assert.equal(await db.order.count({ where: { clientId } }), before);
    await api.post(`${path}/dispatch`).set(auth(ownerTokens[1])).send({ method: 'ATLAS_CAR', expectedPrice: quote.price + 1 }).expect(409);
    const responses = await Promise.all(Array.from({ length: 3 }, () => api.post(`${path}/dispatch`).set(auth(ownerTokens[1])).send({ method: 'ATLAS_CAR', expectedPrice: quote.price }).expect(201)));
    const tripId = responses[0].body.atlasDelivery.id;
    assert.ok(responses.every(result => result.body.atlasDelivery.id === tripId));
    assert.equal(await db.order.count({ where: { foodOrderId: orderId } }), 1);
    await api.post(`/api/orders/${tripId}/accept`).set(auth(driverToken)).expect(201);
    let merchantOrder = (await api.get(merchant(1, '/orders')).set(auth(ownerTokens[1]))).body.orders.find((row: any) => row.id === orderId);
    assert.deepEqual(merchantOrder.atlasDelivery.driver, { name: 'V2 courier fixture', phone: `+999${digits}` });
    await api.patch(path).set(auth(ownerTokens[1])).send({ action: 'CANCEL' }).expect(409);
    await api.post(`/api/orders/${tripId}/arrive`).set(auth(driverToken)).expect(201);
    await api.post(`/api/orders/${tripId}/start`).set(auth(driverToken)).expect(201);
    assert.equal((await api.get(`/api/food/orders/${orderId}`).set(auth(clientToken))).body.status, 'DELIVERING');
    await api.post(`/api/orders/${tripId}/complete`).set(auth(driverToken)).expect(201);
    merchantOrder = (await api.get(merchant(1, '/orders')).set(auth(ownerTokens[1]))).body.orders.find((row: any) => row.id === orderId);
    assert.equal(merchantOrder.status, 'COMPLETED'); assert.equal(merchantOrder.history.at(-1).status, 'COMPLETED');
    assert.equal((await api.get(merchant(1, '/stats?period=all')).set(auth(ownerTokens[1]))).body.completedOrders, 1);
  });
  await t.test('other restaurants keep independent lifecycles and completed cash totals match analytics', async () => {
    for (const index of [0, 3, 4, 5, 6, 7, 8, 9]) {
      await progress(index, batch[index].id);
      const path = merchant(index, `/orders/${batch[index].id}`);
      if (index === 0) await api.post(`${path}/dispatch`).set(auth(ownerTokens[index])).send({ method: 'OWN' }).expect(201);
      await api.patch(path).set(auth(ownerTokens[index])).send({ action: 'COMPLETE' }).expect(200);
    }
    assert.equal((await api.get('/api/food/orders/active-all').set(auth(clientToken))).body.length, 0);
    const stats = (await api.get(merchant(0, '/stats?period=all')).set(auth(ownerTokens[0]))).body;
    assert.equal(stats.completedOrders, 2); assert.equal(stats.revenue, 1960);
    assert.equal(stats.byDay.reduce((sum: number, day: any) => sum + day.revenue, 0), 1960);
    assert.equal((await api.get(merchant(2, '/stats?period=all')).set(auth(ownerTokens[2]))).body.cancelledOrders, 1);
  });
});
