# Atlas pro 1.2.16 — кнопки уведомления в фоне

На скриншоте пользователя карточка нового заказа была развёрнута и содержала все сведения, но не действия. Причина предыдущего варианта: Expo запрос с верхнеуровневыми title/body/channelId превращается в FCM notification-message. В фоне или при закрытом приложении его отображает FCM, который не использует сохранённые категории действий Expo. Юнит-тесты 1.2.15 проверяли поля и обработчики, но не создание Android-карточки; это был пробел проверки.

Обновлённый Android Atlas pro регистрирует вместе с push-токеном capability driverOfferActions. Сервер хранит её отдельно для каждого устройства. Миграция 20261009210000_driver_offer_actions добавляет Boolean с default false; прежние устройства продолжают получать обычные уведомления. iOS и клиентское приложение не включают новый формат. Выход и смена аккаунта сохраняют прежнюю защиту регистрации.

Только предложения заказа для обновлённого Android получают data-only Expo запрос: to/priority/ttl/data. Нет верхнеуровневых title/body/channelId и нет data.title/message, вызывающих автоматический показ. Внутри data передаются event, eventId, orderId, recipientId, offerExpiresAt, atlasOfferVersion=2, atlasTitle, atlasMessage.

AtlasOfferMessagingService заменяет стандартный входной Expo Firebase service, сохраняя его обработку остальных сообщений и обновления токена. На устройстве Atlas pro он преобразует версию 2 в формат установленного Expo RemoteNotificationContent до показа: восстанавливает заголовок, текст, driver-orders-v2, звук и atlas-driver-offer-v1, а в content.data оставляет метаданные действия. Срок и ID проверяются перед преобразованием. Категория из двух действий и канал создаются нативно, если отсутствуют, без ожидания JavaScript; сохранённые переводы не перезаписываются. Затем стандартный Expo builder добавляет BigTextStyle и два PendingIntent. По нажатию открывается приложение и работает прежняя проверка актуального предложения, получателя, аккаунта и активного заказа.

Для пользователей: установить Atlas pro 1.2.16 (128), один раз открыть с действующим аккаунтом и доступом к сети для обновления push-регистрации, затем проверить новое предложение в фоне. Ранее доставленные карточки Android не меняет задним числом. Номер и геометрия пассажира в push не добавлены. Карта и иллюстрации не менялись.

Источники: [официальное описание типов и фонового поведения Expo](https://docs.expo.dev/push-notifications/what-you-need-to-know/), [запросы Expo](https://docs.expo.dev/push-notifications/sending-notifications/). Поведение преобразования сверено с исходниками установленного expo-notifications 0.32.17: RemoteNotificationContent, NotificationData, FirebaseNotificationTrigger и ExpoNotificationBuilder.

Мобильные действия / регистрация / звуки / обновления: 32 проверки прошли; серверные push и регистрация: 22 проверки прошли; TypeScript и сборка сервера — успешно; варианты приложений: 11 проверок прошли. Нативная проверка Android-карточки и APK — см. результаты ниже после завершения сборки. Реальному пользователю тестовые push не отправлялись.

Нативная проверка Robolectric прошла: 3/3, ошибок и падений нет. Проверяется реальный ExpoNotificationBuilder: Notification.actions содержит две кнопки с PendingIntent, driver-orders-v2, заголовок и полный BigText. Отдельно проверены отказ от преобразования просроченных/повреждённых сообщений и сохранение переведённых кнопок. Это автоматическая проверка Android API, не тест на телефоне пользователя.

Production deployment `e6760058-9b4a-4f17-85bd-83242f83d41a` — SUCCESS; `/api/health` отвечает `{"status":"ok"}`. Сборка основана на предыдущем production snapshot `.local/driver-offer-actions-api-release`, заменены только expo-push.ts/providers.ts/dto.ts/http.ts, schema.prisma и добавлена указанная миграция. Полное удаление аккаунта и остальные опубликованные изменения сохранены.

Atlas pro APK собран и проверен: `atlas.pro`, 1.2.16 (128), arm64-v8a, правильный driver EAS projectId, production API, driverOfferActions в JS и AtlasOfferMessagingService в DEX и manifest. Стандартный ExpoFirebaseMessagingService удалён из итогового manifest; входящий FCM intent обслуживает новый сервис (стандартный базовый Firebase service остаётся в библиотеке с более низким приоритетом).

- `mobile/builds/Atlas-driver-1.2.16-arm64.apk`: 95 040 657 байт; SHA-256 `fd92369fc6b2279694afa9abe723ac632dc4bb8d172ebb5ec9fa8f30c7d8be76`.
- APK подписан тем же сертификатом, что предыдущие версии: SHA-256 `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`.
- `mobile/builds/Atlas-client-1.2.16-arm64.apk`: 95 040 701 байт; SHA-256 `4622e16fbba281355ad56e5ffab027c4e322571e78cced328bf667a3cbf55f84`. Проверены `atlas.kg`, client variant, 1.2.16 (128), arm64-v8a, client EAS projectId и production API; подпись совпадает с Atlas pro. Обе сборки завершились успешно.
