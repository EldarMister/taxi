import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendExpoPushIndividually } from '../src/expo-push';

const message = { title: 'Новый заказ', body: 'Откройте приложение', sound: 'driver_new_order.wav',
  channelId: 'driver-orders-v2', ttl: 60, priority: 'high' as const, data: { event: 'order:offer' } };

test('Expo sends one token per request so mixed projects and a stale device do not block valid devices', async () => {
  const destinations: string[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(Array.isArray(payload), false);
    destinations.push(payload.to);
    return new Response(JSON.stringify({ data: payload.to === 'stale'
      ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'ticket' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const report = await sendExpoPushIndividually([{ id: 'a', token: 'valid' }, { id: 'b', token: 'stale' }], message, undefined, fakeFetch);
  assert.deepEqual(destinations.sort(), ['stale', 'valid']);
  assert.deepEqual(report, { delivered: 1, invalidIds: ['b'], failures: [] });
});

test('Expo HTTP failure exposes only a safe error code, never a push token', async () => {
  const fakeFetch: typeof fetch = async () => new Response(JSON.stringify({ errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }),
    { status: 400, headers: { 'Content-Type': 'application/json' } });
  const report = await sendExpoPushIndividually([{ id: 'a', token: 'sensitive-token' }], message, undefined, fakeFetch);
  assert.deepEqual(report, { delivered: 0, invalidIds: [], failures: ['expo-http-400-PUSH_TOO_MANY_EXPERIENCE_IDS'] });
  assert.doesNotMatch(JSON.stringify(report), /sensitive-token/);
});
