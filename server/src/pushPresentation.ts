export const pushNotificationEvents = [
  'registration:submitted', 'registration:review_started', 'registration:document_approved',
  'registration:correction_required', 'registration:approved', 'registration:rejected',
  'registration:blocked', 'registration:activated', 'registration:document_expiring', 'registration:document_expired',
  'order:offer', 'order:assigned', 'chat:message', 'trip:arrived', 'trip:completed', 'rider:coming',
];

export function isPushNotificationEvent(event: string) {
  return pushNotificationEvents.includes(event);
}

type PushPresentation = { title: string; body: string; sound: string; channelId: string; categoryId?: string };

export const DRIVER_OFFER_CATEGORY = 'atlas-driver-offer-v1';

export function driverOfferPresentation(order: { kind: string; pickup: unknown; dropoff: unknown; distanceMeters: number; durationSeconds: number; price: number }, language = 'ru'): PushPresentation {
  const copy = language === 'ky'
    ? { title: 'Жаңы заказ', from: 'Кайдан', to: 'Кайда', route: 'Маршрут', km: 'км', min: 'мүн', currency: 'сом', ride: 'Такси', car: 'Жеткирүү', truck: 'Жүк ташуу', cash: 'Накталай', unknown: 'Көрсөтүлгөн эмес' }
    : language === 'en'
      ? { title: 'New order', from: 'From', to: 'To', route: 'Route', km: 'km', min: 'min', currency: 'KGS', ride: 'Taxi', car: 'Delivery', truck: 'Cargo', cash: 'Cash', unknown: 'Not specified' }
      : { title: 'Новый заказ', from: 'Откуда', to: 'Куда', route: 'Маршрут', km: 'км', min: 'мин', currency: 'сом', ride: 'Такси', car: 'Доставка', truck: 'Грузовой', cash: 'Наличные', unknown: 'Не указан' };
  const address = (point: unknown) => {
    const value = point && typeof point === 'object' && 'address' in point ? Reflect.get(point, 'address') : undefined;
    return typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150) : copy.unknown;
  };
  const number = (value: number, decimals = 0) => Number.isFinite(value) && value >= 0
    ? new Intl.NumberFormat(language === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: decimals }).format(value) : copy.unknown;
  const kind = order.kind === 'DELIVERY_TRUCK' ? copy.truck : order.kind === 'DELIVERY_CAR' ? copy.car : copy.ride;
  return {
    title: `${copy.title} · ${number(order.price)} ${copy.currency}`,
    body: `${copy.from}: ${address(order.pickup)}\n${copy.to}: ${address(order.dropoff)}\n${copy.route}: ${number(order.distanceMeters / 1000, 1)} ${copy.km} · ≈${number(Math.ceil(order.durationSeconds / 60))} ${copy.min}\n${kind} · ${copy.cash}`,
    sound: 'driver_new_order.wav', channelId: 'driver-orders-v2', categoryId: DRIVER_OFFER_CATEGORY,
  };
}

export function pushPresentation(event: string, role: string): PushPresentation | null {
  const driver = role === 'DRIVER';
  if(event==='registration:submitted')return {title:'Анкета отправлена',body:'Мы получили данные и сообщим о ходе проверки',sound:'default',channelId:'registration'};
  if(event==='registration:review_started')return {title:'Проверка началась',body:'Специалист начал проверять вашу анкету',sound:'default',channelId:'registration'};
  if(event==='registration:document_approved')return {title:'Документ одобрен',body:'Один из документов успешно прошёл проверку',sound:'default',channelId:'registration'};
  if(event==='registration:correction_required')return {title:'Нужны исправления',body:'Откройте анкету и исправьте отмеченные пункты',sound:'default',channelId:'registration'};
  if(event==='registration:approved')return {title:'Направление одобрено',body:'Откройте анкету, чтобы посмотреть статус допуска',sound:'default',channelId:'registration'};
  if(event==='registration:rejected')return {title:'Решение по анкете',body:'Откройте анкету, чтобы посмотреть решение и дальнейшие действия',sound:'default',channelId:'registration'};
  if(event==='registration:blocked')return {title:'Направление ограничено',body:'Откройте анкету, чтобы посмотреть причину и доступные действия',sound:'default',channelId:'registration'};
  if(event==='registration:activated')return {title:'Профиль исполнителя активирован',body:'Теперь можно перейти к работе',sound:'default',channelId:'registration'};
  if(event==='registration:document_expiring')return {title:'Срок документа заканчивается',body:'Загрузите новый документ, чтобы сохранить допуск',sound:'default',channelId:'registration'};
  if(event==='registration:document_expired')return {title:'Документ просрочен',body:'Обновите документ в анкете исполнителя',sound:'default',channelId:'registration'};
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
  // Realtime state updates are silent; only explicitly named events alert a user.
  return null;
}
