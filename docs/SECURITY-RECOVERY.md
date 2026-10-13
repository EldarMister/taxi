# Local recovery evidence

> Актуальное продолжение: [SECURITY-RAILWAY.md](SECURITY-RAILWAY.md). Этот документ сохраняет доказательства прежнего локального этапа. Последующие проверки на Railway DEV, подтверждённое происхождение API-кода и оставшиеся блокировки описаны отдельно; локальные результаты не доказывают production готовность.

Status on 13 October 2026: **the complete local database/file/configuration/application rehearsal passed** for candidate `sha256:d2038b7ae17e6677132f5f61ab7ec040a9c6285d81287acc965196f29fae6f8b`. Production RPO/RTO and recovery of all production dependencies remain **unverified**.

The rehearsal was restricted to the task-created PostgreSQL 18.4 databases `127.0.0.1:55448/taxi_security_test` and `taxi_security_restore`. It used synthetic keys, accounts, sessions and order fixtures. The successful candidate is based on local commit `644b72a96aba2295dd74edd52ac44ed744159f25` with uncommitted audited changes; the archived compiled-runtime inventory digest is `874bf42ca1618e470d6e2b2d19dd7e1e5b30102aab03b024f9f8ddd86ab7ed27`. No production resource or original checkout was changed.

## Actual successful execution

Run `9de245d4-295d-4976-a3ca-80850a0d068f` created an encrypted authenticated archive, verified its contents, restored only the empty designated restore database, and started the recovered compiled applications. The source load fixtures were included in the database snapshot and left in place. Only the recovery source namespace was removed afterwards: all 13 checked owned categories, including the post-snapshot marker, had count zero. The restored database, successful archive and prior failed evidence were preserved.

All **34 table counts, 353 constraints and 6 noninternal triggers** matched before application acceptance. The archive contained 193 entries including the dump; **192 required file hashes** matched the source inventory. The database dump was 709,234 bytes, SHA256 `ea4bef96f026a7c31df6bf6c36b44e408e1d80a0f43ea96716ee5a87c256b353`; the encrypted bundle was 18,340,667 bytes, SHA256 `e6fb049ff51eed80a886f26f6d1914a711ffc1910d98aacd64956763e62c1f78`. Source and target database clocks were both UTC with offset zero, checked before seed/restore; the recovery helper did not configure either clock.

The restored HTTP acceptance passed all 14 checks: startup and health, existing mobile Bearer session and refresh, canonical food pricing/history, taxi history and single commission ledger entry, restaurant session and foreign-restaurant denial, order lifecycle and duplicate-operation protection, media/avatar bytes, admin HttpOnly-cookie login/refresh/logout, recovered road-feature data, website index/JavaScript hashes, foreign keys and unique constraints. The separate normal startup probe executed the archived `dist/src/main.js`, with its ordinary jobs/outbox providers enabled, and verified middleware/CORS and driver Bearer/history. It processed the **specific pending outbox event ID preserved in the authenticated dump**, after the order advanced to its latest state; the canonical completed food order and one taxi commission/deposit 990 remained intact. Controlled HTTP acceptance disabled background workers; the separate normal probe verified their actual operation.

| Measured local operation | Duration |
| --- | ---: |
| Backup CLI, including dump and encryption | 11.851 s |
| Authentication/file verification CLI | 6.045 s |
| Restore CLI, including extraction and `pg_restore` | 6.805 s |
| Restore start through all application acceptance | 13.575 s |
| Controlled HTTP acceptance subprocess | 2.878 s |
| Normal compiled startup/worker probe, including subprocess shutdown | 3.641 s |

Backup started at `2026-10-12T20:36:53.124Z`; restore started at `20:37:15.495Z`; application acceptance finished at `20:37:29.070Z`. One deliberately committed post-snapshot user marker was absent after restoration. Its age at acceptance was 24.078 seconds; elapsed time from backup-command start to acceptance was 35.946 seconds. These are measurements of one local sample, **not a guaranteed backup freshness bound or production RPO/RTO**.

Private evidence is in `.local/recovery-drill/result.json`, `normal-runtime-result.json`, `database-clock-result.json`, and the successful run's `source-cleanup-result.json`. Synthetic configuration, keys and private fixture credentials must not be published with the report.

## Failed attempts and corrections

The first attempt, candidate `sha256:4516273008c0dae21344141822165467be0d1da5077894fcd9e6132323710a4e`, passed source UTC, runtime inventory and transactional synthetic seed. Actual `pg_dump` then failed with `definition of service "" not found`: the recovery CLI explicitly supplied an empty `PGSERVICE`, which libpq interpreted as a service name. No archive was created and the restore database was not modified. All 12 checked owned source categories had zero rows afterwards. That failed evidence remains preserved.

The fix removes every inherited environment key beginning with `PG`, case-insensitively, before supplying the validated local host, port, database, role, password, disabled local SSL and a ten-second connection timeout. It also removes `PGHOSTADDR`, service files and `PGOPTIONS`. The parent-selected PostgreSQL 18 executable and version check remain in use. The focused Windows recovery suite passed **6/6**, with zero skipped or cancelled tests, including inherited environment controls, redirected paths and preserved canaries; the successful full rehearsal then verified the correction with actual PostgreSQL tools. PostgreSQL documents these controls in its [PG18 environment-variable reference](https://www.postgresql.org/docs/18/libpq-envars.html) and [connection reference](https://www.postgresql.org/docs/18/libpq-connect.html).

An initial `d203` attempt created and authenticated its 193-entry archive but stopped before target access because the ignored helper passed a raw Windows drive path to an ESM import. Its archive and failure report were preserved and all 13 owned source counts were zero. The helper was corrected to use `pathToFileURL`; a no-database import check passed before the successful fresh-UUID repetition. Two further ignored-helper review findings were corrected: bounded shutdown now handles already-signaled children (actual subprocess tests **2/2**), and the worker probe checks the archived pending event rather than an event newly created after restore.

## Scope and release limitations

The authenticated inventory includes the complete synthetic database dump, compiled API runtime, actual `server/data/road-features-kg.json`, website assets, package locks, recovery tooling, synthetic configuration and an explicit required-file fixture. Application checks started from the recovered server directory and used its recovered road-feature file. Verify the actual production database/role clock before separately approved migrations as described in `SECURITY-DATABASE-CLOCK.md`; the production clock and existing timestamp meaning remain unknown.

The work area requires private ACLs and no concurrent mutation. Existing symbolic links, junctions and Windows reparse-point ancestors are rejected, and cleanup checks the created directory's identity. These checks do not claim protection against adversarial same-user path swaps. The separate local key is not an independent physical failure domain.

Installed private-checkout dependencies are reused; cold dependency/container/native recovery, real OSRM graphs, Nominatim database/index volumes, external providers, DNS/TLS, production secrets, signed installed mobile applications and recovered browser hydration remain outside this local proof. Preserved load sessions use separate ephemeral signing keys and are not included in the recovery-session acceptance. Production backup settings, offsite key storage and recovery objectives require separate agreement and evidence.

The recovered normal server executed its archived compiled `main.js`. A recovery-only preload constrained its listener to `127.0.0.1` and rejected nonlocal HTTP/fetch destinations; development providers and local stub map addresses were configured. The preload is test containment, not a change to the candidate's production bootstrap. Its no-database listener regression passed for wildcard binding, rejected nonlocal hosts and rejected pipe listeners. This does not establish real provider or production network recovery.
