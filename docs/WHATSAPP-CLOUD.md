# WhatsApp OTP через Meta Cloud API

## Проверенные идентификаторы

Проверка Graph API 09.10.2026:

| Значение | ID |
|---|---|
| WABA Atlas | `793166050483144` |
| Phone Number ID Jardamchy GO (`+996 220 310 310`) | `1000527066477663` |

Первоначально переданный `100052706647763` неверен: в нём пропущена цифра.
Номер имеет `status=CONNECTED`, `quality_rating=GREEN`, `messaging_limit_tier=TIER_250`.
WABA: `account_review_status=APPROVED`, `business_verification_status=pending_submission`.
Это отдельные статусы; утверждение о завершённой юридической верификации неверно.

## Шаблон atlas

Отправлен реальный POST `/{WABA_ID}/message_templates` с категорией AUTHENTICATION,
языком `ru`, ZERO_TAP, сроком кода 5 минут и двумя supported_apps:

| Android package | Хэш текущей подписи APK |
|---|---|
| `atlas.kg` | `AhDnRV8wj+C` |
| `atlas.pro` | `zpsXs/K48RO` |

Meta вернула HTTP 400, `code=10`, `error_subcode=2388185`:
«У этого бизнес-аккаунта WhatsApp нет разрешения на создание шаблонов сообщений».
Права токена `whatsapp_business_management` и `whatsapp_business_messaging` присутствуют.
Шаблон **не создан и не одобрен**. Причину ограничения аккаунта необходимо разрешить
в Meta; нельзя утверждать, что эта ошибка обходится API или сменой названия шаблона.
Отправка настоящих OTP не активирована, чтобы не сломать текущий вход.

Дополнительно отправлен предоставленный пользователем вариант `atlas_code`,
`category=UTILITY`, `language=ru`, с обычной URL-кнопкой на `https://jardamchy.go`.
API создала запись `1122535146980136`, но сразу вернула `status=REJECTED`.
Отдельный GET подтвердил `rejected_reason=INCORRECT_CATEGORY`.
Таким образом, фактический отказ для этого текста связан с категорией OTP.
Обычная статическая URL-кнопка также не реализует Android zero-tap/one-tap OTP.
Отправка приложения на этот отклонённый шаблон не переключалась; сообщений
пользователям не отправлялось.

Повторное создание после снятия ограничения: из `server/` выполнить
`node scripts/whatsapp-auth-template.mjs` с приватными переменными окружения.
Скрипт сначала проверяет существующий шаблон, не дублирует POST после неясного сбоя
и выводит только безопасные числовые ошибки. После смены ключа подписи APK
или перехода на Play App Signing хэши необходимо пересчитать.

## Серверная конфигурация

На **API-сервисе** Railway (не на сайте и не в мобильном приложении):

```dotenv
SMS_PROVIDER=whatsapp_cloud
DEV_AUTH_ENABLED=false
WHATSAPP_CLOUD_TOKEN=<system-user access token>
WHATSAPP_CLOUD_PHONE_ID=1000527066477663
WHATSAPP_CLOUD_WABA_ID=793166050483144
WHATSAPP_CLOUD_TEMPLATE=atlas
WHATSAPP_CLOUD_LANGUAGE=ru
WHATSAPP_CLOUD_VERSION=v25.0
WHATSAPP_CLOUD_APP_SECRET=<Meta application secret>
WHATSAPP_CLOUD_VERIFY_TOKEN=<separate random verification token>
TELEGRAM_GATEWAY_TOKEN=
```

Включать `SMS_PROVIDER=whatsapp_cloud` только после APPROVED шаблона, установки
всех секретов и настройки webhook. Рекомендуется долгоживущий системный токен;
раскрытый в переписке токен необходимо заменить. Токены не включаются в Git/APK.

Callback URL:
`https://api-production-47be.up.railway.app/api/auth/whatsapp/webhook`.
В Meta настроить callback, отдельный verify token и поле `messages`, затем
подписать приложение на WABA (`POST /{WABA_ID}/subscribed_apps`).
GET возвращает исходный числовой challenge только с правильным verify token.
POST принимает только корректную HMAC-SHA256 подпись `x-hub-signature-256`
по **исходным байтам тела** и Meta App Secret. Access token для подписи не подходит.
Проверяются WABA, Phone Number ID, message ID и номер получателя.

App Secret сохранён в приватном локальном файле и настройках API Railway.
Токен проверен: SYSTEM_USER, `is_valid=true`, `expires_at=0`.
У приложения Jardamchy GO уже есть активная подписка на `messages` и
`message_template_status_update` с callback на отдельном Railway-сервисе.
Эта подписка **не перезаписана**, пока шаблон заблокирован. При активации
следует определить назначение прежнего обработчика, затем переключить callback
для WABA Atlas через `override_callback_uri`/`verify_token` в
`POST /{WABA_ID}/subscribed_apps`, либо организовать передачу статусов от него.
Это сохраняет обработчики других WABA, привязанных к тому же Meta-приложению.

Отправка: один запрос к `/{PHONE_NUMBER_ID}/messages` с одинаковым шестизначным
OTP в body и URL-параметре кнопки. Принятие запроса не считается доставкой:
последняя подтверждается webhook delivered/read. Ошибки и неопределённые таймауты
не приводят к слепому повторению платного запроса. Существующие HMAC, срок 5 минут,
одноразовое использование, лимиты и серверная проверка сохранены.

## Telegram

Gateway выключен пустым TELEGRAM_GATEWAY_TOKEN, пока нет пополнения.
Приложение не сообщает о фиктивной отправке в Telegram и не делает платных
проверок наличия аккаунта. С сохранённым и финансируемым токеном существующий
durable fallback работает также для Cloud API: отказ WhatsApp либо отсутствие
подтверждённой доставки 60 секунд → Telegram с тем же OTP. Платежи не выполнялись.
Минимальный платёж из кабинета нельзя уменьшить кодом приложения.
Официальный бесплатный тест Gateway — сообщения на собственный номер владельца
Gateway; это не бесплатная рассылка другим пользователям.

## Проверки

38 серверных проверок провайдеров/OTP/fallback/webhook и 34 проверки мобильного
входа прошли. Проверены параметры отправки, безопасные отказы, HMAC подписи,
проверка callback через настоящий HTTP, чужие/повторные события, работа без Telegram и с fallback.
Сборка TypeScript сервера прошла. Реальная доставка и zero-tap на телефоне
остаются непроверенными до одобрения шаблона и подключения соответствующей подписки Meta.

Обновление API Railway `8b2ce4e5-0594-4364-ad45-7fc3b26fe56f`: SUCCESS.
На опубликованном сервере проверены `/api/health` (200), правильный verification
challenge (200, исходное значение), неподписанный webhook (403), правильно
подписанный пустой webhook (200). Сайт Atlas продолжает отвечать 200.
Тестовые запросы не отправляли OTP пользователям и не выполняли платежей.
SMS_PROVIDER и действующий сценарий входа не переключались; только подготовлены
серверные настройки Cloud API и отключён нефинансируемый Gateway.

Источники: [официальная коллекция Meta](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api),
[Message Templates API](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates),
[WhatsApp Android OTP SDK](https://github.com/WhatsApp/WhatsApp-Android-OTP-SDK),
[Telegram Gateway](https://core.telegram.org/gateway),
[условия оплаты Gateway](https://telegram.org/tos/gateway).
