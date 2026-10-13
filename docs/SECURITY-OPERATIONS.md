# Local operations, recovery and cost evidence

> Актуальное продолжение: [SECURITY-RAILWAY.md](SECURITY-RAILWAY.md). Этот документ сохраняет доказательства прежнего локального этапа. Последующие проверки на Railway DEV, подтверждённое происхождение API-кода и оставшиеся блокировки описаны отдельно; локальные результаты не доказывают production готовность.

This implementation is local only. It does not authorize a deploy, Railway/DNS/database changes, paid resources, schedules or backup settings. Unknown provenance of the running production release blocks a release but does not block this local audit. Source fingerprints and passing local checks do not prove that `main` is production.

## Map consumption and freshness

OSRM and Photon now make conditional HTTPS GET requests with accepted `ETag` and `Last-Modified` values. A 304 skips download/hash/import. If a publisher does not provide validators, the existing complete download and SHA-256 comparison still runs. Validators are isolated by source URL, including the OSRM fallback, and become accepted only after identical SHA or successful graph/index activation. Failed imports and failed activation cannot advance validators. Daily checks remain 86,400 seconds after a successful check; failing checks retry sooner with a finite budget.

Existing build, trial checks, atomic `current` symlink switching and post-switch rollback remain. Memory heaps, geographical coverage, routing algorithm, languages, precision and update cadence have not been reduced. Savings are a hypothesis until measured with unchanged/changed real map responses on identical resources; no monthly savings percentage is asserted. Record bytes downloaded, check/import duration, disk peak, CPU, steady RSS, search/route p50/p95/p99, failed requests, update timestamp and published-source timestamp before/after. `http.checked` records successful source checks, not the publication date of data.

OSRM/Photon stop after seven rapid server failures; increasing delays let the 60-second activation rollback finish before the crash budget expires. Source update retries are bounded to five per round, then preserve accepted maps, write /data/http.failed and resume daily checks. A server that stays up five minutes resets the crash budget. Nominatim replication has the same finite rapid-crash policy and writes `/tmp/taxi-nominatim-replication-failed` on exhaustion. A production monitor must check that marker, replication process and Nominatim `data_updated`; its regular HTTP readiness endpoint alone cannot prove fresh replication. No live monitors were installed.

OSRM bootstrap preserves `/data`, fixes ownership when a root-owned legacy volume is present, then runs OSRM/update processes as UID 1000. This is prepared, not verified against an actual Railway volume or built Docker image. Validate ownership migration, changed/unchanged files, failed import, failed readiness, rollback, signal shutdown, disk capacity and IPv6 in approved staging before shipping. Nominatim still needs its existing privileged PostgreSQL bootstrap; this change does not claim to remove that requirement.

Local verification: `node --test scripts/test/*.test.mjs`. Map tests use a fake curl function and real Bash. They prove validator acceptance/source isolation, daily cadence, bounded failure budgets and shell syntax. They do not contact Geofabrik/GraphHopper, construct real graphs or measure consumption. Git Bash is required on Windows; Linux CI uses `/bin/bash`.

## Candidate checks and release gate

The main CI workflow uses PostgreSQL 18 and installs locked server/mobile/web dependencies. `node scripts/verify-candidate.mjs` executes every discovered server unit and integration `.test.ts`, all mobile `test:*` scripts, server/website build, all web/admin session/editor/asset tests, operations tests and complete locked-dependency audit including build/toolchain dependencies. Rate-limit integration tests require a database and no longer silently skip. This runner rejects skipped, cancelled and TODO tests as well as failed checks. Missing/unrun check records block the gate. Each record includes Git commit and SHA-256 of the actual source, checked again at completion. Evidence and individual logs are stored under `artifacts/candidate-checks/`, even on a failed CI job.

Use required check `verify` on the exact proposed commit, and require its evidence. Do not accept a different SHA, a rerun with different source, a cancelled/skipped run, a missing artifact or Railway Wait for CI by itself. Freeze and record the actual packaged image/build digest when proposing a release and confirm it derives from this checked source. This runner has not been run in hosted CI and cannot establish native build, staging or production readiness. A local dirty checkout is allowed for investigation and remains unsuitable as unproven release provenance.

