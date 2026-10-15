import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';

const { AppModule } = require('../dist/src/app.module');
const { BackgroundJobs } = require('../dist/src/jobs');
const { apiValidation, ApiExceptionFilter } = require('../dist/src/http');
const db = new PrismaClient();
const run = randomUUID();
const ids = { client: randomUUID(), driver: randomUUID(), peer: randomUUID(), peerDriver: randomUUID(), restaurant: `delete-${run}`, tariff: `delete-${run}` };
const createdUsers = new Set<string>();
const phones = new Map<string, string>();
const orderIds: string[] = [], foodIds: string[] = [], quoteIds: string[] = [];
const point = { address: `Private address ${run}`, latitude: 42.87, longitude: 74.57 };
let app: any, api: ReturnType<typeof request>, safeDatabase = false;

async function token(id: string) {
  const refreshToken = randomUUID() + randomUUID(), familyId = randomUUID();
  const session = await db.refreshSession.create({ data: { userId: id, familyId, tokenHash: createHash('sha256').update(refreshToken).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
  const accessToken = await app.get(JwtService).signAsync({ sub: id, sid: session.id, fid: familyId }, { secret: process.env.JWT_SECRET, issuer: 'taxi-api', audience: 'taxi-mobile', expiresIn: 3600 });
  return { refreshToken, headers: { Authorization: `Bearer ${accessToken}` } };
}
async function trip(clientId: string, driverId?: string, foodOrderId?: string) {
  const quote = await db.quote.create({ data: { userId: clientId, tariffId: ids.tariff, pickup: point, dropoff: point, geometry: [point], distanceMeters: 1000, durationSeconds: 300, price: 100, commission: 10, routeProvider: 'fixture', expiresAt: new Date() } });
  quoteIds.push(quote.id);
  const order = await db.order.create({ data: { clientId, driverId, foodOrderId, quoteId: quote.id, idempotencyKey: randomUUID(), status: driverId ? 'COMPLETED' : 'CANCELLED', pickup: point, dropoff: point, geometry: [point], distanceMeters: 1000, durationSeconds: 300, price: 100, commission: 10, comment: 'Private comment', passengerName: 'Private passenger', passengerPhone: phones.get(clientId), driverLocation: point, searchExpiresAt: new Date(), completedAt: new Date(), history: { create: { status: driverId ? 'COMPLETED' : 'CANCELLED', actorId: driverId || clientId, reason: 'Private reason' } }, rating: { create: { score: 5, comment: 'Private review' } }, clientRating: { create: { score: 5, comment: 'Private client review' } } } });
  orderIds.push(order.id);
  await db.message.create({ data: { orderId: order.id, senderId: clientId, clientMessageId: randomUUID(), text: 'Private chat', imageData: Buffer.from('private image'), imageMime: 'image/jpeg' } });
  if (driverId) {
    await db.message.create({ data: { orderId: order.id, senderId: driverId, clientMessageId: randomUUID(), text: 'Private reply' } });
    await db.orderOffer.create({ data: { orderId: order.id, driverId, expiresAt: new Date() } });
    await db.ledgerEntry.create({ data: { driverId, orderId: order.id, kind: 'COMMISSION', amount: -10, balanceAfter: 90, idempotencyKey: `commission:${order.id}`, note: 'Private financial note', actorId: clientId } });
  }
  return order;
}
async function food(clientId: string, courierPhone?: string) {
  const order = await db.foodOrder.create({ data: { clientId, restaurantId: ids.restaurant, restaurantSnapshot: { name: 'Fixture' }, requestId: randomUUID(), requestHash: run, items: [{ dishId: 'fixture', quantity: 1 }], subtotal: 100, deliveryFee: 10, total: 110, fulfillment: 'DELIVERY', address: point.address, deliveryPoint: point, courierName: 'Private courier', courierPhone, comment: 'Private food comment', paymentMethod: 'CASH', status: 'COMPLETED', history: { create: { status: 'COMPLETED', actorId: clientId } } } });
  foodIds.push(order.id); return order;
}

before(async () => {
  const url = new URL(process.env.DATABASE_URL || 'http://invalid');
  if (process.env.TEST_DATABASE_RESET !== 'true' || process.env.NODE_ENV !== 'development' || url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/taxi_test') throw new Error('Requires disposable 127.0.0.1:55432/taxi_test database.');
  safeDatabase = true;
  await db.tariff.create({ data: { id: ids.tariff, name: 'Deletion fixture', description: '', basePrice: 10, pricePerKm: 10, pricePerMinute: 1, minimumPrice: 10, commissionBps: 1000 } });
  await db.foodRestaurant.create({ data: { id: ids.restaurant, catalog: { name: 'Deletion fixture' } } });
  for (const [index, id] of [ids.client, ids.driver, ids.peer, ids.peerDriver].entries()) {
    const phone = `+996${BigInt('0x' + id.replaceAll('-', '').slice(0, 11)).toString().padStart(12, '0').slice(-9)}`;
    phones.set(id, phone); createdUsers.add(id);
    await db.user.create({ data: { id, phone, name: `Private person ${index}`, avatarData: Buffer.from('private avatar'), avatarMime: 'image/jpeg', avatarUpdatedAt: new Date(), role: index % 2 ? 'DRIVER' : 'CLIENT', ...(index % 2 ? { driverProfile: { create: { locationLatitude: 42.87, locationLongitude: 74.57, vehicle: { create: { make: 'Private vehicle', color: 'White', plate: `DELETE-${id}`, photoData: Buffer.from('private vehicle photo'), photoMime: 'image/jpeg', photoUpdatedAt: new Date() } } } } } : {}) } });
  }
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(BackgroundJobs).useValue({}).compile();
  app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalPipes(apiValidation()); app.useGlobalFilters(new ApiExceptionFilter());
  await app.init(); api = request(app.getHttpServer());
});

after(async () => {
  await app?.close();
  if (safeDatabase) {
    await db.$transaction(async tx => {
      await tx.pushJob.deleteMany({ where: { OR: [{ userId: { in: [...createdUsers] } }, { orderId: { in: [...orderIds, ...foodIds] } }] } });
      await tx.message.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.rating.deleteMany({ where: { orderId: { in: orderIds } } }); await tx.clientRating.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.orderOffer.deleteMany({ where: { orderId: { in: orderIds } } }); await tx.statusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await tx.ledgerEntry.deleteMany({ where: { driverId: { in: [...createdUsers] } } });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } }); await tx.quote.deleteMany({ where: { OR: [{ id: { in: quoteIds } }, { userId: { in: [...createdUsers] } }] } });
      await tx.foodStatusHistory.deleteMany({ where: { orderId: { in: foodIds } } }); await tx.foodOrder.deleteMany({ where: { id: { in: foodIds } } });
      await tx.performerApplication.deleteMany({ where: { userId: { in: [...createdUsers] } } }); await tx.pushToken.deleteMany({ where: { userId: { in: [...createdUsers] } } });
      await tx.refreshSession.deleteMany({ where: { userId: { in: [...createdUsers] } } }); await tx.vehicle.deleteMany({ where: { driverId: { in: [...createdUsers] } } });
      await tx.adminCredential.deleteMany({ where: { userId: { in: [...createdUsers] } } });
      await tx.driverProfile.deleteMany({ where: { userId: { in: [...createdUsers] } } }); await tx.user.deleteMany({ where: { id: { in: [...createdUsers] } } });
      await tx.smsChallenge.deleteMany({ where: { phone: { in: [...phones.values()] } } }); await tx.otpDeliveryAttempt.deleteMany({ where: { phone: { in: [...phones.values()] } } });
      await tx.adminAudit.deleteMany({ where: { action: run } }); await tx.rateLimit.deleteMany({ where: { OR: [...createdUsers].map(id => ({ key: { endsWith: `:${id}` } })) } });
      await tx.foodRestaurant.deleteMany({ where: { id: ids.restaurant } }); await tx.tariff.deleteMany({ where: { id: ids.tariff } });
    });
  }
  await db.$disconnect();
});

test('active ride and food block deletion without removing any data', async () => {
  const session = await token(ids.client), order = await trip(ids.client), meal = await food(ids.client);
  await db.order.update({ where: { id: order.id }, data: { status: 'SEARCHING' } });
  await api.delete('/api/users/me').set(session.headers).expect(409);
  assert.ok(await db.user.findUnique({ where: { id: ids.client } }));
  await db.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  await db.foodOrder.update({ where: { id: meal.id }, data: { status: 'PLACED' } });
  await api.delete('/api/users/me').set(session.headers).expect(409);
  await api.get('/api/users/me').set(session.headers).expect(200);
  await db.foodOrder.update({ where: { id: meal.id }, data: { status: 'COMPLETED' } });
});

test('client deletion physically purges personal records and shared history, preserves other accounts, and revokes tokens', async () => {
  const session = await token(ids.client), second = await token(ids.client), phone = phones.get(ids.client)!;
  const meal = await food(ids.client), order = await trip(ids.client, ids.peerDriver, meal.id), untouched = await trip(ids.peer, ids.peerDriver);
  const application = await db.performerApplication.create({ data: { userId: ids.client, data: { personal: { firstName: 'Private' } }, roles: { create: { role: 'TAXI_DRIVER' } }, uploads: { create: { slotKey: 'avatar', kind: 'PROFILE_PHOTO', mimeType: 'image/jpeg', byteSize: 5, checksum: run, data: Buffer.from('photo') } } } });
  await db.pushToken.create({ data: { userId: ids.client, token: `ExpoPushToken[${run}]`, platform: 'android' } });
  await db.adminCredential.create({ data: { userId: ids.client, username: `legacy-${run}`, passwordHash: 'disabled-legacy-fixture', disabled: true } });
  await db.pushJob.createMany({ data: [{ userId: ids.client, event: 'chat', orderId: order.id, payload: { phone } }, { userId: ids.peerDriver, event: 'chat', orderId: order.id }] });
  await db.smsChallenge.create({ data: { phone, codeHash: run, expiresAt: new Date() } });
  await db.otpDeliveryAttempt.create({ data: { phone, codeHash: run, codeCiphertext: 'private', expiresAt: new Date() } });
  await db.rateLimit.createMany({ data: [{ key: `avatar:${ids.client}`, count: 1, expiresAt: new Date() }, { key: `verify:phone:${phone}`, count: 1, expiresAt: new Date() }] });
  await db.adminAudit.createMany({ data: [ids.client, application.id, order.id, meal.id].map(entityId => ({ actorId: ids.peerDriver, action: run, entity: 'fixture', entityId, details: { phone } })) });
  await api.delete('/api/users/me').set(session.headers).expect(200);
  for (const model of ['user', 'performerApplication', 'refreshSession', 'pushToken', 'pushJob', 'quote', 'foodOrder'] as const) {
    const field = model === 'user' ? 'id' : model === 'foodOrder' ? 'clientId' : 'userId';
    assert.equal(await (db[model] as any).count({ where: { [field]: ids.client } }), 0, model);
  }
  assert.equal(await db.performerUpload.count({ where: { applicationId: application.id } }), 0);
  assert.equal(await db.adminCredential.count({ where: { userId: ids.client } }), 0);
  assert.equal(await db.order.count({ where: { clientId: ids.client } }), 0);
  for (const model of ['message', 'rating', 'clientRating', 'statusHistory', 'orderOffer', 'pushJob'] as const) assert.equal(await (db[model] as any).count({ where: { orderId: order.id } }), 0, model);
  assert.equal(await db.smsChallenge.count({ where: { phone } }), 0); assert.equal(await db.otpDeliveryAttempt.count({ where: { phone } }), 0);
  assert.equal(await db.adminAudit.count({ where: { action: run } }), 0);
  assert.equal(await db.rateLimit.count({ where: { key: { in: [`avatar:${ids.client}`, `verify:phone:${phone}`] } } }), 0);
  const amounts = await db.ledgerEntry.findMany({ where: { driverId: ids.peerDriver } });
  assert.equal(amounts.length, 2); assert.ok(amounts.some(row => row.orderId === untouched.id));
  assert.ok(amounts.some(row => row.orderId === null && row.actorId === null && row.amount === -10 && !row.note.includes('Private')));
  assert.ok(await db.order.findUnique({ where: { id: untouched.id } }));
  await api.get('/api/users/me').set(session.headers).expect(401); await api.get('/api/users/me').set(second.headers).expect(401);
  await api.post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
  await api.post('/api/auth/request-code').send({ phone }).expect(201);
  const registered = await api.post('/api/auth/verify-code').send({ phone, code: '123456' }).expect(201);
  createdUsers.add(registered.body.user.id); assert.notEqual(registered.body.user.id, ids.client);
  assert.equal(registered.body.user.name, '');
  await api.get('/api/orders/history?period=all').set({ Authorization: `Bearer ${registered.body.accessToken}` }).expect(200, []);
});

test('driver deletion removes vehicle, location, ledger and chats while retaining a peer food order without courier contacts', async () => {
  const session = await token(ids.driver), meal = await food(ids.peer, phones.get(ids.driver));
  const order = await trip(ids.peer, ids.driver, meal.id);
  await api.delete('/api/users/me').set(session.headers).expect(200);
  assert.equal(await db.user.count({ where: { id: ids.driver } }), 0);
  assert.equal(await db.driverProfile.count({ where: { userId: ids.driver } }), 0); assert.equal(await db.vehicle.count({ where: { driverId: ids.driver } }), 0);
  assert.equal(await db.ledgerEntry.count({ where: { driverId: ids.driver } }), 0); assert.equal(await db.order.count({ where: { id: order.id } }), 0);
  const retained = await db.foodOrder.findUniqueOrThrow({ where: { id: meal.id } });
  assert.equal(retained.clientId, ids.peer); assert.equal(retained.courierPhone, null); assert.equal(retained.courierName, null);
  assert.ok(await db.user.findUnique({ where: { id: ids.peer } }));
  await api.get('/api/users/me').set(session.headers).expect(401);
});

test('public deletion confirms a one-time code, removes only the chosen account, and never creates an unknown account', async () => {
  const phone = `+996${BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 11)).toString().padStart(12, '0').slice(-9)}`;
  const clientId = randomUUID(), driverId = randomUUID();
  createdUsers.add(clientId); createdUsers.add(driverId);
  phones.set(clientId, phone); phones.set(driverId, phone);
  await db.user.createMany({ data: [{ id: clientId, phone, role: 'CLIENT' }, { id: driverId, phone, role: 'DRIVER' }] });
  await api.post('/api/auth/request-code').send({ phone, appVariant: 'client' }).expect(201);
  await api.post('/api/account-deletion/confirm').send({ phone, code: '000000', appVariant: 'client' }).expect(401);
  await api.post('/api/account-deletion/confirm').send({ phone, code: '123456', appVariant: 'client' }).expect(201, { ok: true });
  assert.equal(await db.user.count({ where: { id: clientId } }), 0);
  assert.equal(await db.user.count({ where: { id: driverId } }), 1);
  await db.rateLimit.deleteMany({ where: { key: `sms:phone-minute:${phone}` } });
  await api.post('/api/auth/request-code').send({ phone, appVariant: 'driver' }).expect(201);
  await api.post('/api/account-deletion/confirm').send({ phone, code: '123456', appVariant: 'driver' }).expect(201, { ok: true });
  assert.equal(await db.user.count({ where: { id: driverId } }), 0);

  const unknownPhone = `+996${BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 11)).toString().padStart(12, '0').slice(-9)}`;
  await api.post('/api/auth/request-code').send({ phone: unknownPhone, appVariant: 'driver' }).expect(201);
  await api.post('/api/account-deletion/confirm').send({ phone: unknownPhone, code: '123456', appVariant: 'driver' }).expect(401);
  assert.equal(await db.user.count({ where: { phone: unknownPhone } }), 0);
  await db.smsChallenge.deleteMany({ where: { phone: unknownPhone } });
  await db.otpDeliveryAttempt.deleteMany({ where: { phone: unknownPhone } });
  await db.rateLimit.deleteMany({ where: { key: { in: ['sms:phone-hour:', 'sms:phone-minute:', 'verify:phone:'].flatMap(prefix => [phone, unknownPhone].map(value => `${prefix}${value}`)) } } });
});
