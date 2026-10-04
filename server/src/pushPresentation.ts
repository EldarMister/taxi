export const pushNotificationEvents = [
  'registration:submitted', 'registration:review_started', 'registration:document_approved',
  'registration:correction_required', 'registration:approved', 'registration:rejected',
  'registration:blocked', 'registration:activated', 'registration:document_expiring', 'registration:document_expired',
  'order:offer', 'order:assigned', 'chat:message', 'trip:arrived', 'trip:completed', 'rider:coming',
];

export function isPushNotificationEvent(event: string) {
  return pushNotificationEvents.includes(event);
}

type PushPresentation = { title: string; body: string; sound: string; channelId: string };

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