Integration database guards run before Prisma construction or registration of cleanup hooks. Allowed reset targets are exact numeric-loopback `127.0.0.1:55448/taxi_security_test`, `127.0.0.1:5432/taxi_test` (CI), and the legacy `127.0.0.1:55432/taxi_test`; all need `TEST_DATABASE_RESET=true` and development/test mode. Only unique `schema=public`, decimal `connection_limit` and `pool_timeout` values 1–60 are permitted. Unknown/duplicate options, remote addresses, `localhost`, wrong port/name and production mode are rejected. Use the newly provisioned audit target for this work; do not run the legacy local database helpers against another workspace's data.

## Encrypted local recovery tooling

`scripts/recovery.mjs` requires Node and PostgreSQL **18** `pg_dump`/`pg_restore`; set `PG_BIN` to an installed bin directory when it is not on PATH. It stores a custom streaming gzip bundle encrypted with AES-256-GCM, a separate random 32-byte key, authenticated headers/contents and SHA-256 for every entry. The database dump is custom format with no ownership/ACL restoration. Inputs are explicit and their root must be inside this checkout's ignored `.local` audit area; symlinks, traversal and duplicate names are rejected. Decryption authenticates the entire bundle before extraction. Existing destination directories are refused. Wrong keys/corruption fail closed and remove the newly created extraction directory. Output/key/extraction directories stay inside `.local` as well. Permission modes are set; enforce user-only ACLs separately on Windows before storing real secrets.

Create a synthetic-only manifest in `.local/recovery-manifest.json`, for example:

```json
{
  "sourceRoot": "C:/path/to/checkout/.local/recovery-fixture",
  "candidate": "exact commit and source fingerprint",
  "recoveryScope": "isolated database, synthetic required files and synthetic application configuration",
  "files": [
    {"path":"config.json","name":"configuration/config.json","kind":"configuration"},
    {"path":"required-assets","name":"files/required-assets","kind":"required-file"}
  ]
}
```

From the checkout root, after setting the exact disposable `DATABASE_URL`, `NODE_ENV=development`, `TEST_DATABASE_RESET=true`, and local `PG_BIN`:

```text
node scripts/recovery.mjs keygen --out .local/recovery-key.bin
node scripts/recovery.mjs backup --manifest .local/recovery-manifest.json --key-file .local/recovery-key.bin --out .local/audit-backup.atlas.enc
node scripts/recovery.mjs verify --bundle .local/audit-backup.atlas.enc --key-file .local/recovery-key.bin --destination .local/recovery-verified
```

For actual DB restore, pre-create an empty isolated `taxi_security_restore` on audit port 55448 (or `taxi_restore` on CI port 5432), set its exact `RESTORE_DATABASE_URL` and `RESTORE_DATABASE_RESET=true`, then:

```text
node scripts/recovery.mjs restore --bundle .local/audit-backup.atlas.enc --key-file .local/recovery-key.bin --destination .local/recovery-restored
```

Restore **never** targets the working test database, production or another port. It cleans only the exact authorized disposable recovery database. Tool logs omit connection credentials. This local runner neither schedules backups nor uploads to storage or configures PITR. Store an independent copy of the key outside the backup failure domain only when separately authorized.

Recovery path checks reject existing symlink, junction and reparse-point ancestors and require physical containment in `.local`. Use a work area with user-only ACLs and no concurrent path mutation; these checks do not defend against dynamic path swaps by another process running as the same user. Cleanup refuses an unsafe changed path and can preserve a failed directory for review.

Record a recovery drill with start/end times, source snapshot time, dump size and hash, authenticated bundle hash, restored tables/constraints/row counts, representative order/ledger invariants, required-file hashes, configuration recovery and application startup/HTTP/mobile/restaurant acceptance against the restored copy. Include external providers, credentials/signing references, complete environment variables and required map/voice assets in the approved production recovery inventory. Rebuildable map volumes can be recreated only if that time fits RTO; otherwise include validated copies. DB-resident avatars/documents/media are part of the DB dump. Quiesce mutable external assets or use coordinated snapshots to keep DB references and files consistent. A synthetic archive test or successful `pg_restore` alone is **not** achieved RPO 15 minutes/RTO 2 hours.

## Fixed, guarded load scenarios

`scripts/load/profile.example.json` captures the observed local host only (Windows x64, Ryzen 5 6600H, 12 logical CPUs, about 24 GiB). Resource fields intentionally remain incomplete: freeze measured/allocated API/PostgreSQL/generator CPU and RAM, replica count, pool/connection budgets, map providers/resources, exact candidate and approval before execution. A colocated generator competes with the API and cannot establish a Railway capacity/cost limit. Reuse identical resources, fixture/action profile and candidate for before/after comparisons.

