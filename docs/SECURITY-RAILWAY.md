# Проверка действующего Railway DEV и кандидата — 13 октября 2026

Это актуальное дополнение к первоначальному локальному аудиту. Время доказательств указано в UTC; местная зона — Asia/Bishkek (UTC+6). Исторические локальные результаты в остальных отчётах не означают проверку действующего развёртывания.

Пользователь подтвердил, что Railway сейчас используется как **DEV**, и разрешил серверные испытания. В интерфейсе Railway единственное окружение технически называется `production`; название не менялось и не означает разрешение на production-выпуск. Проект `taxi-go`, ID `d7177395-a6c2-4939-959d-2535d87b28e2`; окружение `cd8887c6-93d7-4a95-b935-3c319f516fa8`.

## Что действительно сделано на сервере

Прочитаны свежие метаданные Railway, конфигурация, версии бинарников, схема/счётчики БД, состояние резервирования и расход ресурсов. Для активных испытаний внутри API-контейнера создавались отдельные процессы кандидата и новая временная БД `taxi_security_test`. До создания проверялось отсутствие БД, устанавливался маркер владения конкретного запуска; удаление разрешалось только при совпадении маркера. Защита тестового reset не ослаблялась: использовался собственный числовой loopback TCP relay к приватному PostgreSQL.

Тестовый код не записывал в рабочую БД/таблицы и не менял аккаунты, коды, роли, действительные сессии и APK. Deployments, ресурсы, сеть и резервирование Railway не изменялись. Создание/миграции/удаление временной БД изменяют системный каталог/WAL и расход общего PG-экземпляра; это разрешённая DEV-нагрузка, а не отсутствие любого воздействия на сервер. Тестовые JWT/OTP, пользователи и заказы синтетические. SMS, push, платежи и реальные геокодеры в нагрузке заменены заглушками. Публичный API получил только ограниченные health/read/preflight/неавторизованные запросы и проверку отклонения неверного Socket.IO токена.

Для SSH был зарегистрирован отдельный временный ключ аудита — это временное изменение реестра доступа аккаунта. Его закрытая часть и значения переменных окружения в отчёт не включаются. Состояние очистки и отзыва ключа фиксируется в завершении проверки.

## Фактическое развёртывание

Инвентаризация: 2026-10-12 21:35–22:12 UTC; deployment IDs повторно прочитаны 2026-10-13 **00:08:51–52 UTC**, без изменений. Native backup metadata повторно прочитаны **23:31:05 UTC**, также пусто. Все шесть сервисов имеют одну реплику, регион `europe-west4-drams3a`, sleep выключен, restart `ON_FAILURE`, максимум 10 повторов. Прочитанный лимит каждого контейнера: **8 CPU, 8 000 000 000 bytes RAM, 1000 PID**. Это верхние пределы, а не постоянное потребление или зарезервированный оплачиваемый объём.

| Сервис | Текущий deployment ID | Реально установленное ПО / способ запуска |
|---|---|---|
| API | `74580d39-4dcd-441a-960f-c067fa4dc75d` | Node **22.23.3**, `NODE_ENV=development`, порт 8080; Dockerfile.railway, `npm run start:migrate` → Prisma migrate deploy → `node dist/src/main.js`; health `/api/health` |
| website | `872e35c2-d148-46e4-8321-f79997ec1d2a` | nginx **1.30.5**, Dockerfile, порт 8080; health `/healthz` |
| PostgreSQL | `3e6fdb61-7339-4f9c-8da6-273e690c274b` | **18.6**, образ `ghcr.io/railwayapp-templates/postgres-ssl:18` |
| Nominatim | `592898f7-e072-4a96-b722-34dba26fba74` | CLI **5.3.2**, серверный бинарник PostgreSQL **16.14**; live SQL-версия внутренней БД не запрашивалась |
| OSRM | `7db040f9-592f-4c76-9281-eb0d37c22dc6` | `osrm-routed --version`: **v26.9.0** |
| Photon | `5bc10961-b18c-4dc9-96e7-62b4128e223f` | Java Temurin **21.0.12+8 LTS**; версия самого Photon и индекса не подтверждена |

API image digest: `sha256:e6126f7e676255f4626c24d73c87fcf4fe1cba8f82a68897a0c2b9defb614d36`. Образ действующего сервиса в ходе испытаний не заменялся. Сохранены image digest всех сервисов и их build/start/health metadata; отсутствие отдельного buildCommand при Dockerfile не трактуется как отсутствие сборки. Сохранённый API Dockerfile использует Node 22 bookworm, `npm ci`, Prisma generate, TypeScript build и prune dev-зависимостей.

Публичные домены: `https://api-production-47be.up.railway.app` и `https://atlas-app.up.railway.app`, оба на target 8080. Custom domains нет. У БД и карт публичных HTTP-доменов нет; TCP proxies отсутствуют у всех шести сервисов. В окружении одна private network. API обращается к `postgres.railway.internal:5432`, OSRM/Photon/Nominatim — по private Railway DNS на 8080.

| Volume | Mount | Прочитанный размер / лимит | Native snapshots / schedules |
|---|---|---|---|
| PostgreSQL | `/var/lib/postgresql/data` | 261,06 / 5000 MB | пусто / пусто |
| Nominatim | `/var/lib/postgresql/16/main` | 2258,31 / 5000 MB | пусто / пусто |
| OSRM | `/data` | 368,76 / 5000 MB | пусто / пусто |
| Photon | `/data` | 808,76 / 5000 MB | пусто / пусто |

В корне PG volume найдены пять файлов с расширением dump, последний по имени датирован 8 октября. Их содержимое, самостоятельная копия, подлинность и восстановление **не проверены**. Пустые native schedules не доказывают отсутствие всех внешних резервных копий. `archive_mode=off`, `wal_level=replica`: PITR по этой конфигурации не подтверждён. Настройки резервирования не менялись.

Основной PostgreSQL: `Etc/UTC`, max_connections 500, shared_buffers 128 MB, work_mem 4 MB; SSL включён, проверенная API-сессия использует TLS. Текущий API подключается ролью `postgres` с **SUPERUSER=true**. Переход на отдельные migration/runtime роли требует согласованного изменения и проверки прав; автоматически роли не менялись.

Рабочая схема: 33 таблицы, 332 колонки, 29 применённых миграций; новых outbox/browser-session полей в ней ещё нет. Все 29 migration-файлов кандидата совпадают с текущим контейнером. 28 checksum совпали для LF, одна историческая миграция — для CRLF-варианта; это не изменение SQL. Историческая неудачная миграция имеет rolled-back запись и отдельное успешное применение; незавершённого failed migration по прочитанным метаданным нет.

