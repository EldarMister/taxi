# Клиентское и водительское приложения

Один общий исходный код собирается в два независимо устанавливаемых приложения. Сервер, авторизация, карта, события Socket.IO и жизненный цикл заказа остаются общими, но бинарники имеют разные идентификаторы и принимают разные роли аккаунта.

| Вариант | `APP_VARIANT` | Название | Android | iOS | Схема | Допустимая роль |
| --- | --- | --- | --- | --- | --- |
| Клиент | `client` | Atlas | `atlas.kg` | `kg.taxigo.app` | `taxi-go` | `CLIENT` |
| Водитель | `driver` | Atlas pro | `atlas.pro` | `kg.taxigo.driver` | `taxi-go-driver` | `DRIVER` |

Если `APP_VARIANT` не задан, всегда собирается прежнее клиентское приложение. Обычные команды `npm start`, `npm run android`, `npm run ios` и `npm run prebuild` также явно запускают клиентский вариант.

## Локальный запуск

Из каталога `mobile`:

```powershell
npm run start:client
npm run android:client
```

Для приложения водителя:

```powershell
npm run start:driver
npm run android:driver
```

Metro и нативную команду одного запуска нужно открывать с одинаковым вариантом. Одновременно держать клиентский и водительский Metro на одном порту нельзя. На Android оба приложения устанавливаются рядом, потому что Gradle также получает `APP_VARIANT` и меняет `applicationId`, название и deep-link scheme.

Локальные `npm run android:*` debug-сборки включают `arm64-v8a` и `x86_64`, поэтому один APK запускается на современном телефоне и x86_64-эмуляторе. `--variant release` и EAS-сборки сохраняют телефонный `arm64-v8a`; явно заданное `ORG_GRADLE_PROJECT_reactNativeArchitectures` имеет приоритет.

Локальные команды запускаются в development-режиме, даже если рабочий `.env` настроен для release-сборки. При необходимости production-режим можно задать явно через переменную окружения; EAS-профили уже задают его самостоятельно.

Для iOS доступны `npm run ios:client` и `npm run ios:driver`. Локальный iOS build требует macOS; EAS использует соответствующий bundle identifier из `app.config.ts`.

## EAS build

Профили описаны в `mobile/eas.json`:

```powershell
npm run build:android:client:preview
npm run build:android:driver:preview
npm run build:android:client:apk
npm run build:android:driver:apk
npm run build:android:client
npm run build:android:driver
npm run build:ios:client
npm run build:ios:driver
```

Профили `apk-client` и `apk-driver` создают устанавливаемые production APK. Профили `production-client` и `production-driver` создают AAB для Google Play.

Можно вызвать EAS напрямую, например `eas build --platform ios --profile preview-driver`. Профили `preview` и `production` сохранены как клиентские для обратной совместимости.

## EAS и Firebase

Клиент продолжает использовать существующий `EXPO_PUBLIC_EAS_PROJECT_ID` и `mobile/google-services.json`. При желании его можно явно переопределить:

- `EXPO_PUBLIC_CLIENT_EAS_PROJECT_ID`;
- `CLIENT_GOOGLE_SERVICES_FILE`.

Для водительского приложения настроены отдельные облачные ресурсы:

- `EXPO_PUBLIC_DRIVER_EAS_PROJECT_ID` — необязательное переопределение UUID отдельного EAS project; по умолчанию уже используется `c9056e00-5a97-482f-b121-75840b31d24e`;
- Firebase project `taxi-go-driver-kg` с Android package `atlas.pro`;
- `DRIVER_GOOGLE_SERVICES_FILE` — защищённый EAS-файл конфигурации Firebase;
- отдельный Android keystore и ключ FCM V1 для push-уведомлений.

Локальный резервный путь для водительского Firebase-файла — `mobile/google-services.driver.json`. Оба Firebase-файла исключены из Git. В новой локальной копии репозитория этот файл нужно получить из Firebase либо запустить сборку через уже настроенный EAS environment. Production driver build останавливается с понятной ошибкой, если Firebase-файл недоступен. Development-сборку без Firebase создать можно, но удалённые push-уведомления в ней недоступны.

Для iOS водительское приложение также нужно зарегистрировать в Apple Developer и Firebase с bundle id `kg.taxigo.driver` перед подписанной production-сборкой.

## Защита от входа не в то приложение

Проверка выполняется до загрузки пользовательского интерфейса при восстановлении сессии, при фоновой синхронизации и после подтверждения SMS-кода. Клиентский бинарник допускает только `CLIENT`, водительский — только `DRIVER`. Неподходящие токены и сохранённый идентификатор заказа очищаются; кнопка «Войти снова» позволяет подтвердить тот же номер в нужном приложении.

С версии 1.2.26 оба запроса `/auth/request-code` и `/auth/verify-code` передают `appVariant: client | driver`. Сервер привязывает код к выбранному приложению и хранит отдельные UUID аккаунтов по уникальной паре `(phone, role)`. Один номер может одновременно использовать клиентское и водительское приложения. Существующие UUID и связи поездок сохраняются; старые водительские APK без `appVariant` нужно обновить перед повторным входом.

Новый клиент после подтверждения номера заполняет имя и фамилию. Пара `firstName` + `lastName` сохраняется через `/users/me`, а `name` содержит их полную запись для профиля и поездок. Незаполненный экран восстанавливается после перезапуска; ранее сохранённые полные имена сохраняются без автоматического разделения. Новый аккаунт водителя сразу получает роль `DRIVER` и заполняет анкету исполнителя в своём приложении.

Проверка конфигурации и role gate:

```powershell
npm run test:variant
npm run typecheck
```

## Android packages from 1.2.10

Client: `atlas.kg`; driver: `atlas.pro`. iOS bundle identifiers and deep links are unchanged. New Android IDs install as separate applications; accounts and server data remain, but users sign in again. Register both Android apps in their existing Firebase projects and refresh local files and EAS file variables before building. Old Firebase registrations remain for previously installed APKs.

Directly signed APK app hashes with the current signing certificate:

| App | Package | 11-character signing hash |
| --- | --- | --- |
| Atlas | atlas.kg | AhDnRV8wj+C |
| Atlas pro | atlas.pro | zpsXs/K48RO |

These hashes identify the package plus signing certificate; Play App Signing needs hashes calculated from the Play signing certificate instead. From 1.2.11 both Android apps implement zero-tap reception and the one-tap fallback through the official WhatsApp SDK. See MESSAGGIO.md for template activation.
