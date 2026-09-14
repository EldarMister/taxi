import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushPresentation } from '../src/pushPresentation';

test('client order lifecycle events have distinct actionable copy', () => {
  assert.deepEqual(pushPresentation('order:created', 'CLIENT'), {
    title: 'Заказ создан', body: 'Ищем для вас водителя', sound: 'default', channelId: 'orders',
  });
  assert.deepEqual(pushPresentation('order:assigned', 'CLIENT'), {
    title: 'Водитель найден', body: 'Водитель принял заказ и уже едет к вам', sound: 'default', channelId: 'orders',
  });
  assert.deepEqual(pushPresentation('trip:arrived', 'CLIENT'), {
    title: 'Такси приехало', body: 'Водитель ожидает вас в месте подачи', sound: 'default', channelId: 'orders',
  });
  assert.deepEqual(pushPresentation('trip:completed', 'CLIENT'), {
    title: 'Поездка завершена', body: 'Спасибо, что выбрали Atlas', sound: 'default', channelId: 'orders',
  });
});

test('driver offer, passenger message and completion select bundled voices and channels', () => {
  for (const [event, sound, channel] of [
    ['order:offer', 'driver_new_order.wav', 'driver-orders-v2'],
    ['chat:message', 'driver_passenger_message.wav', 'driver-messages-v1'],
    ['trip:completed', 'driver_trip_completed.wav', 'driver-completed-v1'],
  ]) {
    const presentation = pushPresentation(event, 'DRIVER');
    assert.equal(presentation.sound, sound); assert.equal(presentation.channelId, channel);
  }
  assert.equal(pushPresentation('order:offer', 'DRIVER').title, 'Новый заказ');
  assert.equal(pushPresentation('trip:completed', 'DRIVER').body, 'Заказ успешно завершён');
});

test('chat copy describes the sender for either recipient role', () => {
  assert.equal(pushPresentation('chat:message', 'CLIENT').title, 'Водитель написал вам');
  assert.equal(pushPresentation('chat:message', 'DRIVER').title, 'Пассажир написал вам');
  assert.equal(pushPresentation('chat:message', 'CLIENT').sound, 'default');
});

test('rider-coming and unknown state updates retain a neutral default presentation', () => {
  assert.deepEqual(pushPresentation('rider:coming', 'DRIVER'), {
    title: 'Пассажир выходит', body: 'Пассажир сообщил, что уже выходит', sound: 'default', channelId: 'orders',
  });
  assert.deepEqual(pushPresentation('order:updated', 'DRIVER'), {
    title: 'Ваша поездка', body: 'Статус поездки изменился', sound: 'default', channelId: 'orders',
  });
});