## Происхождение кода и сохранность функций

Лог ранее сохранённой CLI-загрузки содержит именно текущие project/service/deployment ID API. Сохранённые package/schema/миграции совпали с контейнером побайтно (32/32 файлов). Повторно скомпилированный сохранённый сервер совпал с действующим контейнером: **60/60 JavaScript и 60/60 source maps**. Исходный API baseline зафиксирован отдельным commit `9b2a986e73ac86e4f74cf1e7c2d3225fe26fa7b2` до security-изменений.

Это подтверждает происхождение прикладного API-кода из сохранённой CLI-сборки. Это **не** commit attestation всей Docker-сборки: Git SHA в deployment metadata отсутствует, воспроизводимость полного образа и hosted CI для кандидата ещё не установлены. Текущий `main` не использован как доказательство тождества действующему релизу.

В действующем OpenAPI прочитано 108 путей, включая такси/котировки/статусы/чат/фото/location/рейтинги, food multi-order и ресторанный workspace, города, профили, OTP, уведомления, удаление данных и admin. Это инвентаризация интерфейса, не проверка каждого бизнес-сценария действующими аккаунтами.

**Отдельная блокировка мобильного выпуска:** website manifest указывает client/driver APK **1.2.08** arm64-v8a (94 588 630 /94 588 674 bytes). SHA-256/размеры manifest совпали с прочитанными файлами контейнера; встроенный AndroidManifest и подпись APK не исследованы. Mobile app.config/native исходники в `main` — **1.0.9/code10**, в исходном рабочем checkout — **1.2.21/code133**. Исходный commit, signing/build pipeline и полнота функций опубликованных APK не установлены. Нельзя выпускать mobile из `main` или заменять существующие downloads этим кандидатом до сопоставления исходников. Существующие APK не трогались; в будущую сборку сайта нужно явно сохранить файлы и manifest downloads.

Store-review allowlist проверен без вывода телефонов/кодов: три разных настроенных аккаунта, все существуют и активны, два CLIENT и один DRIVER, ADMIN/deleted/missing — 0. Сам сценарий реального входа не запускался. Проверки точной границы исключения и прав проходят на синтетических fixture-аккаунтах. Существующие телефоны, коды и роли не изменялись.

## Какие проверки действительно выполнены

| Окружение / кандидат | Запущенная проверка | Результат и предел доказательства |
|---|---|---|
| Действующий Railway DEV, прежний deployment | HTTPS health/read/OpenAPI/preflight, неверный Bearer и Socket.IO токен | Все 10 проверенных HTTP status совпали; неверный Socket.IO токен получил session:expired и disconnect без session:ready. Новые cookie endpoints 404, поскольку кандидат ещё не развёрнут |
| Railway API Node 22.23.3, отдельная временная БД | npm ci, build, migrations, все обнаруженные серверные unit/integration, audit включая dev | Первый артефакт `4df892f…`: **292 unit +94 integration PASS**, skipped/cancelled/todo 0; build/migrations PASS; audit 0 high/critical, 8 moderate |
| Railway, первый артефакт, k6 Linux 1.6.1 + реальные Socket.IO соединения | 50 → 100 → 250 → 500 пользователей, по 120 s каждый | 50/100/250 PASS; 500 FAIL по read p95 505,84 ms при строгом `<500 ms`. Лестница остановлена; 1000 и peak2x в этом запуске не выполнялись |
| Railway, вторая фаза / commit `cc4ab2fb67c75d5ff8f276f81e347ad01a04e1f2` | Полный повтор для catalog single-flight | **299 unit +94 integration PASS**, skipped/cancelled/todo 0; npm ci/build/migrations/audit PASS, 0 high/critical и 8 moderate; временная БД удалена. Последующая нагрузка оценивается отдельно ниже |
| Railway, окончательный server artifact / `fe3bf679` | Unit, настоящие PG18 integration, build/migrations/high audit | **311 unit +96 integration PASS**, без пропусков/отмен; 8 moderate предупреждений остаются |
| Railway, окончательный server/harness artifact | 50/100/250/500/1000/1000 peak2x, неизменённые gates | **6/6 PASS**, 1160 уникальных завершённых заказов/580 комиссий; ограничения задержек и общего cgroup ниже |
| Railway Node22, mobile/restaurant/admin source job | Functional suites и typechecks | **313 mobile /67 restaurant /32 admin executions PASS**; оба native dependency audit FAILED, APK/устройства не проверены |
| Railway Node22, website source `649103c`, clean attempt 3 | Release tests, strict build, audit с dev-зависимостями | **24 release tests PASS**, build/audit PASS; сохранение APK bytes/pin подтверждено, Docker image/полный CI не проверены |
| Локальные Windows checks ранее | mobile/admin/restaurant typecheck, тесты, Hermes exports; synthetic restore/rollback | Только вспомогательное историческое доказательство, не проверка Railway ingress, APK/IPA, устройства или независимого восстановления инфраструктуры |

В первом запуске commit в упаковке был baseline, исходники ещё не были закоммичены; **его точная идентичность — полный файловый SHA-256 manifest**, а не заявление о CI baseline commit. Во втором запуске серверный manifest привязан к уже закоммиченному `cc4ab2f`. Временный адаптер идентификации проверяет server/harness manifest; исходные repo CI guards не изменены. Это не полная проверка Git checkout, web/native-приложений и контейнерного артефакта.

Первый server artifact: `sha256:4df892f4786263962966497a665dbcdd0666e176e942363204db61f7f7d0d46a`; второй: `sha256:fed5d5c27997c3c7f9492246f9584f9fec9662318f66ff044b83ec08c707d9be`. Harness artifact: `sha256:158a55587eaf2f1c4f573be235211e547fdd22782c728b7793e32114332f594d`. Изначальные evidence не перезаписаны.

## Что означает провал 500

Зафиксированный профиль каждого измеренного baseline: **120 s** (60 s оформления +60 s drain), 80% клиентов /15% водителей /5% ресторанов, food/taxi 50/50. Client foreground sync каждые 12 s, GPS 5 s, offers 12 s, restaurant orders 10 s, catalog 60 s, принудительный Socket.IO reconnect на 60-й секунде. Booking rate соответствует одному оформлению на клиента за 120 s; план 500 — 200 уникальных завершённых заказов. Peak2x удваивает только foreground polling/GPS, без увеличения booking budget/пользователей/ресурсов/сокращения drain. Общий синтетический seed содержит 800 клиентов, 150 водителей и 50 ресторанов; каждая ступень использует свой фиксированный набор actor identities и уникальные request IDs.

