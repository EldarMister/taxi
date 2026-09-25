import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DriverFix, DriverLocationDto, TrackingService, isNewDriverFix, normalizeDriverLocation, plausibleDriverFix, visibleDriverLocation } from '../src/tracking';
import { Actor } from '../src/auth';
import { ValidationPipe } from '@nestjs/common';

const fix = (changes: Partial<DriverFix> = {}): DriverFix => ({
  driverId: 'driver', latitude: 41.1987, longitude: 72.1802, accuracy: 8,
  timestamp: 1000, measuredAt: 1000, receivedAt: 1010,
  trackingSessionId: 'session-a', trackingStartedAt: 500, sequence: 3, ...changes,
});

test('tracking road packets validate nested coordinates and enforce a small payload', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const packet = { latitude: 42, longitude: 74, accuracy: 12, timestamp: Date.now(), matched: true,
    matchedPath: [{ latitude: 42, longitude: 74 }, { latitude: 42.001, longitude: 74 }] };
  const metadata = { type: 'body' as const, metatype: DriverLocationDto };
  const result = await pipe.transform(packet, metadata);
  assert.equal(result.matchedPath.length, 2);
  await assert.rejects(() => pipe.transform({ ...packet, matchedPath: Array(129).fill(packet.matchedPath[0]) }, metadata));
  await assert.rejects(() => pipe.transform({ ...packet, matchedPath: [{ latitude: 91, longitude: 74 }, packet.matchedPath[1]] }, metadata));
  await assert.rejects(() => pipe.transform({ ...packet, matchedPath: [{ longitude: 74 }, packet.matchedPath[1]] }, metadata));
});

test('a current location is ordered by session, sequence and measurement time', () => {
  const previous = fix();
  const next = (changes: Partial<DriverLocationDto>): DriverLocationDto => ({ ...previous, ...changes });
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, sequence: 4 })), true);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, sequence: 3 })), false);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 999, measuredAt: 999, sequence: 4 })), false);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, trackingSessionId: 'session-b', trackingStartedAt: undefined, sequence: 1 }), 1011), true);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, trackingSessionId: 'session-b', trackingStartedAt: undefined, sequence: 5 }), 1011), false);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, trackingSessionId: 'session-b', trackingStartedAt: 600, sequence: 5 })), true);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, trackingSessionId: 'session-b', trackingStartedAt: 400, sequence: 1 })), false);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, trackingSessionId: undefined, sequence: undefined }), 1011), false);
  assert.equal(isNewDriverFix(previous, next({ timestamp: 1001, measuredAt: 1001, trackingSessionId: undefined, sequence: undefined }), 16011), true);
});

test('last known point remains visible only to participants while an order is active', () => {
  const order = { status: 'ASSIGNED', driverId: 'driver', driverLocation: fix() };
  assert.deepEqual(visibleDriverLocation(order, 120_000), order.driverLocation);
  assert.equal(visibleDriverLocation({ ...order, status: 'COMPLETED' }, 120_000), null);
  assert.equal(visibleDriverLocation({ ...order, driverId: 'other' }, 120_000), null);
});

test('v1 location preserves measurement time, precision, zero speed and northward course', () => {
  const packet: DriverLocationDto = {
    schemaVersion: 1, orderId: 'order', assignmentId: 'assignment', trackingSessionId: 'session-a',
    trackingStartedAtMs: 900, sequence: 1, latitude: 42.000000123, longitude: 74.000000456,
    accuracyM: null, speedMps: 0, courseDeg: 0, measuredAtMs: 1000,
  };
  const fix = normalizeDriverLocation(packet, 'order', 1100);
  assert.equal(fix.latitude, packet.latitude);
  assert.equal(fix.longitude, packet.longitude);
  assert.equal(fix.measuredAtMs, 1000);
  assert.equal(fix.timestamp, 1000);
  assert.equal(fix.accuracyM, null);
  assert.equal(fix.speedMps, 0);
  assert.equal(fix.courseDeg, 0);
  assert.equal(fix.heading, 0);
  assert.throws(() => normalizeDriverLocation({ ...packet, orderId: 'another' }, 'order', 1100));
  assert.throws(() => normalizeDriverLocation({ ...packet, measuredAtMs: 1000 }, 'order', 20_000));
  assert.throws(() => normalizeDriverLocation({ ...packet, timestamp: 1100 }, 'order', 1100));
});