Baseline roles are 80% client, 15% driver, remaining restaurant. Client sync is 12s; driver GPS is 5s and offer/active sync 12s; merchant orders poll 10s after request completion, matching foreground behavior. Restaurants are HTTP-only. Clients/drivers use genuine Socket.IO sessions, `session:ready`, event counting, forced reconnects every 60s and canonical HTTP resynchronization. Optional tracking subscriptions use real acknowledgements. No role switches or OTP/SMS/push network calls are part of load generation. Fixtures must use isolated synthetic accounts with one account per role slot, valid prepared sessions, verified drivers online with adequate test deposit, dedicated open restaurants/dishes, exact tariff and local route/provider fixtures. Never use store-review accounts or production tokens.

Fixture file (ignored `.local`) contains `fixtureRunId`, `clients[{userId,token,restaurantId,items,capabilities?}]`, `drivers[{userId,token,trackingOrderId?}]`, `restaurants[{accountId,token,restaurantId}]`, `pickup`, `dropoff`, `tariffId`. `items` must satisfy current server modifier rules, including required `optionIds: []` when no options are selected. Food is pickup with cash; taxi is the other half of booking iterations. Merchant workers accept/prepare/ready/complete pickup orders; driver workers accept/arrive/start/complete synthetic taxi trips. This accelerated lifecycle verifies operations, not realistic travel times. Each create is retried with the same identifier and must return the same order. Quote prices and order validation still come from the API.

The k6 scenario reserves 5% of client slots for an open arrival-rate booking scenario (one booking per client every 120s); remaining slots are closed foreground polling VUs. This keeps the HTTP VU ceiling within the declared users and records genuine `dropped_iterations` when booking cannot keep up. Bookings stop 60s before the end for completion drain; total duration must be at least 120s. Run 50 → 100 → 250 → 500 → 1,000, then a separately bounded peak, only after smaller runs pass. Keep synthetic fixtures separate per run or clean only that exact namespace afterwards.

The booking function enforces the declared count before any quote/create/retry HTTP. A k6 executor tick racing its stop timer exactly at the duration cutoff is recorded as `executor_boundary_iterations` and sends no additional booking. More than one such iteration blocks acceptance; `dropped_iterations` remains independently required to be zero. Every actual booking must match the strict declared DB/operation count and complete successfully. The 21-booking attempt at the nominal 20-booking cutoff remains a failed harness attempt, even though all its orders completed.

Targets are numeric loopback by default. Remote tests need the exact explicitly approved HTTPS staging origin; production-like hostnames and redirects are refused. The local coordinator supplies `LOAD_MANIFEST`, `LOAD_FIXTURES`, private actor-registry settings and distinct `LOAD_RESULT` values, then runs the two generators together:

```text
node scripts/load/run-local.mjs 50
node scripts/load/assert-results.mjs <http-summary> <socket-summary> <matching-run-evidence>
```

Coordinate HTTP and Socket.IO during the same test window and preserve both summaries. Criteria include HTTP p95/p50/p99 and error rates, zero unexpected 429/timeouts/dropped iterations, ≥99% successful create/accept/process/retry rates, every created synthetic order completed after drain with unique DB evidence, connection readiness, disconnects, auth-unavailable/expired events and canonical snapshots after reconnect. The result guard rejects missing operation samples, incomplete orders and mismatched candidates/fixture namespaces. Collect API event-loop/RSS/CPU, DB connections/query latency/locks, graph/index consumption, queue lag and generator saturation alongside summaries. No actual k6 or 1,000-user run is claimed by the protocol-fixture unit test. An approved staging coordinator still needs its exact synthetic DB scope, environment resources, actor registry and read-only DB outcome collection configured and reviewed; `run-local.mjs` intentionally refuses remote DBs.

Socket.IO acceptance checks every account's initial canonical synchronization and every planned reconnect's completed synchronization, rather than only aggregate successes. It records reconnect readiness p50/p95/p99, avoids forced reconnects within one full HTTP timeout of the fixed finish, waits up to 20s for pending snapshots/acknowledgements and fails if any remain incomplete. One account's extra snapshots cannot hide another's missing synchronization.

