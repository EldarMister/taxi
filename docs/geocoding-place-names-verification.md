# Geocoded place names — 1.1.97

Implemented and deployed on 2026-10-06.

The Photon and Nominatim parsers previously preferred the road field over the name of a venue. Results could match a shop, mall or hotel by name but display only its street. Both parsers now preserve a distinct provider-supplied venue name alongside the road, house number and town. Named bus stops are also preserved; ordinary road results, duplicate road/city names and numeric building labels are not treated as venues. Coordinates, OSM identities, authorization, rate limits and the API shape remain unchanged.

The existing address picker shows the real venue name as its primary line and the road/address underneath. Selection retains the complete named address. No extra fields are added to the Point or order request, so the strict order API remains compatible with existing binaries. Missing provider names are not fabricated.

Checks:

- Server TypeScript compilation passed; all 24 maps/geocoding tests passed.
- Mobile typecheck and all 17 address formatting/search/UI-contract tests passed, including result presentation, selected coordinates, stale search responses and reopening a selected address.
- Railway production deployment `916dff1b-d9f2-4711-a2e5-faf783385cf9` completed successfully. User/order counts and deposit totals matched predeployment values; no schema migration was added.
- Authenticated checks through `https://api-production-47be.up.railway.app/api` verified actual results for Asia Mall, Bishkek Park and Globus with their original OSM IDs and coordinates. Reverse geocoding retained the actual nearest named object and original pin coordinates. Unauthenticated search remained HTTP 401. Temporary verification sessions were deleted afterward.
- Android native visual verification at 360 dp used the real address picker and public production geocoding through a local read-only relay. The venue appeared above its street, selection retained its full address, and reopening kept its name in the input. The relay and temporary native session were removed and the prior preview host restored.

Screenshots: `screenshots/geocoding-place-name-search-360.png`, `screenshots/geocoding-place-name-selected-360.png`.

Release APKs: Atlas client and Atlas pro driver 1.1.97 (versionCode 108), both arm64-v8a only. Both Gradle release builds passed. Android manifest/package identities, signature continuity, production API, real release entry and packaged food artwork were verified. SHA-256 hashes are recorded in `mobile/builds/apk-1.1.97-arm64-manifest.json`. ARM APKs were not installed in the x86 emulator; native screenshots used its existing development binary with the actual updated components.