За первый Railway500: **12 960 API-запросов, 104,72 RPS, 200 уникальных заказов оформлены/приняты/завершены, 100 комиссий**. HTTP 5xx/429/transport errors/timeouts/dropped iterations — 0. Socket.IO: 475 ready, 475 принудительных reconnect, 950 canonical sync; errors — 0. Порог не менялся: read p95 **505,8402749 ms**, FAIL.

По операциям p95: quote 98,48 ms, create 288,69, retry 83,85, accept 322,00, process 359,23, GPS 153,03. Каталог отдельно 1055 ms, driver offers 1478 ms, active order 512 ms. Все 532 чтения дольше 500 ms сосредоточены в первых 0–3 s и в 61–64 s после reconnect. Поздний каталог: p95 256 ms и 0 чтений ≥500 ms; поздние order/process задержки остаются отдельной проблемой. Raw-потоки четырёх ролей скачаны и проверены SHA-256; взвешенная p95 независимо пересчитана. Подробности: [SECURITY-LOAD-DIAGNOSIS.md](SECURITY-LOAD-DIAGNOSIS.md).

Кандидат и четыре k6-процесса/Socket.IO генератор делили один API cgroup с действующим приложением. PostgreSQL в отдельном cgroup, но экземпляр общий; тестовая БД отдельная. Публичный Railway ingress, реальные карты, устройства и общая пользовательская сеть не входили в нагрузку. Значения соединений pg_stat_activity относятся ко всему экземпляру, а не только кандидату. Нельзя объявлять 500 пределом Railway.

CPU saturation в первом прогоне не подтверждено: sampled peak ~1,73 cores из 8, candidate RSS до 387 MiB, event-loop p95 до 43,9 ms. Пятисекундные samples не исключают короткий пик; SQL duration/pool wait/GC не измерены. В первой нагрузке outbox lag не измерялся. Во второй добавлен отдельный read-only outbox sampler (5 s, одно соединение); эта небольшая разница инструментирования явно отмечена в сравнении.

Исправление каталога объединяет **только незавершённые** одинаковые чтения и сериализует ответ один раз. Нет TTL/хранения завершённого результата. Legacy/v2 и development/production фильтры имеют разные ключи. Следующая волна получает свежие данные. Семь новых регрессий проверяют 100 concurrent → 1 query, разделение аудиторий, обновление меню, ошибку/retry, HTTP bytes/content-type/ETag/304 и промо. Канонические цены/модификаторы при create/retry продолжают проверяться по БД независимо от capabilities. Это исправление не объявлено доказанной причиной всех order/offer задержек.

Точная граница свежести: перекрывающиеся GET получают один снимок ещё выполняющегося DB чтения; запись, попавшая во время этого чтения, наблюдается следующей волной. Отдельная линейная свежесть каждого перекрывающегося GET не заявляется.

Для оценки ёмкости нужен отдельный согласованный staging candidate контейнер и отдельный генератор того же региона с фиксированными CPU/RAM/runtime/DB pool/данными. Повторить эту же лестницу, включая startup/reconnect, все aggregate thresholds и completed-order/ledger/WS gates, добавить SQL/pool/GC/outbox и общие Railway metrics. Только после этой проверки отдельно испытывать реальные maps и публичный ingress с установленным лимитом и аварийной остановкой. Новые ресурсы/сервисы и deployment требуют отдельного разрешения.

## HTTPS, cookie, proxy и rollback

Фактический website nginx проксирует `/api` на `api.railway.internal:8080`; Origin/Set-Cookie не удаляет. API proxy_read_timeout 90 s; Socket.IO upgrade включён и proxy_read_timeout 75 s. XFF добавляет `$proxy_add_x_forwarded_for`, XFP использует входящий `$http_x_forwarded_proto`. Кандидат admin обращается к `${window.location.origin}/api`, что соответствует same-origin схеме.

`up.railway.app` находится в [Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat); прямые вызовы между двумя Railway поддоменами — разные sites. Успешный локальный proxy-тест не доказывает cookie авторизацию на опубликованном HTTPS. На действующем API новые cookie routes ещё отсутствуют. После согласованного staging deploy требуется проверить login, reload, две вкладки, remember session, logout/revocation, CSRF/Origin и мобильный Bearer. HSTS наблюдался на API, на сайте не наблюдался. Физическая граница trusted proxy/IP и корректность anti-spoof/rate-limit на ingress не доказаны; произвольный CIDR/доверие всем headers не добавлялись.

