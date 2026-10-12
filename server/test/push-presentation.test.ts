import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driverOfferPresentation, DRIVER_OFFER_CATEGORY, isPushNotificationEvent, pushNotificationEvents, pushPresentation } from '../src/pushPresentation';

test('driver offers show price, both addresses and whole-trip road distance / estimate with action category', () => {
  const order = { kind: 'RIDE', pickup: { address: 'Манас, 12', phone: 'private' }, dropoff: { address: 'Ала-Тоо' }, distanceMeters: 8400, durationSeconds: 1080, price: 450 };
  const presentation = driverOfferPresentation(order);
  assert.equal(presentation.title, 'Новый заказ · 450 сом');
  assert.equal(presentation.body, 'Откуда: Манас, 12\nКуда: Ала-Тоо\nМаршрут: 8,4 км · ≈18 мин\nТакси · Наличные');
  assert.equal(presentation.categoryId, DRIVER_OFFER_CATEGORY);
  assert.equal(presentation.body.includes('private'), false);
  assert.match(driverOfferPresentation({ ...order, kind: 'DELIVERY_TRUCK' }, 'ky').body, /Жүк ташуу/);
  assert.match(driverOfferPresentation({ ...order, kind: 'DELIVERY_CAR' }, 'en').body, /Delivery/);
});

test('offer address copy is bounded, single-line and excludes arbitrary payload fields', () => {
  const presentation = driverOfferPresentation({ kind: 'RIDE', pickup: { address: 'A\n\u0000B '.repeat(200), secret: 'never-send' }, dropoff: null, distanceMeters: NaN, durationSeconds: -1, price: 50 });
  assert.equal(presentation.body.split('\n').length, 4);
  assert.ok(presentation.body.length < 350);
  assert.match(presentation.body, /Не указан/);
  assert.equal(presentation.body.includes('never-send'), false);
});

test('client order lifecycle events have distinct actionable copy', () => {
  assert.equal(pushPresentation('order:created', 'CLIENT'), null);
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
    assert.ok(presentation);
    assert.equal(presentation.sound, sound); assert.equal(presentation.channelId, channel);
  }
  assert.equal(pushPresentation('order:offer', 'DRIVER')?.title, 'Новый заказ');
  assert.equal(pushPresentation('trip:completed', 'DRIVER')?.body, 'Заказ успешно завершён');
});

test('chat copy describes the sender for either recipient role', () => {
  assert.equal(pushPresentation('chat:message', 'CLIENT')?.title, 'Водитель написал вам');
  assert.equal(pushPresentation('chat:message', 'DRIVER')?.title, 'Пассажир написал вам');
  assert.equal(pushPresentation('chat:message', 'CLIENT')?.sound, 'default');
});

test('rider-coming remains useful while created and generic updates stay silent for both roles', () => {
  assert.deepEqual(pushPresentation('rider:coming', 'DRIVER'), {
    title: 'Пассажир выходит', body: 'Пассажир сообщил, что уже выходит', sound: 'default', channelId: 'orders',
  });
  for (const role of ['CLIENT', 'DRIVER']) {
    for (const event of ['order:created', 'order:updated', 'trip:started', 'unknown:event']) {
      assert.equal(pushPresentation(event, role), null);
      assert.equal(isPushNotificationEvent(event), false);
    }
    for (const event of pushNotificationEvents) assert.ok(pushPresentation(event, role), `${event} has an explicit presentation`);
  }
});

test('registration lifecycle notifications use a dedicated neutral channel',()=>{
  assert.deepEqual(pushPresentation('registration:submitted','CLIENT'),{title:'Анкета отправлена',body:'Мы получили данные и сообщим о ходе проверки',sound:'default',channelId:'registration'});
  assert.equal(pushPresentation('registration:correction_required','CLIENT')?.title,'Нужны исправления');
  assert.equal(pushPresentation('registration:approved','CLIENT')?.title,'Направление одобрено');
  assert.equal(pushPresentation('registration:document_expiring','DRIVER')?.channelId,'registration');
  assert.equal(pushPresentation('registration:document_expired','DRIVER')?.title,'Документ просрочен');
  assert.equal(pushPresentation('registration:activated','DRIVER')?.channelId,'registration');
});