test('a retired tracking session cannot replace the next session when both carry start times', () => {
  const previous = fix({ trackingSessionId: 'new-session', trackingStartedAtMs: 2000,
    trackingStartedAt: 2000, measuredAtMs: 2100, measuredAt: 2100, timestamp: 2100, sequence: 1 });
  assert.equal(isNewDriverFix(previous, { trackingSessionId: 'old-session', trackingStartedAtMs: 1000,
    measuredAtMs: 2200, sequence: 99, latitude: 42, longitude: 74 }, 2300), false);
  assert.equal(isNewDriverFix(previous, { trackingSessionId: 'new-session', trackingStartedAtMs: 2000,
    measuredAtMs: 2200, sequence: 2, latitude: 42, longitude: 74 }, 2300), true);
  assert.equal(isNewDriverFix({ ...previous, schemaVersion: 1 }, { latitude: 42, longitude: 74,
    accuracy: 5, timestamp: 2200 }, 20_000), false);
});
test('impossible jumps and old measurements cannot replace a live driver position',()=>{
  const previous=fix({timestamp:1000,measuredAtMs:1000,accuracyM:5});
  assert.equal(plausibleDriverFix(previous,{latitude:41.3,longitude:72.18,measuredAtMs:2000,accuracyM:5}),false);
  assert.equal(plausibleDriverFix(previous,{latitude:41.1988,longitude:72.1802,measuredAtMs:2000,accuracyM:5}),true);
  assert.equal(isNewDriverFix(previous,{latitude:41.1988,longitude:72.1802,measuredAtMs:999,sequence:4,trackingSessionId:'session-a'}),false);
});

test('server binds a v1 fix to the authorized assignment and publishes only fresh versions', async () => {
  const now = Date.now();
  const order: any = { id: 'order', status: 'ASSIGNED', driverId: 'driver', clientId: 'client',
    driverLocation: null, updatedAt: new Date(), pickup: {}, dropoff: {} };
  const published: any[] = [];
  const roomPublished: any[] = [];
  const assignment = { id: 'assignment' };
  const tx = {
    $queryRaw: async () => [],
    order: { findUnique: async () => order, update: async ({ data }: any) => { order.driverLocation = data.driverLocation; } },
    statusHistory: { findFirst: async () => assignment },
  };
  const db = { $transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx),
    order: { findUnique: async () => order }, statusHistory: tx.statusHistory };
  const events = { publish: (users: string[], name: string, payload: unknown) => published.push({ users, name, payload }),
    publishOrder: (orderId: string, name: string, payload: unknown) => roomPublished.push({ orderId, name, payload }) };
  const limits = { take: async () => undefined };
  const service = new TrackingService(db as any, events as any, limits as any);
  const actor = { id: 'driver', role: 'DRIVER' } as Actor;
  const packet: DriverLocationDto = { schemaVersion: 1, orderId: 'order', assignmentId: 'assignment',
    trackingSessionId: 'session', trackingStartedAtMs: now - 1000, sequence: 1,
    latitude: 42.123456789, longitude: 74.987654321, accuracyM: 5, speedMps: 0, courseDeg: 0, measuredAtMs: now,
    matched: true, matchedPath: [{ latitude: 42.1234, longitude: 74.987654321 }, { latitude: 42.124, longitude: 74.987654321 }] };
  await assert.rejects(() => service.update({ ...actor, id: 'other' }, 'order', packet), { status: 403 });
  await assert.rejects(() => service.update(actor, 'order', { ...packet, assignmentId: 'previous' }), { status: 403 });
  assert.equal(published.length, 0);
  const accepted = await service.update(actor, 'order', packet);
  assert.equal(accepted.stateVersion, 1);
  assert.equal(accepted.location.driverId, 'driver');
  assert.equal(accepted.location.measuredAtMs, now);
  assert.ok(accepted.location.receivedAtMs! <= accepted.serverTimeMs);
  assert.equal(published.length, 1);
  assert.equal(roomPublished.length, 1);
  assert.equal(roomPublished[0].name, 'driver:location:update');
  assert.equal(roomPublished[0].payload.lat, packet.latitude);
  assert.equal(roomPublished[0].payload.seq, 1);
  assert.deepEqual(roomPublished[0].payload.location.matchedPath, packet.matchedPath);
  assert.deepEqual(published[0].payload.location.matchedPath, packet.matchedPath);
  assert.deepEqual(published[0].users, ['client']);
  const snapshot = await service.get({ ...actor, id: 'client', role: 'CLIENT' }, 'order');
  assert.equal(snapshot.assignmentId, assignment.id);
  assert.equal(snapshot.stateVersion, accepted.stateVersion);
  assert.deepEqual(snapshot.location?.matchedPath, packet.matchedPath, 'HTTP recovery retains the same road as the live event');
  assert.ok(snapshot.serverTimeMs >= accepted.serverTimeMs);
  await assert.rejects(() => service.get({ ...actor, id: 'outsider' }, 'order'), { status: 403 });
  await service.update(actor, 'order', { ...packet, latitude: 43, measuredAtMs: now + 1 });
  assert.equal(published.length, 1, 'replayed sequence must not generate another event');
  assert.equal(order.driverLocation.latitude, packet.latitude);
  const second = await service.update(actor, 'order', { ...packet, sequence: 2, measuredAtMs: now + 2 });
  assert.equal(second.stateVersion, 2);
  assert.equal(published.length, 2);
});
