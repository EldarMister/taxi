export function pushPresentation(event: string, role: string) {
  const driver = role === 'DRIVER';
  if (event === 'order:created') return {
    title: 'Заказ создан', body: 'Ищем для вас водителя',
    sound: 'default', channelId: 'orders',
  };
  if (event === 'order:offer') return {
    title: 'Новый заказ', body: 'Откройте приложение, чтобы принять заказ',
    sound: driver ? 'driver_new_order.wav' : 'default', channelId: driver ? 'driver-orders-v2' : 'orders',
  };
  if (event === 'order:assigned') return {
    title: 'Водитель найден', body: 'Водитель принял заказ и уже едет к вам',
    sound: 'default', channelId: 'orders',
  };
  if (event === 'chat:message') return {
    title: driver ? 'Пассажир написал вам' : 'Водитель написал вам', body: 'Новое сообщение в чате',
    sound: driver ? 'driver_passenger_message.wav' : 'default', channelId: driver ? 'driver-messages-v1' : 'orders',
  };
  if (event === 'trip:arrived') return {
    title: 'Такси приехало', body: 'Водитель ожидает вас в месте подачи',
    sound: 'default', channelId: 'orders',
  };
  if (event === 'trip:completed') return {
    title: 'Поездка завершена', body: driver ? 'Заказ успешно завершён' : 'Спасибо, что выбрали Atlas',
    sound: driver ? 'driver_trip_completed.wav' : 'default', channelId: driver ? 'driver-completed-v1' : 'orders',
  };
  if (event === 'rider:coming') return {
    title: 'Пассажир выходит', body: 'Пассажир сообщил, что уже выходит',
    sound: 'default', channelId: 'orders',
  };
  return { title: 'Ваша поездка', body: 'Статус поездки изменился', sound: 'default', channelId: 'orders' };
}