[Официальная документация Railway](https://docs.railway.com/networking/public-networking/specs-and-limits) описывает X-Real-IP и X-Forwarded-Proto=https. Она не заменяет проверку физического доверенного peer, перезаписи spoofed header и ограничения прямого/private доступа в фактической цепочке website →API.

PostgreSQL timezone UTC подтверждён на реальном сервере; кандидат запускает UTC guard до outbox worker. Remote интеграции проверяют durable outbox, падение после DB commit, retry, повтор accept/complete и canonical reconnect. `deliveredAt` отмечает завершённую server-side попытку отправки, а не подтверждённый ACK устройства.

Ранее фактически скомпилированный старый сервер был испытан локально на новой синтетической схеме. Теперь его JS/source maps сопоставлены с действующим DEV. Обнаружено: cookie routes 404, старый refresh не различает browserSession, legacy catalog получает v2-данные, canonical required/modifier цены несовместимы. Обычный previous deployment **не является доказанно безопасным rollback**. Подробности: [ROLLBACK-VERIFICATION.md](ROLLBACK-VERIFICATION.md). Нужен совместимый forward hotfix либо заранее испытанный порядок отката схемы/данных/сессий и приложений. Рабочие сессии/данные не отзываются ради упрощения отката.

## Dependency audit

У Swagger scoped js-yaml override поднят 5.3.0 → **5.4.3** без изменения Expo/React Native/Nest/Firebase. Проверены реальный JSON/YAML OpenAPI, вложенные DTO/Unicode и regression advisory; серверный high-gate проходит. Оставшиеся восемь moderate предупреждений видимы и не объявлены закрытыми.

Мобильный high audit **остаётся блокировкой**: main mobile 22 high/17 moderate, restaurant 21 high/12 moderate. Две затронутые leaf-зависимости — braces и node-forge; опубликованного безопасного исправления на дату проверки нет. Затронуты Metro/Jest/build и Expo signing/OTA/dev paths, отсутствие пакета в JavaScript bundle не закрывает риск. Force downgrade Expo 54 →44 отклонён как небезопасный и не выполнен. Официальные advisory, дерево, допустимые альтернативы и оставшийся риск: [SECURITY-DEPENDENCIES.md](SECURITY-DEPENDENCIES.md). Audit не отключён, severity gates не ослаблены.

## Измеримый расход, а не обещанная экономия

Прочитаны Railway metrics за 24 h **2026-10-11 21:42 → 2026-10-12 21:42 UTC**, шаг/усреднение 60 s. Средняя RAM: Nominatim 0,792 GB, Photon 0,622, OSRM 0,347, PG 0,271, API 0,155, сайт 0,040; всего **2,227 GB**, карты **79,05%**. Mean CPU 0,014843 vCPU, средний volume 3,687 GB. Минутные samples могут пропустить короткие пики.

По [официальному тарифу Railway](https://docs.railway.com/pricing/plans) RAM $10/GB-month, CPU $20/vCPU-month, volume $0.15/GB-month. Экстраполяция этих 24 h — около **$23,12/month только ресурсов**. Это модель, не счёт, не гарантированный месячный расход и не экономия; не включает egress/credits/неполный billing period.

Изменения кандидата, сохраняющие функции: history SQL с 165 до 12 запросов в fixture при том же ответе; coalescing одинакового route запроса (100 concurrent →1 upstream); условное обновление карт по ETag/Last-Modified/SHA с атомарной заменой/rollback без снижения качества данных; очистка только expired session и старых доставленных событий, без удаления действительных сессий/заказов; catalog single-flight без stale cache. Карты, поиск, резервирование и бизнес-функции не отключены. **Денежная экономия пока не измерена** — изменения не стоят на действующем deployment.

До/после сравнивать одинаковые duration/profile/data/update freshness, версии контейнеров и нагрузку; фиксировать интегралы RAM GB-hours, CPU vCPU-hours, egress, volume growth и стоимость их единиц, одновременно p95/errors/429/timeouts/dropped/orders/WS/outbox. Отдельно измерять простой и окно map update. Для заявлений об экономии нужна повторяемость нескольких окон, а не один SQL benchmark. Снижение разрешённого максимума RAM/CPU само по себе не уменьшает наблюдаемое потребление.

## Реестр текущих находок

| Находка | Подозрение | Подтверждено | Исправлено | Проверено |
|---|---|---|---|---|
| API provenance | main может быть чужим релизом | CLI deployment без SHA; actual JS/maps совпали с сохранённой загрузкой | baseline commit сохранён | Прикладной API код подтверждён; полный image/CI attestation ещё нет |
| Mobile provenance | main может потерять функции APK | 1.0.9 main против опубликованного 1.2.08 | Выпуск несовпадающего mobile заблокирован | APK manifest/hash прочитаны; исходный/native build pipeline неизвестен |
| DB outage / права | logout при outage либо fail-open | Нужна свежая DB авторизация HTTP/refresh/WS | Разделены 401 и 503, sessions сохранены, protected operations denied | Remote unit/integration PASS; настоящий service DB outage не вызывался |
| Event durability | Commit без доставленного события | Старый код без durable outbox | Outbox/retry/идемпотентность/resync | Remote integration PASS; полный аварийный failover/PITR не испытан |
| Outbox capacity / lease | Ограниченная очередь восстановления; stale ACK после reclaim | 25 rows/second bottleneck, oldest age до 24,83 s | Bounded serial drain; ACK/retry fenced captured attempts | 12 новых unit +2 настоящих SQL cases; полный remote профиль PASS, peak age всё ещё 10,74 s, device ACK SLA не доказан |
| Catalog concurrent read | Startup/reconnect tail | Raw500 read p95 FAIL, catalog startup p95 1055 ms | Single-flight + одна сериализация, без TTL | 7 targeted regressions; повтор remote указан ниже, причинность всей latency не заявлена |
| Native dependency | Уязвимость в build/runtime paths | High audit остаётся | Только безопасный server YAML patch; native downgrade не выполнен | Server audit PASS; mobile high audit BLOCKED |
| Recovery | Файлы dump могут создать ложную готовность | Native snapshots/schedules пусты, restore не доказан | Подготовлен synthetic recovery инструмент/план | Только исторический локальный restore; реальный RPO/RTO не установлен |
| Ingress cookie/IP | Локальные тесты не отражают домены | Same-origin nginx есть; кандидат не опубликован | Admin proxy/cookie/CSRF и ограничение trust в коде | Необходим фактический browser/ingress staging smoke |
| Website downloads | Новый build может потерять нынешние APK | Пустая/newer WIP директория ранее меняла staged pair | Независимый immutable pin, explicit replacement, rollback и mandatory tests | Railway Node22: 24 tests/strict build/audit PASS; APK bytes сохранены, native provenance открыт |
| PID1 / cleanup | Завершённые jobs не освобождают PID slots | 237 zombies parent1, 11 известных audit jobs stateZ | Причина/исправление supervisor не установлены; restart не выполнялся | Нет активных owned jobs, dirs/DB удалены; parent reaping или контролируемый restart и resync требуют согласования |
| Стоимость | SQL improvement может не снизить счёт | Карты дают 79% sampled RAM | Без отключения функций подготовлены coalescing/update/cleanup | Semantics проверены; actual денежная экономия не измерена |

## План восстановления и ограничения доступа

Нужен независимый комплект: PG18 dump либо проверенный PITR/volume backup, все необходимые API files (или доказательство их хранения в БД), website APK/manifest/static assets, map volumes/воспроизводимый источник/версии, конфигурация и secrets references, signing keys, container digests и network/domain settings. Ключ восстановления и backup должны переживать потерю этого workspace/сервиса и не храниться единственной копией рядом с БД. Пользовательские данные и секреты в отчёт/репозиторий не выгружаются.

Согласованный rehearsal: создать отдельные restore target DB/volumes/services, восстановить комплект, применить совместимую схему, запустить именно candidate image, проверить реальные приложения/авторизацию/тестовые аккаунты/заказы/события/maps/файлы; замерить время от начала аварии до доступности функций и возраст последней восстановленной подтверждённой записи. Нужны также схема rollback с новыми cookie/v2-данными и проверка повторной синхронизации. Наличие скрипта копирования не подтверждает RPO/RTO.

Доступ Railway CLI/API/SSH к перечисленным сервисам имеется. Не подтверждены независимое хранилище резервных копий и ключей, исходники/signing pipeline публичных APK, native devices/IPA, full hosted CI и candidate Docker image attestation. Существующие manual dumps не читались и не восстанавливались. Для отдельного staging окружения и генератора нужны согласованные ресурсы.

## Отдельные заключения

**Готовность к согласованным staging-испытаниям:** ограниченный синтетический DEV профиль кандидата завершён на Railway: шесть ступеней нагрузки и перечисленные серверные/app-source/web проверки приняты в своих границах. Полный shared/native кандидат не принят: сохраняются mobile high audit, APK provenance, ingress-cookie/IP, restore и full candidate CI. Переход к отдельному deploy/integrated staging требует конкретного согласования и сохранения нынешних APK/данных. Перед следующими длительными испытаниями необходимо решить PID1 cleanup и вынести генератор из обслуживающего API-контейнера.

**Готовность к production:** **НЕ ГОТОВО**. Серверные тесты не снимают блокировки происхождения APK/полного image, mobile dependency audit, безопасного rollback/recovery, измеренного RPO/RTO, реальных cookie/proxy/устройств/providers и CI именно публикуемого commit/артефакта. Также остаются outbox backlog до 10,74 s, отдельные endpoint tails, broad superuser runtime DB role и unreaped audit jobs у PID 1. Failed/skipped/cancelled обязательный check блокирует выпуск; Railway Wait for CI не является самостоятельным доказательством.

Отдельного разрешения требуют: staging/DEV/production deployment или перезапуск используемого DEV API; миграции рабочей схемы или роли БД; создание/изменение платных ресурсов, DNS/private/public networking, доменов и backup/PITR schedules; выгрузка/восстановление рабочих данных в отдельный rehearsal и реальные платные/provider сценарии. Ограниченные синтетические тесты уже разрешены и не требуют повторного вопроса.

## Завершение второй фазы и очистка

Второй серверный прогон завершён 2026-10-12 **22:45:45 UTC**. Его общий статус **FAILED**, поскольку обязательная ступень 1000 не завершена. Результаты успешных меньших ступеней не подменяют этот итог.

| Уровень | Read p95, ms | Завершённые уникальные заказы | Комиссии | Итог |
|---|---:|---:|---:|---|
| 50 | 60,99 | 20 | 10 | PASS |
| 100 | 58,14 | 40 | 20 | PASS |
| 250 | 89,59 | 100 | 50 | PASS |
| 500 | **193,79** | 200 | 100 | PASS |
| 1000 | не измерено | нет итоговой проверки | нет итоговой проверки | Защитная остановка до завершения startup; FAIL / incomplete |
| 1000 peak2x | не выполнялось | не измерено | не измерено | NOT RUN / блокировка принятия полной лестницы |

На 500: 12 960 запросов, unexpected responses/429/timeouts/dropped iterations 0; Socket.IO 475 ready +475 reconnect +950 canonical resync, ошибок нет. Все четыре raw-потока получены, SHA-256 и точные счётчики независимо проверены. Каталог p95 **84,13 ms**, offers **104,65 ms**. Обработка не стала быстрее по всем путям: aggregate process p95 **437,16 ms** против первого 359,23; taxi arrive 710,27 ms, start 516,54 ms. Все 21 process ≥500 ms сосредоточены в волне 60–70 s. Это остаётся предметом диагностики.

Outbox sampler зафиксировал максимум **139 pending**, oldest **5,149392 s**, финальный sampled pending 0, failed samples 0. Пятисекундный sampler не доказывает отсутствие более короткого/долгого пика между samples и не является ACK устройств. Candidate RSS на 500 до **376,8 MiB**, общий API cgroup до **5700,6 MiB**.

На старте 1000 в 22:45:45.638 UTC общий cgroup достиг **7 944 978 432 bytes**, выше объявленного тестового бюджета 6 GB; существующий API health 200/3 ms. Контроллер вызвал stopChildren; child завершился SIGKILL через 17 ms. Итогового 1000-run-evidence нет — HTTP/заказы/WS для этой ступени не считаются принятыми. После остановки: owned processes 0, memory.current ~697 MB, `oom=0`, `oom_kill=0`. Это **не доказательство OOM или предела Railway**.

В генераторе подтверждено избыточное копирование: SharedArray оборачивал весь fixture одним элементом и `[0]` копировал его в каждую VU; полный текст также удерживался вне callback. Это соответствует описанным [ограничениям k6 SharedArray](https://grafana.com/docs/k6/latest/javascript-api/k6-data/sharedarray/). В отдельном commit **`ff384877f01a85a8dc42ec4e8a59efd5a27ed8bf`** введены массивы отдельных actor elements, ограниченная metadata и чтение/проверка SHA внутри callbacks. Квоты/профиль/таймауты/проверки исхода и SLO не ослаблены. Все **35 ops tests PASS** локально (Node 24.19), фактический локальный k6 storage-only probe всех четырёх ролей также PASS; эти проверки не считаются Railway capacity proof.

Серверная упаковка третьей фазы привязана к `ff38487`; API-файлы имеют **тот же fed5d5c…9be manifest**, без новых изменений backend. На Railway повторно прошли 299 unit +94 integration, build/migrations/audit; temporary DB cleaned. Итог нагрузки по отдельному manifest приведён ниже в третьей фазе. Проверки приложений: functional PASS / audit FAILED, подробности ниже.

Изначальный checkout на этом этапе повторно проверен 22:38:45 UTC: 1622 позиции, 181 исходное отсутствие, source mismatches 0, исходные HEAD и git status byte-identical. Финальная очистка временных каталогов/доступа и ограничения runtime описаны в завершении отчёта.

## Отдельные проверяемые commits

MAIN `codex/security-main`:

| Commit | Состав |
|---|---|
| `9b2a986` | Сохранённый API baseline, сопоставленный с действующим контейнером |
| `c5c18f1` | Session access, outage/authorization, canonical orders, durable outbox, безопасный YAML override и регрессии |
| `1074779` | Mobile catalog/auth compatibility и admin browser cookie flow/static assets |
| `9b6f077` | Cost-preserving map updates, load/recovery tools и строгие CI gates |
| `cc4ab2f` | Catalog single-flight/одна JSON сериализация и семь регрессий |
| `ff38487` | Снижение копирования fixtures генератором, без изменения load acceptance |
| `fe3bf67` | Bounded serial outbox drain и fencing старого владельца lease; unit/SQL регрессии |
| `649103c` | Сохранение независимо закреплённых APK, strict website build и обязательный release-test CI gate |

REST `codex/security-restaurant`: `f9073c7` отдельно сохраняет исходные рабочие изменения; `90cd19a` переносит общий security-код; `2c4a7fc` содержит только ресторанную совместимость. Новый harness синхронизирован отдельным commit **`ed12fbefd7ef5c963d68a1466dc9f55a8be9ee40`**: 315 shared files/blobs/modes и root lock совпадают с MAIN, server/deploy/scripts Git trees идентичны. Apps tree по-прежнему идентичен `2c4a7fc`, без изменения сценариев входа/ролей/кодов.

Следующие изменения перенесены отдельными REST commits **`615fe6a`** (outbox) и **`f00b0bb`** (website downloads). На финальных source heads server/scripts/deploy trees совпадают с MAIN; Apps tree остаётся прежним. Совпадение всех `.github`/web trees между приложениями не заявляется. Отчёты сохраняются отдельными documentation commits; это не новый hosted CI run.

Push, PR, deployment и миграции рабочей схемы не выполнялись. Commit сам по себе не подтверждает успешный full CI или публикацию.

## Проверки приложений именно на Railway

Отдельный job завершён **2026-10-12 23:02:44 UTC**, внутри того же DEV API-контейнера на Node22.23.3, после завершения второй нагрузки и до старта третьей. Artifact **`sha256:d9048c8a8a88148a7988484566cb5dcf75b7050f51c4f6a7d60fbdb92a8f4243`** содержит 532 проверенных input-файла (531 tracked-source + собственный audit helper job.cjs) MAIN `ff38487` и REST `2c4a7fc` (Apps tree не изменился в `ed12fbe`). Git blobs/modes/source SHA и heads при запуске проверены. Все файлы/изображения сохранены; транспорт deduplicate одинаковые bytes без исключения quality inputs. Private keys, .env, Google credentials, APK/builds и сторонние hosting metadata не передавались.

| Реально выполнено на Railway | Результат |
|---|---|
| Mobile typecheck и все десять `test:*` scripts | **313 executions PASS**, fail/skipped/cancelled/todo 0 |
| Restaurant typecheck и `npm test` | **67 PASS**, fail/skipped/cancelled/todo 0 |
| Website Vite build | PASS, предупреждение chunk >500kB сохранено |
| Три admin `.test.*` набора | **32 PASS**, fail/skipped/cancelled/todo 0 |
| Mobile audit including dev, high gate | **FAIL:22 high +17 moderate**, critical 0 |
| Restaurant audit including dev, high gate | **FAIL:21 high +12 moderate**, critical 0 |
| Website audit including dev, high gate | PASS, 0 findings |

Итог app job **FAILED**, functionalChecksPassed=true, dependencyAuditPassed=false, ciPassed=false. Неуспешный обязательный audit не переименован в PASS и не скрыт. Установки — `npm ci --ignore-scripts` с отдельно выполненным проверенным Metro postinstall; остальные lifecycle не выполнялись. Functional tests/build запускались с запретом сетевых/DB/provider соединений. Аудиты обращались только к npm registry, в отдельной конфигурации без service credentials. Это проверка исходников/логики на серверном Node, а не полный release pipeline/native build.

Название mobile `test:native` обозначает Node source/lifecycle tests и не означает испытание APK/IPA на устройствах. Реальный HTTPS browser flow админки, native permissions/maps/push и signing/OTA остаются непроверенными. Build сайта без APK **не является** доказательством сохранения существующих downloads; их отдельное сохранение/проверка обязательно перед deployment.

Журналов 24, они сохранены приватно; все дочерние процессы завершены, 8 health samples, все HTTP 200; 37 resource samples. Собственный временный app-каталог удалён после проверки owner/status/PID **23:05:26 UTC**. Третья нагрузка началась после очистки, без конкурирующих app builds. Кандидат API не менялся; новый harness digest **`sha256:71a679dd51d2e4efd33ad14c26309f822d2cfc76eca6f04e0921abfa8d65324d`**. Safety memory watcher теперь 250 ms, **тот же бюджет 6 GB**; measured profile/acceptance thresholds прежние. Завершённый итог третьей лестницы приведён далее.

## Третья нагрузочная фаза: успешные gates и обнаруженная задержка событий

Завершена **2026-10-12 23:18:11 UTC**. Все шесть ступеней прошли исходные обязательные HTTP/order/commission/Socket.IO gates без ослабления. Независимое повторное применение сохранённых acceptance-функций к каждому результату также дало 6/6 PASS. Всего 99 038 HTTP requests, 1160 различных завершённых заказов и 580 различных commission entries; unexpected 429, HTTP errors, timeouts, dropped iterations и неожиданные disconnects — 0. Все 30 дочерних load processes завершились с exit 0. Для 1000 accounts: 950 Socket.IO ready, 950 reconnect и 1900 canonical resync.

| Уровень | Read p95, ms | Завершённые уникальные заказы | Комиссии | Исходные gates |
|---|---:|---:|---:|---|
| 50 | 62,43 | 20 | 10 | PASS |
| 100 | 57,13 | 40 | 20 | PASS |
| 250 | 85,60 | 100 | 50 | PASS |
| 500 | 181,95 | 200 | 100 | PASS |
| 1000 | 285,44 | 400 | 200 | PASS |
| 1000 peak2x | 174,50 | 400 | 200 | PASS |

API RSS на 500/1000/peak: 378,22/444,14/462,29 MiB; общий cgroup: 2588,60/3249,80/3742,09 MiB. Уменьшение памяти генератора относительно предыдущей фазы — измеренный результат тестового harness, **не экономия счёта действующего API**. Все 152 sampled existing-service health responses были 200, максимум 6 ms; health не доказывает задержку всех рабочих операций. Работающий deployment не изменился.

**Новая находка — задержка outbox:** подтверждено 501 pending/oldest 20,293284 s на 1000, 619 pending/oldest 24,833095 s на peak. В максимальных возрастных samples все pending ещё имели attempts=0 и backoff=0; tail drain около 25 events/s совпадает с ограничением worker `flush(25)` раз в секунду. Очередь в итоге опустела; сохранность/каноническая повторная синхронизация прошли. Код также содержит непосредственную отправку события, которая может доставить обновление раньше; **возраст durable queue не означает измеренную задержку экрана 20–25 s**. Backlog повышает риск задержки восстановления после пропущенной/неуспешной первоначальной отправки. Исходный socket gate измеряет readiness/resync и наличие application events, а не ACK/latency каждого заказа. Исправление worker и завершённый отдельный повторный remote прогон описаны далее.

Восемь raw HTTP streams для 500 и peak получены с проверкой точных bytes/SHA-256. На 500 process p95 600,506 ms, все 35 process ≥500 ms в волне 60–70 s; taxi arrive/start/complete p95 708,94/627,97/844,73 ms. На peak aggregate process p95 343,13 ms, но taxi accept p95 616,66 ms. Это не нарушает исходные aggregate gates и не означает, что все отдельные операции быстрее 500 ms. SQL/pool/GC attribution не измерен; дальнейшие per-operation и отдельный генератор нужны для вывода о реальной ёмкости Railway.

Read-only сверка **23:19:33 UTC**: все шесть deployment IDs прежние, рабочая схема 33 tables, audit DB 0; orders 140, food orders 3, users 11, restaurants 4. Refresh sessions увеличились с 1094 до 1098 во время наблюдения: причина этой независимой активности не установлена, поэтому полная byte-level неизменность содержимого БД не заявляется. Синтетические тесты не вызывали рабочие OTP/refresh endpoints. Runtime general DEV auth выключен; configured review accounts 3, review code присутствует. Реальные значения телефонов/кодов/credentials не выгружены.

## Исправление outbox и четвёртая серверная проверка

Commit MAIN **`fe3bf6794e5ba937b63698e3f1a42d65b9189f5b`**, REST **`615fe6a6b75b1f74ace2b6a53b19b888cb6689b9`**, только worker и два test-файла. Теперь один turn последовательно обрабатывает до 100 rows маленькими claims по 25, либо заканчивается после 500 ms, проверяемых **между законченными batches**. Это soft scheduling budget: уже начатый batch завершается полностью. Idle polling остаётся раз в секунду; overlapping ticks исключены. Partial/неподтверждённый batch останавливает дополнительный drain. Fresh DB authorization, payload, lease 30 s, exponential retry и business mutations не изменены; параллельной доставки и TTL прав нет.

Отдельная исправленная гонка: поздний ACK/retry старой lease не может изменить запись после нового claim. Atomic `updateMany` проверяет id, captured monotonic attempts и deliveredAt=null. Только обновлённая своим claim запись считается acknowledged. Порядок выборки и readback одинаков — createdAt,id. Это повторная отправка текущего canonical snapshot, не обещание полного исторического event stream или device ACK.

Artifact **`sha256:2b30a79b58b80c25b4c93a54f7283cb6256c7aba0eef6dbd7672a35544c89741`**, Node22.23.3/PG18.6 Railway DEV. В **23:40:24 UTC** завершились **311 unit +96 integration PASS**, build/migrations/server high audit PASS (8 moderate, 0 high/critical), skipped/cancelled/todo 0, temporary DB cleaned. Две новые Prisma fencing регрессии реально исполнялись на PostgreSQL; локально их не запускали. Предварительно локально Node24.19 прошли 29 focused units и TSC; эти preflight не заменяют remote proof. Независимый source review пройден.

Полная лестница нагрузки повторена на том же harness **71a679…d65324d**, профиле/SLO/ресурсах и sampler, без изменения thresholds; её завершённый итог и sampled outbox age приведены в четвёртой фазе ниже. REST server tree идентичен MAIN (`6b35f662cb7fb7f8ceebcf5303fcc25d1628be8e`); Apps tree до/после переноса `a17fb75d7d0d49e820e33e15a32f5c321f16f2d8`, без изменений ресторанного приложения.

Повторная read-only конфигурация **23:31 UTC**: deployment IDs прежние, все шесть лимитов 8CPU/8GB/1000PID, четыре native backup lists/schedules по-прежнему пусты. Подтверждён injected private hostname website.railway.internal:8080 без изменения сети. Три первые owned server/load temporary directories удалены после проверки nonce/manifest/completion/DB cleanup и отсутствия своих процессов; публичные APK/working tables не удалялись.

## Сохранение опубликованных APK при будущей сборке сайта

В исходном `.local/railway-site-release-1791480251774/web/public/downloads` найдены оба опубликованных файла: размеры и SHA-256 совпадают с ранее прочитанными actual website APK. Найдены arm64 build recipe и successful build logs, но они не связывают output digest с точным source commit. Версия в recipe и successful log **не закрывают неизвестное native provenance**; новые mobile исходники выпускать нельзя.

Подтверждён отдельный риск `prepare-downloads.mjs`: существующий пустой/nonmatching mobile/builds приводил к удалению staged APK, а более новый WIP-файл выбирался автоматически. В actual standalone web Docker context mobile отсутствует, поэтому verified staged pair там сохранялась; это находка пути сборки, **не утверждение о фактическом удалении APK действующего сайта**. Исправление сохранения pair/immutable replacement pin и завершённая remote проверка strict website build описаны ниже. Прежний source-only Vite PASS отдельно не считается доказательством сохранённых downloads нового сайта.

## Итог четвёртой нагрузки

Полный повтор завершён **2026-10-12 23:53:30 UTC**, **6/6 PASS**. Те же server+harness manifests **2b30a…941 /71a679…24d**, профиль 120 s, booking 60 s +drain 60 s, quota/actions/barrier и aggregate thresholds. Независимая повторная проверка исходных predicates также 6/6 PASS; все 8 raw streams для 500 и peak сверены по SHA/bytes/числу точек. Всего **99 003 HTTP requests**, 1160 различных завершённых заказов, 580 commission entries; recognized timeouts, unexpected HTTP/429, dropped iterations и неожиданные socket disconnects 0. Небольшое различие request/GPS totals между прогонами связано с измеренным closed-loop завершением действий в фиксированном окне, а не изменением профиля/порогов.

| Уровень | Read p95, ms | Max sampled pending | Oldest sampled pending, s | Итог |
|---|---:|---:|---:|---|
| 50 | 56,06 | 2 | 0,121 | PASS |
| 100 | 55,67 | 5 | 0,262 | PASS |
| 250 | 91,16 | 24 | 0,576 | PASS |
| 500 | 161,18 | 98 | 2,250 | PASS |
| 1000 | 268,42 | 193 | **6,021** | PASS |
| 1000 peak2x | **333,27** | 389 | **10,744** | PASS |

Все последние sampled pending=0, failed samples=0. Возраст durable backlog снизился относительно третьей фазы (20,293/24,833 s), но **не устранён и не является device ACK/первым обновлением экрана**. HTTP/order/resync PASS не закрывает этот риск. Предварительный следующий этап: инструментировать time per claim/publish/SQL/pool wait/GC и собственно получение order events, воспроизвести fixed profile с отдельным генератором на согласованном mirror. Не вводить TTL прав, бесконтрольную concurrent delivery/coalescing или новые пороги ради PASS.

На 500 aggregate process p95 443,69 ms против 600,51 ms предыдущего наблюдения, однако taxi complete 591,79 ms и process окна 60–70 s 720,02 ms. На peak aggregate read ухудшился **174,50→333,27 ms**, driver offers p95 **531,75 ms**, taxi create **551,39 ms**; aggregate process 280,64 ms. Исходные gates пройдены, универсального endpoint <500 ms не доказано. Причинность tradeoff не изолирована от shared host/DB/cache/run variability; нельзя объявлять улучшившимися все функции.

API RSS 500/1000/peak: 387,36/461,67/478,54 MiB; sampled shared cgroup 2180,21/2814,82/3219,84 MiB. Между прогонами удалены предыдущие test directories, поэтому уменьшение shared memory особенно нельзя приписывать working API или денежной экономии. Existing-service health 152/152 HTTP200, максимум 17 ms; наблюдение health не покрывает все protected operations.

## Исправление и remote проверка website downloads

MAIN **`649103c25da45ad3f43fe90d539b8f1cdc83fdad`**, REST **`f00b0bb6b9e654bd576d0bbbef5dcc76e907cf9e`**. Проверенная staged pair сохраняется даже при пустом/nonmatching/newer WIP source directory. Повреждённая или неполная pair блокирует сборку с сохранением прежних bytes. Замена требует явного `--replace` и независимого pin версии, архитектуры, SHA и размера; source filenames и physical paths проверяются. Activation использует private stage, lock и rollback. Live hydration также требует независимый pin, а не доверяет новому hash из remote manifest той же версии. Strict `npm run build` без pair/pin отказывает; только отдельный `npm run dev` явно разрешает unavailable downloads.

В репозитории сохранён независимый public release pin нынешних APK **1.2.08**. CI перед mandatory suite читает их с нынешнего HTTPS сайта и сверяет pin; `website-release-tests` — новый обязательный gate. Это будущая read-only передача около 189 MB на CI run, а не изменение Railway/DNS/публикация или доказанная экономия. Полный hosted CI ещё не запускался, native high audits остаются FAILED.

На Railway Node22.23.3 выполнены **24 release regression tests PASS**, strict Vite build PASS, website audit including dev/high gate PASS. **00:06:54 UTC** чистый execution attempt 3 завершился **PASSED**, artifact **`sha256:ccf88a172a340204d00c69e5eb91377c05c1a458ef9fc7ae4542c64229a95ef9`**. Все source blobs/modes/SHA сверены, .env.example/production config не передавались. Published APK прочитаны по подтверждённому private website hostname, сверены с заранее известными SHA/bytes; передача/сборка не обращалась к БД/провайдерам и не меняла работающий сайт. Functional tests/build выполнялись с запретом исходящих network calls, install/audit — только registry, без service credentials. Npm lifecycle scripts отключены; это не полный production-image build.

Итог проверен по **фактическому web Dockerfile layout**: Vite dist и admin/dist копируются отдельно. Сохранены оба APK общей длиной 189 177 304 bytes, их metadata и SHA; **24 public files +76 admin source files** имеют прежние bytes. Предыдущие 32 admin tests и 313 mobile/67 restaurant executions относятся к ранее проверенным source inputs; UI/подпись/native source происхождение ими не устанавливается. Actual Docker image, browser/TLS ingress login и native-device сценарии ещё не проверены.

Финальная локальная сверка доказательств **00:16:48 UTC**: 425 MAIN и 102 REST input-файла прежнего client job имеют прежние Git blobs/modes/SHA/bytes. Четыре изменённых web input-файла покрыты новым clean website artifact; все его 135 tracked inputs сверены. 164 server source inputs совпадают по SHA с phase4 manifest. Server/scripts/deploy trees MAIN/REST одинаковы; restaurant Apps tree прежний. Это проверка идентичности исходников после remote executions, а не повтор тестов, attestation native APK или hosted CI всего итогового commit.

Оба неуспешных helper executions сохранены. Первый остановился до тестов из-за ошибочно одинаковых npm user/global config paths. Во втором все реальные команды PASS, но helper ошибочно ожидал admin внутри Vite dist; read-only проверка фактического layout прошла, затем выполнен отдельный чистый полный execution 3. Их FAILED statuses не переименованы в PASS и не скрыты. Application source/пороги между этими попытками не менялись. Локальный preflight 24 release tests +35 ops PASS отмечен отдельно и не заменяет этот remote результат.

## Финальная сохранность, доступ и ограничения очистки

Все шесть собственных temporary directories удалены после owner/manifest/status/PID проверки; audit databases 0. Рабочие deployments, schema, provider configs, domains/ресурсы/backups и test-review accounts не изменялись этим кодом. В **00:08:52 UTC** текущие агрегаты: Users11, RefreshSession**1101**, Order140, FoodOrder3, FoodRestaurant4, tables33. Рост sessions 1094→1098→1101 за время наблюдения не приписан тестам; независимая активность не расследована. Не заявляется byte-level неизменность всей рабочей БД.

Оригинальный checkout повторно проверен **00:08:47 UTC**: 1622 позиции, исходные 181 отсутствующий файл сохранены, mismatches0, HEAD и raw git status идентичны снимку; status SHA `875793f3b34bbe4be6d0f1dd6f5e23b2455dd3e812aa9aba7dc66f98f5331fb3`. REST Apps tree `a17fb75…f2d8` неизменен; server tree идентичен MAIN. Коммиты кандидата не отправлены в remote; PR/deployment не создавались.

**Отдельная runtime находка при очистке:** 237 zombie processes с parent PID1 в **00:09:17 UTC**, cgroup pids.current276 при лимите1000; memory.current ~310 MB, oom/oom_kill0. У 11 известных запущенных аудитом job PIDs подтверждён stateZ/parent1. Эти jobs уже завершены и не выполняют тестовые действия, но занимают PID slots; общую долю аудита в остальных zombies и исходное число до работ установить нельзя. Следовательно runtime нельзя назвать полностью очищенным от процесса аудита. Завершённого zombie нельзя удалить обычным kill; нужен parent reaping либо согласованный controlled DEV API restart и проверка resync. PID1 не перезапускался, его точный компонент/причина unreaped children не установлены. Следующие длительные тесты следует вынести из обслуживающего контейнера и сначала проверить supervisor/reaping; автоматический restart используемого сервиса не разрешён этим этапом.

Собственный SSH key отозван **00:11:30 UTC** и проверен отсутствующим в списке ключей **00:12:14 UTC**. Закрытый audit key удалён локально; другие ключи/их имена/фингерпринты не изменены и не опубликованы. Отзыв ключа не устраняет PID1 zombie finding. Remote evidence и исходные failed/incomplete results сохранены приватно; публичный отчёт содержит только выбранные безопасные метаданные.

**Два окончательных вывода:** кандидат прошёл согласованный bounded synthetic DEV профиль на Railway и пригоден для дальнейших отдельно согласованных испытаний; integrated staging deployment/image/device/providers/recovery acceptance ещё заблокированы. **Production НЕ ГОТОВО** по перечисленным provenance/dependency/recovery/rollback/ingress/CI/privilege/latency/PID1 условиям. Подтверждённой денежной экономии на работающем сервисе пока нет.
