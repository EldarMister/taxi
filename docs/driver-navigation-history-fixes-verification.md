# Driver navigation and history fixes — 1.1.95

The existing work was committed and pushed before new edits: `8ca0a57` on `codex/driver-road-signs`.

- Driver bottom tabs now remain available on history, profile, settings and balance. The trip screen still hides tabs while handling offers, active trips or an unrated completed trip.
- Today's graph covers only the selected Bishkek calendar day, in eight contiguous three-hour intervals. Week and month graphs retain their respective date ranges. Selecting an hourly bar highlights that interval without changing the selected day or daily totals.
- Older servers rejecting `from`/`to` are handled with their supported `period=all` query and local filtering. Authentication, network and unrelated validation errors do not trigger this fallback. Original signed commissions are read from ledger operations when missing from legacy order responses; unavailable commissions are shown as unavailable, never estimated.
- An older server may return only its latest 100 orders. If that cap makes the selected period incomplete, the screen explicitly reports it. Full arbitrary-date history requires the newer server range contract already present in this repository.
- Delivery is expanded on every settings mount, including returning after collapsing it. Existing independent delivery switches and saved values remain unchanged.
- Only `mobile/assets/home/service-food.png` was replaced: black courier bag with the original white ATLAS logo and burger on the right. Other artwork and card layout are unchanged.

Checks: mobile typecheck; 34 driver history/account/variant tests; 1 UI contract test; existing service-home test. All passed.

Native visual checks at 360 dp used the actual account components, actual local API data and a preview host containing the bottom-tab markup from App.tsx. History, profile, balance and settings all retained visible tabs. Delivery was expanded after leaving and reopening settings. Screenshots:

- `screenshots/driver-history-hourly-navbar-360.png`
- `screenshots/driver-profile-navbar-360.png`
- `screenshots/driver-settings-expanded-navbar-360.png`
- `screenshots/driver-balance-navbar-360.png`

Release APKs: Atlas client and Atlas pro driver 1.1.95 (106), built with `-PreactNativeArchitectures=arm64-v8a`. Both Gradle release builds and Android signature checks passed. APK package identities and versions verified; ZIP native library inspection confirmed only arm64-v8a. Production API and production entry confirmed. The new food artwork was checked against the packaged image using identical decoded visible pixels and alpha, allowing AAPT's lossless PNG encoding changes. Signer matches preceding APKs. ARM APKs were not installed in the x86 emulator; native preview checks used its existing development binary.

## Production API update — 2026-10-05

Railway production API was updated successfully: deployment `04ddc3d8-6d04-4623-b2a0-efd3400d7677`, project `taxi-go`, service `api`. Its public URL remains `https://api-production-47be.up.railway.app`. The prior Git push did not trigger this separately managed CLI deployment.

Migration `20261005120000_driver_food_preferences` was applied. Existing car-delivery values were preserved; the separate food-delivery preference defaults to false only for records without a saved value. A PostgreSQL backup was captured and validated before deployment. User and order counts and the aggregate driver deposit were unchanged afterward.

Server build and all 9 targeted history/preferences tests passed. Authenticated requests through the public production API for today, week, month and an arbitrary date range returned 5, 22, 16 and 73 orders respectively, matching read-only database queries exactly, including original signed commissions. Invalid inverted dates were rejected with HTTP 400. The preference is exposed through the real user API and accepted independently by the preferences DTO. The temporary verification session was removed afterward.

Driver history queries for an explicit date range no longer have the legacy 100-order cap. The greater-than-100 case was covered by a local 106-order test fixture; production verification used existing real records. The legacy fallback remains available for older servers, but this production API now supports the range contract directly. Existing 1.1.95 APKs already point to this API and require no rebuild for the server update.
