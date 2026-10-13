# Local security implementation — agreed conditions

> Актуальное продолжение: [SECURITY-RAILWAY.md](SECURITY-RAILWAY.md). Этот документ сохраняет доказательства прежнего локального этапа. Последующие проверки на Railway DEV, подтверждённое происхождение API-кода и оставшиеся блокировки описаны отдельно; локальные результаты не доказывают production готовность.

This document records the authorized local scope. It is not deployment approval.

## Scope and preservation

- Isolated branches: `codex/security-main` and `codex/security-restaurant`; original checkout remains untouched.
- Original tracked/untracked source and deletions captured in `.local/security-audit/snapshot` in the original checkout, with SHA-256 manifest and binary/index patches. Ignored production credentials and signing material are not copied.
- Main begins at `644b72a96aba2295dd74edd52ac44ed744159f25`; restaurant snapshot begins at `e4adcac4c77b757019dd249ebe2c02f37100d598` plus captured work in progress.
- Main server is reconciled against the local `order-cancellation-api-release` candidate, not asserted equivalent to production. File origins/hashes are stored in the isolated checkout reconciliation manifest.
- No Railway, DNS, production database, paid resource, backup provisioning, deployment, message or notification destination change is authorized.

## Required release gates

1. **Provenance:** document runtime functions and applied migration lineage; remote image/source identity remains unknown until verified. Unknown identity blocks release while local work continues.
2. **Store accounts:** preserve allowlist, static codes and login behavior. Synthetic tests check exact account boundaries, ordinary server roles and ownership. Conflicts are documented; no silent account/policy change.
3. **Database outage:** HTTP, refresh and Socket.IO deny unverified protected work while retaining valid credentials. Technical failures never masquerade as credential expiry. Rotations and profile loading must commit atomically.
4. **Committed orders:** transactional SQL outbox survives the commit/event gap. Notifications are at least once; business mutations remain idempotent. `deliveredAt` records enqueue, not client ACK; reconnect must read canonical order/offer state.
5. **Capabilities:** header controls catalog presentation only. Server validates actual catalog, modifiers, availability and prices. HTTP Vary/ETag and independent copies partition legacy/new audiences. Prior server rollback must be tested against new data; literal main is unsafe for new modifier data.
6. **Load:** freeze role/action profile, source identity, resources and provider mocks; record 429, timeouts, dropped iterations, disconnects and create/accept/process success alongside latency and 5xx.
7. **Recovery:** include DB, required files, configuration and app acceptance; encryption/key separation and file integrity are tested. A script or small local restore does not establish live RPO 15m/RTO 2h.
8. **Candidate CI:** every mandatory check must finish successfully for the same candidate fingerprint. Failed, skipped, cancelled, missing, stale or different-candidate results block release; Wait for CI alone is insufficient.
9. **Admin cookies:** same-origin website proxy, HttpOnly cookie, page reload, multiple tabs, remember, logout, migration races and mobile Bearer are covered locally. Real production HTTPS/domain/proxy topology requires separately approved verification.

## Cost and quality invariants

- Keep Railway and one API replica. Keep current daily map freshness and accepted-graph rollback.
- Conditional map downloads, identical in-flight route sharing, batched history reads and bounded temporary-data retention reduce redundant work.
- Do not lower map memory, alter GPS fidelity, sleep production services, disable backup/security or claim monetary savings without matching workload measurements.
- Mandatory npm audits remain enforced. Unpublished upstream fixes are explicit dependency blockers; do not downgrade Expo/React Native or waive vulnerabilities merely to make the audit green.

## Evidence and final assessment

Each finding uses separate statuses: suspected, confirmed, fixed, verified. Reports identify the actual command/environment, passed/failed/skipped results and remaining limits. Two final decisions are required: readiness for agreed staging trials and readiness for production. Local passing tests alone cannot establish production readiness.
