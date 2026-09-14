# Карты Taxi GO в Railway

Проект: `taxi-go`, окружение `production`. Геоданные — Кыргызстан, снимок Geofabrik от сентября 2026. Серверы маршрутов и адресов доступны API через приватную сеть; публичные домены им не нужны.

| Сервис | Назначение | Постоянное хранилище |
|---|---|---|
| `osrm` | Автомобильные маршруты и манёвры, MLD | `/data`: PBF, граф и маркер успешной подготовки |
| `nominatim` | Поиск адресов и адрес выбранной точки | `/var/lib/postgresql/16/main`: `data` с PostgreSQL и `project` с настройками/токенизатором |
| `photon` | Быстрые подсказки по неполному названию и с опечатками | `/data/index-v1`: индекс Кыргызстана, исходный дамп и маркер успешного импорта |
| `api` | Авторизация, котировки, ограничение запросов | Существующая PostgreSQL Taxi GO |

В Railway для `api` используются:

```dotenv
ROUTING_PROVIDER=osrm
OSRM_BASE_URL=http://osrm.railway.internal:8080
NOMINATIM_BASE_URL=http://nominatim.railway.internal:8080
NOMINATIM_USER_AGENT=TaxiGO/1.0 (https://api-production-3839.up.railway.app)
NOMINATIM_MIN_INTERVAL_MS=1000
PHOTON_BASE_URL=http://photon.railway.internal:8080
```

Railway задаёт `PORT=8080`. Геосервисы слушают IPv6. Для Nominatim также заданы `RAILWAY_RUN_UID=0` и отдельный случайный `NOMINATIM_PASSWORD` в закрытых переменных сервиса. Shell tracing отключён, чтобы пароль не попадал в журналы.

Обновление кода из корня репозитория после подключения Railway CLI к проекту:

```powershell
railway up deploy/osrm --path-as-root --service osrm --detach
railway up deploy/nominatim --path-as-root --service nominatim --detach
railway up deploy/photon --path-as-root --service photon --detach
railway up server --path-as-root --service api --detach
```

Сначала дождитесь работоспособности геосервисов. Проверяйте приватные адреса из контейнера API: OSRM `/route/v1/driving/74.6001,42.8743;74.5866,42.8704?steps=true&geometries=geojson`, Nominatim `/status?format=json`, `/search?q=Бишкек&format=jsonv2` и `/reverse?lat=42.8743&lon=74.6001&format=jsonv2`. Публичная проверка приложения — `/api/health`, затем авторизованные `/api/routes` и `/api/places/search`.

Перезапуск и обновление контейнера сохраняют импорт. Не удаляйте volumes. OSRM ежедневно проверяет новый PBF Кыргызстана: сначала у Geofabrik через включённый в Railway исходящий IPv6, при недоступности — у BBBike. Он сравнивает SHA-256, готовит второй граф на том же volume, проверяет его перед переключением и возвращает прежний при неудачной проверке маршрута. Первый снимок проверяется сразу после запуска, следующие — через 86400 секунд после завершения предыдущей проверки. `MAP_UPDATE_INTERVAL_SECONDS=604800` переключит OSRM и Photon на недельную проверку в будущем. Перед изменениями API делайте резервную копию основной PostgreSQL. Откат API выполняется к предыдущему успешному deployment вместе с прежними значениями переменных маршрутизации.

Для Nominatim включены исходящие IPv6-соединения в Railway и штатная репликация из `kyrgyzstan-updates` Geofabrik. `REPLICATION_UPDATE_INTERVAL=86400` задаёт суточный интервал. Эти же настройки есть в Dockerfile и переменных production. При переходе на недельный интервал измените значение на `604800`. Без исходящего IPv6 Railway не достигает Geofabrik, и Nominatim завершается при запуске; перед выключением IPv6 сначала отключите репликацию.

Photon 1.3.0 использует собственный встроенный OpenSearch, Java 21 и heap до 768 МБ. JAR закреплён SHA-256. Перед первым запуском присоедините к сервису постоянный volume на `/data` (в Railway выделено 5 ГБ); приложение хранит данные в подкаталоге `/data/index-v1`, новые версии — в `/data/indices`. Первый запуск импортирует только `kg` из JSON-дампа Central Asia GraphHopper с языками `ru,ky,en`. Это отдельный снимок данных, а не прямое чтение нашей Nominatim PostgreSQL. Ежедневная проверка скачивает опубликованный дамп и сравнивает SHA-256. При изменении Photon готовит второй индекс, проверяет `/status` и только тогда переключается. Фактическая свежесть ограничена датой публикации дампа GraphHopper. При заданном `PHOTON_BASE_URL` текстовый поиск полностью идёт в Photon, без секундной очереди Nominatim; обратное геокодирование остаётся в Nominatim. Пустое значение возвращает прежний способ поиска для отката. Внутренний порт Photon не публикуется в Интернет.

Тайлы изображения карты сейчас загружаются с `tile.openstreetmap.org`, с атрибуцией и идентификатором приложения. Это отдельный сервис: для роста нагрузки замените `EXPO_PUBLIC_OSM_TILE_URL` на выделенный источник и пересоберите APK. OSRM/Nominatim уже свои, но вычисления и диски Railway тарифицируются. Эта установка не предоставляет пробки или оперативные перекрытия.

Актуальные Android APK: `artifacts/EduGO-Client.apk` и `artifacts/EduDrive-Driver.apk`. Они содержат встроенный JavaScript и адрес рабочего API, собраны для телефонов ARM64 и подписаны существующим локальным ключом проекта. Это самостоятельные установочные сборки для прямой установки, не публикация в Google Play. Приложения имеют разные package IDs и могут устанавливаться одновременно. Выпуск в App Store и iOS-сборка требуют отдельной подписи Apple.
