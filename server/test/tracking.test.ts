import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DriverFix, DriverLocationDto, isNewDriverFix, visibleDriverLocation } from '../src/tracking';

const fix = (changes: Partial<DriverFix> = {}): DriverFix => ({
  driverId: 'driver', latitude: 41.1987, longitude: 72.1802, accuracy: 8,
  timestamp: 1000, measuredAt: 1000, receivedAt: 1010,
  trackingSessionId: 'session-a', trackingStartedAt: 500, sequence: 3, ...changes,
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
