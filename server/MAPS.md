# Собственные OSRM и Nominatim для Кыргызстана

В корне проекта есть `docker-compose.maps.yml`: автомобильные маршруты OSRM MLD и поиск/обратный поиск адресов Nominatim. Они используют одну выгрузку OpenStreetMap Кыргызстана. Серверы тайлов эта конфигурация не поднимает; карту мобильного приложения нужно настраивать отдельно.

Рабочие сервисы уже развёрнуты в Railway и подключены к API. Там текстовый поиск выполняет отдельный Photon с поддержкой опечаток, а Nominatim используется для адреса по метке. Их конфигурация и обслуживание описаны в [deploy/README.md](../deploy/README.md). Ниже — альтернативный локальный запуск OSRM и Nominatim; без `PHOTON_BASE_URL` текстовый поиск использует Nominatim. Nominatim использует обёртку из `deploy/nominatim`: секреты не трассируются, PostgreSQL и каталог проекта сохраняются вместе в volume.

Публичный Nominatim не встроен в приложение. Его [правила](https://operations.osmfoundation.org/policies/nominatim/) запрещают автоматическую генерацию универсального сервиса поиска без осознанного выбора разработчика и ограничивают приложения отслеживания транспорта. Используйте свою установку ниже либо совместимого поставщика. Публичный OSRM подходит только для разработки: в production приложение требует отдельный адрес сервиса.

## Первый запуск

Нужен Docker с Linux containers и Docker Compose v2. Импорт расходует несколько гигабайт диска и памяти; оставьте место для исходного PBF, индексов маршрутов и PostgreSQL. Подбирайте ресурсы по фактическому импорту и нагрузке. Команды ниже выполняются из корня проекта. Это инструкции запуска: большие образы и данные автоматически при изменении кода не скачиваются.

1. Добавьте отдельный случайный `NOMINATIM_PASSWORD` в корневой `.env` (он уже исключён из Git). Не используйте пароли приложения или основной БД. Пароль нужен только внутренней БД геокодера; порт PostgreSQL наружу не публикуется.
2. Скачайте [выгрузку Кыргызстана Geofabrik](https://download.geofabrik.de/asia/kyrgyzstan.html). PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path .local/maps | Out-Null
Invoke-WebRequest -Uri https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf -OutFile .local/maps/kyrgyzstan.osm.pbf
```

Для Linux:

```sh
mkdir -p .local/maps
curl --fail --location --retry 3 https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf --output .local/maps/kyrgyzstan.osm.pbf
```

3. Последовательно подготовьте дорожный граф. Дождитесь успешного завершения каждой команды; при ошибке следующую не запускайте:

```sh
docker compose -f docker-compose.maps.yml --profile init run --rm osrm-extract
docker compose -f docker-compose.maps.yml --profile init run --rm osrm-partition
docker compose -f docker-compose.maps.yml --profile init run --rm osrm-customize
docker compose -f docker-compose.maps.yml up -d osrm nominatim
docker compose -f docker-compose.maps.yml logs -f nominatim
```

Nominatim импортирует PBF при первом запуске. Дождитесь строки `Nominatim is ready to accept requests`; до неё адресный поиск недоступен. Выход из просмотра логов через Ctrl+C не останавливает контейнер. Повторный запуск использует постоянный volume и не импортирует данные заново.

4. Для Nest API, работающего на этом же хосте, задайте в его окружении:

```dotenv
ROUTING_PROVIDER=osrm
OSRM_BASE_URL=http://127.0.0.1:5000
NOMINATIM_BASE_URL=http://127.0.0.1:8088
NOMINATIM_USER_AGENT=TaxiGO/1.0 (your real support contact)
NOMINATIM_MIN_INTERVAL_MS=1000
```

Перезапустите API. Если Nest запущен внутри Docker Desktop, вместо `127.0.0.1` нужен доступный ему адрес хоста; для одной Docker-сети используйте DNS-имена сервисов `osrm:5000` и `nominatim:8080`, предварительно подключив API к сети `taxi-maps_default`. Мобильные приложения обращаются только к Nest API: внутренние адреса OSRM/Nominatim в приложение не передаются.

## Проверка

PowerShell, после окончания импорта:

```powershell
Invoke-RestMethod 'http://127.0.0.1:5000/route/v1/driving/74.604,42.8756;74.584,42.8528?steps=true&geometries=geojson&overview=full'
Invoke-RestMethod 'http://127.0.0.1:8088/search?q=Bishkek&format=jsonv2&limit=1'
Invoke-RestMethod 'http://127.0.0.1:8088/reverse?lat=42.8756&lon=74.604&format=jsonv2'
```

Маршрутизатор должен вернуть `code: Ok`, геометрию и манёвры. Поиск должен вернуть непустой массив, reverse — `display_name`. Затем проверьте авторизованный `POST /api/routes` и поиск адреса в обеих сборках приложения. Ошибки провайдера возвращают 503, без фиктивного маршрута или выдуманного адреса.

## Хранение и обновления

Индексы OSRM лежат в `.local/maps`, база Nominatim — в Docker volume `taxi-maps_nominatim-data`. `docker compose down` сохраняет данные; `down -v` удаляет базу и требует полного импорта. Не удаляйте volume для обычного перезапуска. Порты опубликованы только на loopback: не открывайте геосервисы в Интернет без собственного прокси и ограничений доступа.

Эта конфигурация использует снимок данных. Обновления дорог не загружаются автоматически: новый PBF и граф OSRM готовьте отдельно, затем переключайте сервис после проверки. Для обновления Nominatim без повторного импорта настройте replication по [инструкции образа](https://github.com/mediagis/nominatim-docker/blob/master/howto.md#updating-the-database); не подменяйте регион или версию PostgreSQL в существующем volume. Перед обновлениями сделайте резервную копию БД. Пробки и живые перекрытия данная установка OSRM не учитывает.

Образы закреплены версиями и SHA-256 digest, проверенными в реестрах: OSRM `26.9.0-debian`, Nominatim `5.3`. MLD-последовательность следует [официальной инструкции OSRM](https://github.com/Project-OSRM/osrm-backend#quick-start), путь постоянной БД и параметры импорта — [инструкции Nominatim Docker](https://github.com/mediagis/nominatim-docker/blob/master/howto.md). Перед сменой версий повторите проверку импорта и API на отдельном наборе данных.
