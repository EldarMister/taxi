# Database clock requirement

> Актуальное продолжение: [SECURITY-RAILWAY.md](SECURITY-RAILWAY.md). Этот документ сохраняет доказательства прежнего локального этапа. Последующие проверки на Railway DEV, подтверждённое происхождение API-кода и оставшиеся блокировки описаны отдельно; локальные результаты не доказывают production готовность.

The application requires UTC on every PostgreSQL connection. Prisma represents the schema's timestamp-without-time-zone fields as UTC `Date` values, while PostgreSQL evaluates defaults and timestamp conversions using its connection `TimeZone`. A non-UTC connection can therefore put stored timestamps and application comparisons several hours apart.

`PrismaService` connects and performs one read-only startup query for `current_setting('TimeZone')` and `EXTRACT(TIMEZONE FROM CURRENT_TIMESTAMP)`. Startup proceeds only when the name is a fixed UTC/GMT zero alias and the reported offset is numeric zero. Accepted names are `UTC`, `Etc/UTC`, `GMT`, `Etc/GMT`, `GMT0`, `GMT+0`, `GMT-0`, `Etc/GMT0`, `Etc/GMT+0` and `Etc/GMT-0`, matched without regard to case. Regional names are refused, including names that currently report zero but can change seasonally.

When connection, query or validation fails, startup attempts to disconnect and returns a safe UTC configuration instruction. It omits the underlying connection/query error, which can contain credentials. The guard never changes a database setting or rewrites stored timestamps.

An authorized database operator must configure UTC for the application database and connection role, account for any connection-level overrides, and restart the application so its pool uses new connections. Configuration changes do not repair dates already stored under a different clock. Existing data requires separate provenance, backup and correction work; do not shift timestamps automatically based only on the current offset.

Before any separately authorized migration or rollout, verify this clock requirement using the actual application database, role and connection settings. `start:migrate` currently runs migrations before the application startup guard, so the guard alone is insufficient as a release preflight. Unknown or non-UTC configuration blocks that operation. The required checks must also pass for the same immutable release candidate. No production clock setting or existing timestamp is changed by this local work.

Outbox `createdAt` and `availableAt` defaults and worker eligibility comparisons explicitly evaluate UTC. A controlled integration fixture forces a non-UTC transaction, checks trigger-generated UTC defaults, holds the first worker's delivery, and verifies that a second worker cannot reclaim the 30-second lease. The transaction is always rolled back, including temporary visibility changes to unrelated synthetic queue rows.

`assertDatabaseUtcClock` is exported for recovery assertions using the same query result shape: `{ timezone, offsetSeconds }`. The focused unit tests call `PrismaService` lifecycle methods on a fake client and construct no Prisma client or database connection. A startup query checks the connection that runs it; consistent pool configuration and the absence of later connection timezone changes remain operational requirements.
