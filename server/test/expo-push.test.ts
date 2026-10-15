import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sendExpoPushIndividually } from '../src/expo-push';

const message = { title: 'Новый заказ', body: 'Откройте приложение', sound: 'driver_new_order.wav',
  channelId: 'driver-orders-v2', ttl: 60, priority: 'high' as const, data: { event: 'order:offer' } };

test('only opted-in Android offers use data-only transport, without fields that make FCM auto-render', async () => {
  const sent: any[] = [];
  const fakeFetch: typeof fetch = async (_url, init) => {
    sent.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ data: { status: 'ok' } }), { status: 200 });
  };
  const offer = { ...message, categoryId: 'atlas-driver-offer-v1', data: { event: 'order:offer', orderId: 'order-one', recipientId: 'driver-one', offerExpiresAt: '2026-10-09T12:00:00Z' } };
  await sendExpoPushIndividually([
    { id: 'new', token: 'new', platform: 'android', driverOfferActions: true },
    { id: 'old', token: 'old', platform: 'android', driverOfferActions: false },
    { id: 'ios', token: 'ios', platform: 'ios', driverOfferActions: true },
  ], offer, undefined, fakeFetch);
  const modern = sent.find(value => value.to === 'new');
  assert.deepEqual(Object.keys(modern).sort(), ['data', 'priority', 'to', 'ttl']);
  assert.deepEqual(modern.data, { ...offer.data, atlasOfferVersion: '2', atlasTitle: offer.title, atlasMessage: offer.body });
  for (const field of ['title', 'message', 'channelId']) assert.equal(field in modern.data, false, 'avoid Expo auto-presentation too');
  for (const id of ['old', 'ios']) {
    const legacy = sent.find(value => value.to === id); assert.equal(legacy.title, offer.title); assert.equal(legacy.channelId, offer.channelId);
  }
  sent.length = 0;
  await sendExpoPushIndividually([{ id: 'new', token: 'new', platform: 'android', driverOfferActions: true }],
    { ...offer, data: { event: 'chat:message' } }, undefined, fakeFetch);
  assert.equal(sent[0].title, offer.title, 'regular chat notifications retain their normal transport');
});

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
