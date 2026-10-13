# Подготовка обновления Railway DEV — 13 октября 2026

Пользователь разрешил подготовку и deploy обновлений в существующее DEV окружение. Это не подтверждение production готовности. Ранее согласованное условие №8 об успешности всех обязательных проверок того же кандидата остаётся в силе; failed native dependency audit не скрывается.

## Свежая привязка

Read-only inventory 2026-10-13 12:00:53 UTC (18:00:53 Asia/Bishkek): проект `taxi-go`, ID `d7177395-a6c2-4939-959d-2535d87b28e2`, DEV environment технически `production`, ID `cd8887c6-93d7-4a95-b935-3c319f516fa8`. Все шесть действующих deployment IDs совпали с аудитом; API `74580d39-4dcd-441a-960f-c067fa4dc75d`, website `872e35c2-d148-46e4-8321-f79997ec1d2a`. Это новое наблюдение, не автоматическое доверие старому отчёту.

Source triggers прочитаны 12:05:55 UTC: API отслеживает `main` и `Dockerfile.railway` в корне, website — `codex/driver-road-signs`, root `/web`, `Dockerfile`. `checkSuites=false` у обоих. Ветка `codex/security-main` не совпадает с этими triggers. Настройки, ветки источников и Wait for CI не изменены.

## Подготовленные изменения упаковки

- Website Dockerfile копирует независимый `release-downloads.pin.json` и передаёт его обоим build helpers. Без этого свежая Docker-сборка не могла использовать pin из репозитория.
- Private download staging создаёт директории 0700 и APK 0600. Финальный image устанавливает 0755 для публичных директорий и 0644 для публичных файлов, сохраняя владельца root. Это устраняет риск недоступности APK для nginx workers. Тождество bytes должно проверяться реальным HTTP из контейнера.
- Оба API Dockerfile запускаются через Tini PID1 с передачей сигналов process group. Это подготовка reaping новых дочерних процессов; причина и устранение 237 zombies в прежнем действующем контейнере этим не доказаны. До deploy этот контейнер не перезапускался.
- Отдельный CI job собирает настоящие API/website images, запускает их с disposable PostgreSQL18, проверяет startup migrations/health/PID1, nginx proxy/admin и оба APK через HTTP с независимыми SHA/bytes/metadata. Он сохраняет commit и image IDs, не заменяет полный mandatory suite и не меняет severity gates.

## Проверки и границы

Локальный preflight Node24.19: 24 release regressions и 7 candidate/database-target checks PASS, без skip/cancel/todo; syntax нового container runner и `git diff --check` PASS. Это не Docker, Railway или новый full CI PASS. Docker локально недоступен; реальные images проверяются на CI runner.

Новый CI кандидат должен быть отдельным commit и пройти оба jobs. Native dependency audit предыдущего кандидата FAILED; безопасного исправления high braces/forge пока нет. Старые remote PASS относятся к прежним source manifests и не закрывают новые image/gate checks.

## Порядок следующего допуска

1. Получить полный CI результат точного нового commit и container evidence; не отправлять код в отслеживаемые Railway ветки до допуска. Не считать частично успешные jobs полным PASS.
2. Сверить runtime config без вывода значений секретов, неизменность ключей/аккаунтов и совместимость сессий. Сохранённый actual API source уже использует sid/fid и тот же JWT issuer/audience, но это не новая проверка всех действительных токенов.
3. До миграций обеспечить идентифицированную восстанавливаемую копию действующей БД, необходимых файлов и конфигурации. Наличие старых dump filenames не заменяет restore rehearsal. Изменение backup schedules/платных ресурсов требует отдельного согласования.
4. Проверить три additive migrations outbox/browserSession/durable offers на безопасном восстановленном target, включая сохранность существующих данных/сессий. Не применять seed/reset к рабочей БД. Предыдущий deployment не объявлять безопасным rollback после новых cookie/v2 данных; подготовить совместимый forward rollback.
5. После допуска загрузить только проверенные API/website inputs из отдельного export с явными project/environment/service IDs. Не переносить .env, ключи, исходный WIP или новые native APK. Для website сохранить pinned published pair1.2.08, runtime upstream/domain settings и admin assets.
6. Проверить фактический новый deployment ID/digest/commit marker, migrations, data/session/account aggregates, health/readiness, HTTPS/admin cookie/CSRF/multitab/logout, mobile Bearer/restaurant/Socket.IO reconnect и outbox. Нагрузку вынести из обслуживающего контейнера. Не объявлять production готовым.

## Статус

Подготовка начата; новый deploy и рабочие миграции ещё не выполнялись. Итоги CI, артефакты и допуск фиксируются дополнением после завершения. Все старые FAILED/incomplete результаты аудита остаются действительными в своей области.
