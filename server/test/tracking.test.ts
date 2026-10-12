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
  assert.equal(fix.courseAccuracyDeg, null);
  assert.equal(fix.courseSource, null);
  assert.throws(() => normalizeDriverLocation({ ...packet, orderId: 'another' }, 'order', 1100));
  assert.throws(() => normalizeDriverLocation({ ...packet, measuredAtMs: 1000 }, 'order', 20_000));
  assert.throws(() => normalizeDriverLocation({ ...packet, timestamp: 1100 }, 'order', 1100));
});

test('unknown course remains null, while course quality preserves real zero values', async () => {
  const packet: DriverLocationDto = {
    schemaVersion: 1, orderId: '00000000-0000-4000-8000-000000000001',
    assignmentId: '00000000-0000-4000-8000-000000000002', trackingSessionId: 'quality',
    trackingStartedAtMs: 900, sequence: 1, latitude: 42, longitude: 74,
    accuracyM: null, speedMps: null, courseDeg: null, measuredAtMs: 1000,
    courseAccuracyDeg: null, courseSource: null,
  };
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const metadata = { type: 'body' as const, metatype: DriverLocationDto };
  const validated = await pipe.transform(packet, metadata);
  const unknown = normalizeDriverLocation(validated, packet.orderId!, 1100);
  assert.equal(unknown.courseDeg, null);
  assert.equal(unknown.heading, undefined);
  assert.equal(unknown.speedMps, null);
  assert.equal(unknown.courseAccuracyDeg, null);
  for (const courseDeg of [0, 90, 180, 270, 359.99999]) {
    const value = await pipe.transform({ ...packet, courseDeg, speedMps: 10,
      courseAccuracyDeg: 0, courseSource: 'gps' }, metadata);
    const normalized = normalizeDriverLocation(value, packet.orderId!, 1100);
    assert.equal(normalized.courseDeg, courseDeg, 'no radians, sign or 180-degree adjustment');
    assert.equal(normalized.speedMps, 10, 'speed remains metres per second');
    assert.equal(normalized.courseAccuracyDeg, 0);
    assert.equal(normalized.courseSource, 'gps');
  }
  await assert.rejects(() => pipe.transform({ ...packet, courseAccuracyDeg: 181 }, metadata));
  await assert.rejects(() => pipe.transform({ ...packet, courseSource: 'device' }, metadata));
  assert.throws(() => normalizeDriverLocation({ ...packet, courseDeg: 360 }, packet.orderId!, 1100));
  assert.throws(() => normalizeDriverLocation({ ...packet, courseSource: 'gps' }, packet.orderId!, 1100));
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

test('a versioned stream cannot be taken over by an unidentified old session after reconnect', () => {
  const previous = fix({ schemaVersion: 1, trackingSessionId: 'current', trackingStartedAtMs: 2000,
    measuredAtMs: 2100, timestamp: 2100, sequence: 2 });
  const next: DriverLocationDto = { schemaVersion: 1, trackingSessionId: 'retired',
    measuredAtMs: 2200, sequence: 1, latitude: 42, longitude: 74 };
  assert.equal(isNewDriverFix(previous, next, 100_000), false);
  assert.equal(isNewDriverFix(previous, { ...next, trackingStartedAtMs: 1000 }, 100_000), false);
  assert.equal(isNewDriverFix(previous, { ...next, trackingSessionId: 'current',
    trackingStartedAtMs: 2100, sequence: 3 }, 100_000), false, 'a session start is immutable');
  assert.equal(isNewDriverFix(previous, { ...next, trackingSessionId: 'new',
    trackingStartedAtMs: 2150, sequence: 3 }, 2300), true, 'lost first packets do not block a new session');
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

function durableTrackingHarness() {
  const now = Date.now();
  const actor = { id: 'driver', role: 'DRIVER' } as Actor;
  const order: any = { id: 'order', status: 'ASSIGNED', driverId: 'driver', clientId: 'client',
    driverLocation: null, updatedAt: new Date(), pickup: {}, dropoff: {} };
  const assignment = { id: 'assignment' };
  const published: any[] = [];
  const control = { rejectNextCommit: false, committedWrites: 0 };
  const db = {
    order: { findUnique: async () => structuredClone(order) },
    statusHistory: { findFirst: async () => assignment },
    $transaction: async (work: (tx: any) => Promise<unknown>) => {
      const staged = structuredClone(order);
      let writes = 0;
      const result = await work({ $queryRaw: async () => [], statusHistory: db.statusHistory,
        order: { findUnique: async () => staged, update: async ({ data }: any) => {
          staged.driverLocation = data.driverLocation; writes++;
        } } });
      if (control.rejectNextCommit) { control.rejectNextCommit = false; throw new Error('simulated commit failure'); }
      Object.assign(order, staged); control.committedWrites += writes;
      return result;
    },
  };
  const events = { publish: (_users: string[], _name: string, payload: unknown) => published.push(payload), publishOrder: () => undefined };
  const createService = () => new TrackingService(db as any, events as any, { take: async () => undefined } as any);
  const packet: DriverLocationDto = { schemaVersion: 1, orderId: 'order', assignmentId: 'assignment',
    trackingSessionId: 'active', trackingStartedAtMs: now - 20_000, sequence: 1,
    latitude: 42, longitude: 74, measuredAtMs: now - 10_000, accuracyM: 5,
    speedMps: 10, courseDeg: 0, courseAccuracyDeg: null, courseSource: 'gps' };
  return { now, actor, order, assignment, published, control, createService, packet };
}

test('1/3/5 second updates and ordering survive an API process restart', async () => {
  const h = durableTrackingHarness();
  const service = h.createService();
  let elapsed = 0;
  let latest = h.packet;
  await service.update(h.actor, 'order', latest);
  for (const interval of [1000, 3000, 5000]) {
    elapsed += interval;
    latest = { ...latest, sequence: latest.sequence! + 1, measuredAtMs: h.packet.measuredAtMs! + elapsed,
      latitude: h.packet.latitude + elapsed / 1000 * 10 / 111_195 };
    await service.update(h.actor, 'order', latest);
  }
  assert.equal(h.control.committedWrites, 4, 'every published ordering watermark is durable');
  const restarted = h.createService();
  const snapshot = await restarted.get(h.actor, 'order');
  assert.equal(snapshot.stateVersion, 4);
  assert.equal(snapshot.location?.latitude, latest.latitude);
  assert.equal(snapshot.location?.measuredAtMs, latest.measuredAtMs);
  assert.equal(snapshot.location?.courseSource, 'gps');
  assert.equal(snapshot.location?.courseAccuracyDeg, null);
  await restarted.update(h.actor, 'order', { ...latest, measuredAtMs: latest.measuredAtMs! + 10 });
  await restarted.update(h.actor, 'order', { ...h.packet, sequence: 99 });
  assert.equal(h.published.length, 4, 'duplicate sequence and reversed measurement cannot reappear after restart');
  const result = await restarted.update(h.actor, 'order', { ...latest, sequence: 5, measuredAtMs: h.now });
  assert.equal(result.stateVersion, 5);
});

test('a failed commit publishes nothing and never leaks an uncommitted fix into HTTP recovery', async () => {
  const h = durableTrackingHarness();
  const service = h.createService();
  await service.update(h.actor, 'order', h.packet);
  const next = { ...h.packet, sequence: 2, measuredAtMs: h.now - 9000, latitude: 42.0001 };
  h.control.rejectNextCommit = true;
  await assert.rejects(() => service.update(h.actor, 'order', next), /simulated commit failure/);
  const snapshot = await service.get(h.actor, 'order');
  assert.equal(snapshot.stateVersion, 1);
  assert.equal(snapshot.location?.latitude, h.packet.latitude);
  assert.equal(h.published.length, 1);
  const retried = await service.update(h.actor, 'order', next);
  assert.equal(retried.stateVersion, 2);
  assert.equal(h.published.length, 2, 'the same sequence is accepted after its first transaction rolled back');
});

test('assignment change rejects old messages and resets only the new assignment stream', async () => {
  const h = durableTrackingHarness();
  const service = h.createService();
  await service.update(h.actor, 'order', h.packet);
  h.assignment.id = 'next-assignment';
  await assert.rejects(() => service.update(h.actor, 'order', { ...h.packet, sequence: 2,
    measuredAtMs: h.now - 9000 }), { status: 403 });
  assert.equal((await service.get(h.actor, 'order')).location, null);
  const next = await service.update(h.actor, 'order', { ...h.packet, assignmentId: h.assignment.id,
    trackingSessionId: 'new-order-session', trackingStartedAtMs: h.now - 9500, measuredAtMs: h.now - 9000 });
  assert.equal(next.stateVersion, 1);
  assert.equal(next.assignmentId, h.assignment.id);
  h.order.status = 'COMPLETED';
  assert.equal((await service.get(h.actor, 'order')).location, null);
  await assert.rejects(() => service.update(h.actor, 'order', { ...h.packet, assignmentId: h.assignment.id,
    measuredAtMs: h.now - 8000 }), { status: 403 });
});

test('two distinct precise fixes recover a GPS relocation without accepting an isolated outlier', async () => {
  const h = durableTrackingHarness();
  const service = h.createService();
  await service.update(h.actor, 'order', h.packet);
  const moved = { ...h.packet, sequence: 2, latitude: 42.01, measuredAtMs: h.now - 9000 };
  assert.equal((await service.update(h.actor, 'order', moved)).stateVersion, 1);
  assert.equal((await service.update(h.actor, 'order', moved)).stateVersion, 1, 'a duplicate cannot confirm a relocation');
  assert.equal((await service.update(h.actor, 'order', { ...moved, sequence: 3, measuredAtMs: h.now - 9100 })).stateVersion, 1,
    'an out-of-order candidate cannot confirm a relocation');
  assert.equal(h.published.length, 1);
  const recovered = await service.update(h.actor, 'order', { ...moved, sequence: 3,
    latitude: 42.01005, measuredAtMs: h.now - 8000 });
  assert.equal(recovered.stateVersion, 2);
  assert.equal(recovered.location.latitude, 42.01005);
  assert.equal(h.published.length, 2);
  assert.equal((await service.update(h.actor, 'order', { ...moved, sequence: 4,
    latitude: 42.02, measuredAtMs: h.now - 7000 })).stateVersion, 2, 'accepted recovery clears its previous candidate');
});

test('relocation confirmation cannot cross sessions or an API restart and needs good accuracy', async () => {
  const h = durableTrackingHarness();
  const service = h.createService();
  await service.update(h.actor, 'order', h.packet);
  const moved = { ...h.packet, sequence: 2, latitude: 42.01, measuredAtMs: h.now - 9000 };
  await service.update(h.actor, 'order', moved);
  const nextSession = { ...moved, trackingSessionId: 'replacement', trackingStartedAtMs: h.now - 8500,
    sequence: 1, measuredAtMs: h.now - 8000 };
  assert.equal((await service.update(h.actor, 'order', nextSession)).stateVersion, 1);
  const restarted = h.createService();
  assert.equal((await restarted.update(h.actor, 'order', { ...nextSession, sequence: 2,
    measuredAtMs: h.now - 7000 })).stateVersion, 1, 'restart cannot turn one rejected point into confirmation');
  assert.equal((await restarted.update(h.actor, 'order', { ...nextSession, sequence: 3,
    accuracyM: 60, measuredAtMs: h.now - 6000 })).stateVersion, 1);
  assert.equal((await restarted.update(h.actor, 'order', { ...nextSession, sequence: 4,
    measuredAtMs: h.now - 5000 })).stateVersion, 1, 'poor accuracy resets confidence');
  assert.equal((await restarted.update(h.actor, 'order', { ...nextSession, sequence: 5,
    measuredAtMs: h.now - 4000 })).stateVersion, 2);
});

test('relocation candidates expire while the previous accepted location remains authoritative', async t => {
  const h = durableTrackingHarness();
  let now = h.now;
  t.mock.method(Date, 'now', () => now);
  const service = h.createService();
  await service.update(h.actor, 'order', { ...h.packet, measuredAtMs: now });
  now += 1000;
  const moved = { ...h.packet, latitude: 42.02, sequence: 2, measuredAtMs: now };
  await service.update(h.actor, 'order', moved);
  now += 11_000;
  assert.equal((await service.update(h.actor, 'order', { ...moved, sequence: 3, measuredAtMs: now })).stateVersion, 1);
  now += 1000;
  assert.equal((await service.update(h.actor, 'order', { ...moved, sequence: 4, measuredAtMs: now })).stateVersion, 2);
});
