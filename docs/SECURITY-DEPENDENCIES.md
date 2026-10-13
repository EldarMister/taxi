# Dependency evidence and compatibility decisions

Checked on 13 October 2026 local time (12 October UTC) against `https://registry.npmjs.org` and the linked primary advisories. The original checkout and its newer uncommitted changes were not touched. An explicitly authorized follow-up used the current read-only Railway helper to inspect installed metadata in the designated **DEV** container and aggregate configured review-account roles. No service deployment, signing service or production resource was changed.

## Fresh audit results

Counts are affected dependency packages, including propagated findings; they are not counts of independent CVEs. Both mobile trees derive their high findings from **two** vulnerable leaves, `braces` and `node-forge`.

| Checkout/package | High | Moderate | Critical | Actual check |
| --- | ---: | ---: | ---: | --- |
| MAIN root tooling | 0 | 0 | 0 | fresh npm audit |
| MAIN server before this follow-up | 0 | 10 | 0 | fresh npm audit |
| MAIN server after scoped YAML correction | 0 | 8 | 0 | fresh npm audit |
| MAIN mobile | 22 | 17 | 0 | fresh npm audit |
| MAIN web | 0 | 0 | 0 | fresh npm audit |
| REST root tooling | 0 | 0 | 0 | fresh npm audit |
| REST restaurant app | 21 | 12 | 0 | fresh npm audit |

The audits used the lockfiles and retained all findings. Present installed packages matched their lock versions; MAIN missing lock entries were optional dependencies, with no present-version mismatch. No advisory suppression, audit disable, Expo/RN downgrade or framework-major update was applied. Native signing, distribution and OTA behavior were not inferred from absence in a JavaScript bundle.

MAIN original refresh evidence is under `.local/dependency-review/2026-10-12T21-40-03.060Z-cd5dab67-c79a-4cdc-b896-4ff0cf2808a9`; the post-correction server audit is under `2026-10-12T21-47-30.703Z-a3b6e458-ab1b-48de-a603-b0e55d303351`. REST valid reports and exact lock chains are under `.local/security-audit/dependency-review-20261013-034051-2c3527fdf1194fbd90406c42b642ac8a`. Earlier attempts, including the REST npm-config loading error, remain preserved separately from valid results.

## Confirmed leaves and available releases