The authorized local audit can use `scripts/load/local-server.mjs` after the latest server build and exclusive audit database clearance. It refuses to start without `LOCAL_LOAD_EXCLUSIVE_DATABASE=true`, binds only `127.0.0.1:55449`, reads only the new port-55448 audit DB configuration, validates the food fixture through the actual compiled candidate DTO/ValidationPipe before any seed write, then seeds 800 clients/150 verified drivers/50 restaurant accounts with private valid sessions, disables provider/retention workers and stubs only routing. A fixture-only dispatch ticker and real order outbox maintain application behavior. Generated keys/tokens stay in ignored `.local`; external fetch is denied. It writes actual host/runtime/PostgreSQL resource details, fixed profiles and CPU/RSS/event-loop/DB samples. `node scripts/load/run-local.mjs 50` runs HTTP and Socket.IO together, activates only the declared driver subset, records order outcomes and refuses a changed candidate. Repeat higher steps only after acceptance passes. It does not lower access checks or rate limits. Stop the server before any integration suite/reset or recovery operation; preserve failed fixtures for diagnosis.

Foreground k6 actors bind once to distinct role-local slots through an integer-only registry inside the coordinator. The registry uses a random loopback port and a random per-run header; it returns no credentials. Its cold-start requests are tagged `operation:harness` and included in HTTP totals, with the same overhead for every profile. Global k6 VU IDs can interleave between scenarios, so modulo role size is not a valid distinct-account mapping. Booking uses `execution.scenario.iterationInTest` to select distinct declared clients during the fixed 60s window and alternate food/taxi globally. The coordinator requires every declared foreground slot to be allocated. Critical operation IDs/statuses are bounded and recorded in ignored logs without tokens or request headers. Acceptance compares counters and unique operation IDs against DB rows, complete ordered status histories and exactly one commission per taxi completion; repeated idempotent responses cannot inflate work completed, and incomplete rows block progression. Rechecking summaries requires the matching run evidence: `node scripts/load/assert-results.mjs <http-summary> <socket-summary> <run-evidence>`.

After the normal 1,000-user profile passes, `node scripts/load/run-local.mjs 1000 peak2x` executes a bounded 120s peak with the same users, candidate, resources, booking rate and 60s drain. Only foreground sync/offer/merchant polls and GPS are doubled (6s/6s/5s/2.5s respectively); Socket reconnects retain 60s cadence. Both profiles are frozen at server startup. Normal/peak labels and timestamped attempt files preserve failed and successful runs independently; the un-timestamped evidence file is only the latest-result alias. All acceptance checks, order completion and canonical reconnect synchronization still apply. Do not run the peak after a failed baseline or report this accelerated mock-route peak as production capacity.

## Current verification boundary

- **Confirmed and fixed locally:** full-download update pattern, unbounded rapid restarts, weak/nonuniform disposable DB guards, omitted CI suites/PG17 baseline, missing encrypted full-scope local recovery and detailed load acceptance tools.
- **Verified by local tests:** conditional-request and supervisor control flow, exact DB-target rejection, candidate-check rejection semantics, synthetic encrypted-file roundtrip/tamper/wrong-key checks and load protocol/acceptance guard behavior.
- **Unverified:** real container builds/volume upgrades, provider HTTP behavior, real graph/index rollback and memory savings, hosted CI on frozen release candidate, native tests on devices, full measured load, live backup completeness/freshness, application recovery and production domain behavior.
- **Requires separate agreement:** every staging/prod service operation, remote load, paid resources, Railway settings, DNS, PITR/backup schedules/storage/key custody and any production rollout. Production remains blocked until provenance, same-candidate checks, staging/domain/compatibility/load/recovery evidence and unresolved security risks are cleared.

## Measured local load appendix (2026-10-12 UTC)

The selected candidate is commit `644b72a96aba2295dd74edd52ac44ed744159f25`, source digest `sha256:d2038b7ae17e6677132f5f61ab7ec040a9c6285d81287acc965196f29fae6f8b`. Full mandatory functional checks passed for that same digest: 289 server units, 94 integrations, 313 mobile tests, 32 admin/browser-session tests and 27 operations tests, with builds/typecheck. The required dependency audit still fails with 22 high Expo tooling findings; no release gate was waived.

All selected load attempts used one API on Node 24.8.0, PostgreSQL 18.4 (`max_connections=60`, API Prisma pool 10), Windows x64/Ryzen 5 6600H/12 logical CPUs/about 24 GiB shared host memory, and a colocated generator. No hard CPU/RAM allocation was applied. Profiles used the same 800-client/150-driver/50-merchant synthetic namespace, declared 80%/rounded 15%/remaining role mix, 120s nominal activity and 60s booking cutoff/drain, deterministic route, cash pickup food, genuine Socket.IO, 5s API/DB/outbox samples and local raw k6 JSON output. Generator completion includes standard graceful completion of in-flight iterations; actual start/end times are retained. Real map graphs, search, SMS, push, payments and Railway allocations were not exercised.

