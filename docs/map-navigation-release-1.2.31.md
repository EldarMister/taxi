# Atlas 1.2.31 / Android 143

## Artifacts

Both signed production APKs target ARM64:

- `mobile/builds/Atlas-client-1.2.31-arm64.apk` — `atlas.kg`, Atlas, 95,513,146 bytes. SHA-256: `697e002316f62ea4befd6469992b849a8cd0d0c3af4cd8d6251b9645cfb9c662`.
- `mobile/builds/Atlas-driver-1.2.31-arm64.apk` — `atlas.pro`, Atlas pro, 95,513,338 bytes. SHA-256: `27b1cbcea21faac2deaf5a220a1adc92ff883925700748452c8952bc651b97ee`.

APK signatures verified with Android apksigner. Signing certificate matches 1.2.30 for both applications: `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. Runtime variant, package, EAS project, version and role-specific background location permission verified. Embedded Hermes bundles match the retained release bundles. Source maps confirm all 12 map/navigation source files match the current workspace in both APKs.

## Included changes

Ordinary crossings and crossing geometry aligned to rendered roads; map cameras and arbitrary real speed limits; current road-section limit and route warnings; sharp/slight maneuver arrows and voice instructions; reduced duplicate street labels and collisions; organizations/address density balanced across zoom levels. See `map-navigation-road-features-verification.md` and `map-label-density-verification.md` for implementation and visual checks.

## Server deployment

Railway API deployment `ae710e44-05ed-4535-b006-3967734b52b8` completed successfully. Public `/api/health` returned 200. Before deployment, a PostgreSQL backup was downloaded and its archive format/list validated.

Release staging used the deployed role-identity baseline. Hash comparisons confirmed only `dist/src/road-features.js`, `dist/src/routes.js` and `data/road-features-kg.json` changed among 107 deployed runtime/data/schema files. All 104 remaining files and database migration records were preserved. Startup reported no pending migrations.

The new APKs negotiate `road-features-v2` through `X-Atlas-Capabilities`. Older APKs retain compatible map and warning feature kinds. No global client header or unrelated server module was changed for negotiation.

Authenticated public API verification returned 1,053 crossings, 492 signals, 46 cameras and 175 speed-limit features in the test Bishkek viewport. A real OSRM route returned 32 geometry points, four maneuvers with modifiers, and 24 route warnings. New runtime and snapshot hashes match the staged release. Both legacy endpoint responses were verified. The temporary verification session was removed and its token rejected afterward.

## Validation

- Mobile: 183 tests passed; TypeScript check passed.
- Staged server: 36 map, routing, road-feature and HTTP negotiation tests passed; production compilation passed.
- APK package/signature/source verification passed for both variants.
- Real device installation, GPS navigation and audible playback were not exercised during this release operation.

Machine-readable local verification records: `.local/map-release-production-proof.json`, `.local/map-release-stage-proof.json` and `.local/map-navigation-{client,driver}-apk-proof.json`. Credentials and database backups remain outside these documents.