| Leaf and installed version | Advisory status | Registry evidence and decision |
| --- | --- | --- |
| `braces 3.0.3`, both mobile apps | High, affected through 3.0.3; no published patched release | Latest remains 3.0.3, published 21 May 2024. No eligible version-only fix. [Primary advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [registry](https://registry.npmjs.org/braces). |
| `node-forge 1.4.0`, both mobile apps | High, affected through 1.4.0; no published patched release | Latest remains 1.4.0, published 24 March 2026. The earlier signature fix is incomplete for this advisory. [Primary advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [registry](https://registry.npmjs.org/node-forge). |
| `sprintf-js 1.0.3`, both mobile apps | Moderate, affected through 1.1.3; no published patched release | Latest 1.1.3, published 11 September 2023, is still affected. Updating this leaf to latest does not fix it. [Primary advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c), [registry](https://registry.npmjs.org/sprintf-js). |
| `uuid 7.0.3` mobile; `9.0.1` optional server chains | Moderate; affected buffer-accepting v3/v5/v6 APIs below 11.1.1 | Patched 11.1.1 was published 29 April 2026. It is a major-version change from the installed versions, requiring parent compatibility proof. [Primary advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq), [registry](https://registry.npmjs.org/uuid). |
| Server `js-yaml 5.3.0` before correction | Moderate empty-merge CPU-budget bypass, affected 5.0.0–5.4.0 | Patched from 5.4.1; selected 5.4.3, published 5 October 2026. [Maintainer advisory](https://github.com/advisories/GHSA-r3ph-w7gj-g6xm), [registry](https://registry.npmjs.org/js-yaml). |

The advisories were checked directly: braces was updated 2 October, forge 1 October, sprintf 5 October and the YAML advisory 29 September 2026. This snapshot must be refreshed for any later release candidate.

## YAML correction: fixed and behavior verified

Only MAIN `server/package.json`, `server/package-lock.json`, and the new `server/test/swagger-serialization.test.ts` were changed in this follow-up. The parent-scoped override is:

```json
"@nestjs/swagger": { "js-yaml": "5.4.3" }
```

Swagger 11.4.7 declares an **exact** `js-yaml: "5.3.0"` dependency. This override deliberately crosses that pin; it is **not declared-semver compatibility**. The compatibility risk was explicitly approved after disclosure. Swagger 11.4.7 remains unchanged. Comparing the updated lock to the immutable `d203` recovery inventory confirmed that only the js-yaml package record changed version, URL and integrity.

Actual checks passed:

- The old installed 5.3.0 passed the JSON/YAML and schema compatibility checks but failed the new empty-merge budget regression, demonstrating the affected behavior.
- Updated 5.4.3 passed **3/3** tests: actual loopback Nest Swagger JSON/YAML endpoint document equality for nested DTOs, Unicode and string examples; dump/load with explicit schemas; and rejection when empty merge sources exceed the configured work budget.
- Prisma 6.19.0 generation and the full server TypeScript build passed.
- Fresh server audit fell from 10 to 8 moderate affected packages; Swagger/js-yaml findings disappeared. High and critical remain zero in the local server tree.

The installed Swagger YAML endpoint uses `dump()`; no application endpoint parsing arbitrary user YAML was established by this review. The package vulnerability was nevertheless fixed rather than hidden. Local tests ran with the explicit Node 24.19.0 runtime. Root then tested the frozen server artifact **inside Railway in an isolated temporary job**, using Node 22.23.3 and PostgreSQL 18.6: **292 unit and 94 integration tests passed**, dependencies installed, build passed, all 32 migrations applied to the owned test database, and the server high-severity audit passed with 0 high/critical and 8 moderate. The temporary database was cleaned. Artifact `sha256:4df892f4786263962966497a665dbcdd0666e176e942363204db61f7f7d0d46a`, run `65412e1c-6530-44bb-9fdb-95579da925b8`, is recorded in private `railway-followup/isolated-status.json` and logs. Its packaging metadata records baseline commit `9b2a986e73ac86e4f74cf1e7c2d3225fe26fa7b2`; the captured source included the security changes subsequently committed as `c5c18f1a77546db9df974eee61d93f32ec3a24f8`. The packaged file manifest must be matched to the intended commit before release. This temporary job did **not** replace the running service. Prior `d203` whole-candidate results do not automatically attest the follow-up candidate.

## CLI, signing, Metro, Jest and OTA paths

Both apps use Expo 54.0.37 and RN 0.81.5. Expo 54.0.37 is the newest published stable 54.0 release as checked; it contains CLI 54.0.27. RN 0.81.6 exists, but its React peer is `^19.1.4`, whereas these apps use React 19.1.0. Therefore even that RN patch is not a drop-in change to the present aligned native stack. Expo latest 57.0.28 and RN latest 0.87.1 are framework migrations, not replacements approved by this patch. [Expo registry](https://registry.npmjs.org/expo), [RN registry](https://registry.npmjs.org/react-native).

Confirmed installed chains and calls:

- Expo 54.0.37 → CLI 54.0.27 → `@expo/code-signing-certificates 0.0.6` → forge 1.4.0; the CLI also depends on forge directly. The signing helper calls certificate/CSR verification and public-key signature verification. Expo development-manifest code signing calls this helper; iOS certificate inspection also parses forge certificates. Signing certificates 0.0.7 still depends on forge, so upgrading that helper alone is not a fix.
- Expo Metro 54.2.0 → Metro file map 0.83.3 → micromatch 4.0.8 → braces 3.0.3; Jest 29.7.0 chains also reach micromatch/braces. Metro's watcher calls micromatch with configured globs. A malicious deeply nested pattern is the relevant input, rather than an ordinary order payload. No external exploit of the application's API was demonstrated by this dependency review.
- RN 0.81.5 → babel-jest 29.7.0 → Istanbul plugin 6.1.1 → `@istanbuljs/load-nyc-config 1.1.0` → js-yaml 3.15.2 → argparse 1.0.10 → sprintf-js 1.0.3. Argparse help/usage formatting calls sprintf. Application-controllable precision format strings were not established, but the installed build/test path remains affected.
- Expo → config plugins 54.0.5 → xcode 3.0.1 → uuid 7.0.3. Inspected xcode code uses `uuid.v4()`, not the advisory's buffer-accepting APIs. The advisory remains visible; future callers and build tools are not covered merely by that current call-site finding.

No direct `expo-updates`/updates-interface dependency, OTA update configuration or application import of the four vulnerable leaves was found in the checked app source and lockfiles. This bounds the observed route; it does **not** prove that installed native distributions, EAS tooling or historical signed OTA artifacts never use related verification code. CLI/signing/Metro/Jest are part of the release and development chain even when omitted from an application bundle.

## Remaining server UUID paths

The local server's remaining eight moderate propagated findings derive from uuid 9.0.1 in Firebase Admin 13.10.0's optional Firestore 7.11.6 and Storage 7.22.0 paths. Declaring parents are google-gax 4.6.1, gaxios 6.7.1 and teeny-request 9.0.0. Their inspected UUID calls are no-argument `v4()`; affected v3/v5/v6 buffer calls were not found in those parents. The application imports only `firebase-admin/app` and `firebase-admin/messaging`; its main authentication path is google-auth-library 10.9.1 → gaxios 7.3.1, without UUID. Optional Firestore/Storage loads are lazy.

Captured Railway compiled code also imports only Firebase app/messaging. The first review left exact installed versions unknown because a manifest range is insufficient. The authorized read-only follow-up resolved that uncertainty with recursive installed-package metadata, rather than inference from the manifest. Blindly omitting all optional dependencies is unsafe because the server also needs optional native dependencies, including Sharp platform binaries.

## Running DEV metadata and review-account scope

At `2026-10-12T21:54:48.490Z`, the designated API container reported Node **22.23.3** and these exact installed versions:

| Package | Running DEV version |
| --- | --- |
| `@nestjs/swagger` | 11.4.7, still pins js-yaml 5.3.0 |
| `js-yaml` | **5.3.0** |
| `firebase-admin` | 13.10.0 |
| `uuid` | **9.0.1** |
| `gaxios` | 6.7.1 at root; 7.3.1 under both gcp-metadata and google-auth-library |
| `google-gax` | 4.6.1 |
| `teeny-request` | 9.0.0 |

Recursive inspection found all nested instances of these selected packages. No package-lock existed at the inspected runtime root/server paths. This was an installed metadata inspection, not a complete fresh audit of every remote package. The running DEV service therefore still contains the affected YAML leaf; the verified 5.4.3 correction exists in the new local/isolated-test candidate and has **not** been installed into that service by this work. Evidence is private `.local/security-audit/railway-followup/runtime-dependencies.json` plus its timestamped copy.

AppConfig contained **3 configured, distinct review entries**; the existing database matched all three. Aggregated selected `role`/`deletedAt` fields showed **2 active CLIENT, 1 active DRIVER, 0 deleted and 0 ADMIN**, with no missing configured user. No phone, code, user identifier or session data was returned, and no account/session mutation occurred. This confirms the current configured account/role boundary; it is not a substitute for the separate authorization, foreign-data and login-scenario regression tests. Login codes and the agreed review scenario were left unchanged.

## Native services, database privileges and backup/network supplement

Authorized read-only observations at `2026-10-12T22:05`–`22:11Z` confirmed:

| Service/version command | Exact observed output |
| --- | --- |
| Nominatim `nominatim --version` | 5.3.2-0 |
| Nominatim `psql --version` | PostgreSQL client utility 16.14, Ubuntu 16.14-0ubuntu0.24.04.1 |
| Nominatim PostgreSQL server executable `--version` | 16.14, same Ubuntu build |
| OSRM `osrm-routed --version` | v26.9.0 |
| Photon `java -version` | OpenJDK 21.0.12, Temurin-21.0.12+8-LTS |

No Nominatim SQL/provider request was performed. The version flags attest the installed executables, not the embedded live PostgreSQL instance through a database query. The Java flag does not attest Photon's own application or index format/version. No environment values, credentials, process logs or dataset contents were collected.

A read-only metadata query from the API connection to the existing main database confirmed **current role superuser=true**, PostgreSQL `ssl=on`, **the actual connection SSL=true**, `archive_mode=off`, `wal_level=replica` and `TimeZone=Etc/UTC`. The broad API database privilege is a confirmed, unchanged least-privilege finding; application/migration role separation needs its own verified implementation step. Native PostgreSQL WAL archiving was off at observation time. This does not establish whether independent Railway snapshots or another external backup mechanism is present, nor establish a PITR/RPO guarantee.

Only top-level filenames matching dump/SQL/backup suffixes were listed in `/var/lib/postgresql/data`. Five `.dump` filenames were present, including one naming 8 October 2026; no contents, dump headers, sizes or restore behavior were read. Filenames are **not** proof of successful backup, freshness, independent storage or recovery. No dump was created, downloaded, restored, deleted or changed. These files share the observed PostgreSQL volume; no independent failure domain was established by this listing.

Fresh read-only GraphQL configuration at `22:11:19.606Z` returned **one private network, zero TCP proxies for all six services**, and public HTTP service domains only for API and website. Nominatim, main Postgres, OSRM and Photon had no custom/service HTTP domain or TCP proxy configured in that inventory. The environment's Railway label is `production`, while the user explicitly designated these services as their current DEV environment; the label does not revoke that designation or establish readiness for a future production release. Routing metadata was inspected without connectivity/port probes or changes to DNS/networking. Intermediate management/schema-read errors are retained as management observations, not application failures.

Cookie-domain behavior remains a separate, unperformed browser check. The current [official Public Suffix List](https://publicsuffix.org/list/public_suffix_list.dat) includes `up.railway.app`, making the observed website and API hostnames separate sites under that rule. The candidate sets the browser refresh cookie to `SameSite=Strict`. If the browser calls the API hostname directly, this requires cross-site cookie-flow validation; a same-origin reverse proxy changes the browser-facing path. This is a compatibility inference from metadata/source, **not an observed browser failure**, and neither cookie settings nor DNS were changed.

Private evidence is consolidated in `.local/security-audit/railway-followup/service-security-supplement.json`, with raw selected records `supplemental-runtime-readonly.json`, `nominatim-postgres-binary-version.json`, `maps-binary-versions.json` and `network-inventory-readonly.json`. No tracked application source or runtime setting changed during this supplement. Full service/volume restoration and production RPO/RTO remain outside the demonstrated local recovery scope.

## Safe next alternatives and required evidence

None of these alternatives was silently applied:

1. Parent-scoped `xcode → uuid 11.1.1` can be investigated: the published package retains CommonJS and v4, but it crosses xcode's declared major range. Validate project parsing, identifier generation, project writing and Expo config/prebuild behavior before adopting it; native builds/signing remain a separate check.
2. Parent-scoped `@istanbuljs/load-nyc-config → js-yaml 4.3.2` can remove its argparse/sprintf chain. The parent uses the retained `load()` API and v4 uses argparse 2, but it crosses the parent's `^3.13.1` declaration. Validate YAML include/extends, Babel coverage/Jest and actual Metro exports. This does not remove braces or forge.
3. For the unpatched high leaves, use an upstream-reviewed fix or a maintained, reproducibly pinned fork with focused deep-pattern and malformed-signature regression vectors, plus CLI/signing/Metro/native validation. Such a source-level substitution needs review; changing a version label or suppressing the advisory is not an acceptable closure. A temporary private build/DEV boundary can reduce exposure while keeping the failed audit explicit.
4. A coordinated supported Expo/RN migration is a separate candidate, requiring aligned Expo/native packages, React/test renderer, application tests, actual signed native builds and OTA verification. It is not justified merely by npm's suggestion. `audit fix --force` proposes Expo 44.0.6 for these trees, an unsafe downgrade that was rejected.

Current status: YAML is **confirmed → fixed → behavior verified locally**. Braces/forge/sprintf and UUID installed-chain findings are **confirmed and not fully fixed**; input reachability boundaries are observations, not advisory closure. The mobile high gate remains blocked, and new source/lock candidates require all mandatory checks for the exact candidate.

## Rollback and restoration compatibility safeguards

Root's separate Railway collection identified the running DEV artifact and matched its compiled code to the reconstructed prior candidate; Git commit attestation is absent. That provenance result does not make the historical server a safe rollback after new schema/data/authentication contracts appear.

Before any separately authorized release or rollback, preserve and identify the exact server image, web/admin assets, native-client versions, lockfiles, migration checksums, runtime configuration and required data volumes. Rehearse the rollback against a clone containing new catalog data, browser sessions and pending outbox rows; keep additive tables/fields and audit data rather than treating an old image as permission to reverse migrations. Verify old/new capability cache separation and server-side canonical pricing, authorization and idempotency under both client contracts.

The existing local [rollback probe](ROLLBACK-VERIFICATION.md) found literal main's wrong PER_ITEM price/required-option handling, the reconstructed prior server's legacy-capability exposure, missing browser-cookie routes and browser/mobile refresh-channel incompatibility. Returning to that historical deployment would also omit the new outbox worker's durability path. A compatible patched rollback artifact must close those gaps and retain/recover queued events; it must include a matching admin asset bundle and must not revive a refresh-channel bypass.

The actual [local recovery drill](SECURITY-RECOVERY.md) proves the measured database/file/configuration/app scope for `d203`, not full recovery of Railway services or the YAML follow-up candidate. A new release requires recovery coverage for its same immutable artifact, production or separately designated DEV keys, required OSRM/Nominatim volumes, dependencies and operational clock, plus observed RPO/RTO and independently stored keys. Current service UTC confirmation belongs to the designated DEV environment; it must not automatically be attributed to an unrelated future production database. No backup/PITR setting, paid resource or deployment was changed by this task.
