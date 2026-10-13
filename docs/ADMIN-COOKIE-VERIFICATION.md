# Admin cookie authentication: local evidence

> Актуальное продолжение: [SECURITY-RAILWAY.md](SECURITY-RAILWAY.md). Этот документ сохраняет доказательства прежнего локального этапа. Последующие проверки на Railway DEV, подтверждённое происхождение API-кода и оставшиеся блокировки описаны отдельно; локальные результаты не доказывают production готовность.

Date: 2026-10-13, Asia/Bishkek. Checkout: `codex/security-main`. These checks authorize neither deployment nor production configuration changes.

## Implemented behavior

- Administrator access tokens exist only in JavaScript memory. Cookie login/bootstrap/refresh call `/api/admin/auth/browser/*` with `credentials: same-origin` and `X-Atlas-Admin: 1`; the browser supplies its actual `Origin`.
- Login sends `remember`. Persistent login uses the backend's expiring cookie; unchecked remember uses a browser session cookie. Both survive page reload while their browser cookie exists. Only username/remember preferences are stored locally.
- Legacy browser refresh tokens migrate through `/migrate` to a newly generated opaque cookie. Root changed the backend to revoke and mark prior family rows and create the replacement atomically; the old JavaScript token cannot rotate or revoke that stable cookie. Both legacy token stores are erased after successful validation/migration; a 5xx migration leaves stored credentials available for a later retry, without exposing an unverified protected session.
- If a migration response is lost after `Set-Cookie`, a subsequent same-epoch migration 401 tries checked cookie refresh before declaring sign-out. A 503 fallback preserves saved legacy credentials for retry and yields no protected bootstrap. Origin/CSRF rejection (403/419) never uses this fallback.
- JSON and blob results are rejected if logout or another login changed the authentication epoch. Refresh failures with network/5xx preserve a previously checked memory session but do not return protected data. Revoked cookie refresh clears memory.
- Logout clears memory and disconnects the panel immediately. Other tabs receive a nonsecret storage/BroadcastChannel event. Failed server revocation is visibly pending; page reload retries logout before cookie bootstrap. A nonsecret `atlas.admin.logout-pending` cookie preserves this intent when persistent storage is blocked. It contains no access/refresh token or user identity.
- Cookie-writing login/migration/logout operations are serialized per tab and use browser Web Locks when available. Cookie refresh does not rotate the session family. Existing mobile Bearer endpoints are unchanged.
- Photo URL normalization and upload/blob helpers remain available.

## Checks actually run

| Check | Result | What it proves |
|---|---|---|
| `node --test web/admin/test/session.test.cjs` | 20/20 passed | Real frontend API module with deterministic storage/network: remember, reload, migration/lost-response recovery, concurrent refresh, 503, failed logout/reload, blocked storage, multi-tab markers, late JSON/blob/refresh/login results |
| Existing editor and content tests combined with session tests | Final local frontend step: 32/32 passed | Session, editor and photographic content contracts pass after root aligned the captured website photograph source with main |
| `browser-session.playwright.cjs` using the Playwright browser tool | 12/12 passed | Real admin DOM and browser cookie enforcement, through a loopback website proxy to a separate synthetic private API |
| `node .local/security-audit/run.cjs node_modules/tsx/dist/cli.mjs --test test/admin-browser.integration.test.ts` | Final reconciled backend: 9/9 scenarios passed in the complete 89-test PostgreSQL integration run | Compiled Nest controllers, PostgreSQL 18 and separate HTTP proxy. Executed tests additionally require a new cookie, rejection of old/public refresh without live-family revocation and rollback after a profile failure following migration writes |

The browser fixture uses only `127.0.0.1:59421` and a synthetic API on `127.0.0.1:59422`. It has no PostgreSQL connection and no external integration. Synthetic fixture credentials are deliberately public test data. Browser checks use fresh isolated contexts and close them afterward.

The backend integration guard runs before constructing Prisma. It permits only the task's disposable numeric-loopback database. The suite creates random synthetic ADMIN/CLIENT records, disables background jobs/outbox work, and removes only its fixture records. Dependency failure is injected into the application's Prisma boundary; the PostgreSQL service itself was not stopped.

## Finding states

| Finding | Status |
|---|---|
| Browser Bearer tokens persisted in local/session storage | Confirmed in prior frontend; fixed; checked locally |
| Late successful JSON/blob responses could outlive logout | Confirmed in prior frontend; fixed with epochs; checked locally |
| Offline logout could leave an HttpOnly remembered cookie able to restore the session | Confirmed design risk introduced by the cookie transition; fixed with pending-revocation markers; checked in the real browser and VM, including blocked local storage |
| Concurrent tabs could reuse a rotating refresh token | Confirmed prior rotating-storage mechanism; replaced by backend stable cookie refresh; checked with actual Nest/PG and the browser fixture |
| A legacy in-flight `/auth/refresh` can rotate a session after browser migration | Confirmed in the initial implementation; root fixed the source with a `browserSession` guard and atomic migration replacement; final compiled regression still pending |
| A lost migration response could force sign-out despite a valid new HttpOnly cookie | Confirmed with deterministic frontend transport; fixed with checked cookie fallback only after same-epoch migration 401; checked in VM, including unavailable fallback and forbidden-Origin cases |
| Actual production domain/proxy/TLS compatibility | Unverified; blocks production approval |

## Actual-domain release gate

The frontend derives API and live-event origin from `window.location.origin`. The intended layout is **public HTTPS website/admin origin → same-origin `/api` proxy → private API**, with the auth cookie scoped to `/api/admin/auth/browser`, host-only, `HttpOnly`, `SameSite=Strict`, and `Secure` in production.

The local proxy layout was checked. No production domain, DNS, Railway setting, CORS list, production database or real account was accessed or changed. Local HTTP cannot demonstrate the production `Secure` flag, HTTPS trust chain, cross-site navigation behavior or production proxy forwarding.

Before production approval, run against the approved staging topology with the same candidate as CI:

1. Confirm the real public HTTPS origin is in the exact server origin allowlist and `/api` forwards `Origin`, the custom header and `Set-Cookie` correctly. Verify the actual cookie's `Secure`, `HttpOnly`, path and host scope in the browser.
2. Check login, reload, several tabs, simultaneous refresh, checked/unchecked remember, logout across tabs and retry after a failed revocation. Test session expiry and credential/access revocation.
3. Check browser restart for remembered and session cookies, direct navigation/bookmarks, same-site/cross-site entry links and the supported browser/device matrix.
4. Verify the actual Nest backend with the browser UI under simulated DB outage and reconnection, including absence of protected data and unexpected session destruction.
5. Confirm ordinary mobile Bearer login/refresh and store test-account behavior against the same candidate. The local synthetic CLIENT Bearer check does not replace store review-account tests.
6. Require successful mandatory CI for that exact candidate. Cancelled/skipped checks and unknown production-release provenance remain release blockers.

Readiness: the implemented admin flow is locally testable in staging after separate approval. Production readiness is not established by these local results.
