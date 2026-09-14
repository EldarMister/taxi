import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushTtlSeconds, safePushFailureReason } from '../src/providers';

test('push TTL follows the lifetime of each event', () => {
  const now = Date.now();
  assert.equal(pushTtlSeconds('order:offer', new Date(now + 95_000), now), 95);
  assert.equal(pushTtlSeconds('order:offer', new Date(now + 500), now), 1);
  assert.equal(pushTtlSeconds('chat:message'), 6 * 60 * 60);
  assert.equal(pushTtlSeconds('order:assigned'), 30 * 60);
  assert.equal(pushTtlSeconds('trip:arrived'), 30 * 60);
  assert.equal(pushTtlSeconds('rider:coming'), 30 * 60);
  assert.equal(pushTtlSeconds('order:updated'), 30 * 60);
  assert.equal(pushTtlSeconds('order:created'), 24 * 60 * 60);
  assert.equal(pushTtlSeconds('trip:completed'), 24 * 60 * 60);
});

test('push failure diagnostics never echo arbitrary error messages', () => {
  assert.equal(safePushFailureReason(new Error('ExponentPushToken[secret-device-token]')), 'Error');
  assert.equal(safePushFailureReason({ name: 'FirebaseError', code: 'messaging/server-unavailable', message: 'secret-device-token' }), 'FirebaseError:messaging/server-unavailable');
  assert.equal(safePushFailureReason({ name: 'FirebaseError', code: 'ExponentPushToken[secret-device-token]' }), 'FirebaseError');
  assert.equal(safePushFailureReason('secret-device-token'), 'UnknownError');
});