Raw `http_req_duration` quantiles below include HTTP sending/waiting/receiving and server auth/awaited service work; connection setup is separate. `process` combines taxi arrive/start/complete and merchant PREPARING/READY/COMPLETE. Values are rounded milliseconds; exact samples and linear quantiles are preserved.

| Users | Outcome | HTTP / RPS | Read p95 | Quote | Create | Retry | Accept | Process | GPS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | Passed | 1360 / 11.26 | 102 | 18 | 87 | 24 | 64 | 56 | 15 |
| 100 | Passed | 2688 / 22.22 | 141 | 38 | 52 | 18 | **1376** | 65 | 62 |
| 250 | Passed | 6736 / 54.95 | 362 | 235 | 101 | 34 | 209 | 290 | 81 |
| 500 | **Failed** | 14671 / 117.48 | **648** | 160 | 271 | 50 | **540** | **1160** | 463 |

All four attempts created/accepted/completed exactly their declared 20/40/100/200 unique DB orders, with full ordered status histories and exactly 10/20/50/100 taxi commissions. Foreground actor allocations matched every declared distinct slot. The failed 500 attempt's unique order proof was checked independently without changing its failed acceptance. It does not satisfy the full load gate. The 50/100/250 passes each recorded one no-HTTP cutoff boundary iteration; 500 recorded zero. All recorded `dropped_iterations`, API 5xx and unexpected API 429 counts were zero.

| Users | Socket ready / reconnect / canonical sync | Socket failures | Observed outbox peak / oldest age | Peak API RSS | Max observed DB connections |
| --- | --- | --- | --- | --- | --- |
| 50 | 48 / 48 / 96 | 0 | 3 / 0.70s | 252 MiB | 21 |
| 100 | 95 / 95 / 190 | 0 | 11 / 0.48s | 274 MiB | 21 |
| 250 | 238 / 238 / 476 | 0 | 51 / 1.17s | 369 MiB | 22 |
| 500 | 475 / 475 / 947 | 5 connect errors; 3 failed initial canonical syncs | 118 / 6.39s | 465 MiB | 22 |

At 500, raw error code `1212` / `dial: connection refused` occurred on 1,231 actor-registry requests and 278 API read requests. Registry requests therefore totalled 1,711 instead of 480; failed binding iterations retried and added local generator traffic. All actors eventually bound, but this transport failure and read p95 exceeding the existing 500ms gate block progression. Three Socket.IO accounts (indices 333, 336, 337) failed initial canonical sync and succeeded after their planned reconnect; this remains a failed observation, not a successful initial sync. The five connect-error strings and canonical exception details were counted but not retained by the original helper, so their exact causes cannot be reconstructed. Zero recognized request-timeout samples does not establish universal absence of every timeout category.

The original API process remained alive after the failed run, still listened on its declared loopback port and returned health `ok`. Those facts were captured minutes later and do not determine whether the burst refusal came from a host/listen backlog, generator or application limit. No physical cause is confirmed. Five-second sampling can miss short contention; max observed lock waits were zero. At 500 the observed API CPU peak was 240% of one-core time, which can exceed 100% because the process includes worker/native threads; this is not a hard CPU allocation. No Windows socket settings, API limits, profile, latency SLA or paid resource were changed.

The ladder stopped at 500. The 1,000-user baseline and 1,000-user peak were **not run**. Cost/capacity reductions cannot be inferred from this shared-host mock-route run. Retained earlier failed attempts include the missing food `optionIds`/colliding VU fixture, hotspot duplicate driver reservations, and the nominal-20/actual-21 executor cutoff; none was relabelled passed. The earlier 90a6 cutoff attempt also retained process p95 1775ms, with four approximately 1.95s taxi start/complete responses; nearby sampled resources do not prove their cause. Successful lower stages and these latency spikes remain distinct evidence.

Offline aggregate evidence is `.local/load/final-summary.json`; it selects only the same candidate's passing 50/100/250 attempts, separates the failed 500/prior attempts and marks 1,000/peak unrun. Timestamped raw HTTP, Socket.IO, DB lifecycle/commission, resource/outbox, failed-actor and transport diagnostic files are retained in ignored `.local/load`. All load API/generator/registry/sampler processes were stopped and the exclusive audit DB was released before recovery. Production readiness is not asserted.
