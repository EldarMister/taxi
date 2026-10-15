# Endpoint themes, driver letters and continuous bubbles — 2026-10-16

Release 1.2.39 / 151, client and driver.

| Before | After | Why |
| --- | --- | --- |
| Saved passenger endpoints stayed blue at night | White icon surfaces with black pickup/flag glyphs and ETA text | Matches the existing live selection pin |
| Driver pickup used a passenger icon; destination became Б only while offer metrics existed | Explicit driver appearance supplies А and Б in every order phase | Endpoint identity must not depend on a route description |
| Icon and metrics each painted a separate surface | One rounded surface sits behind both, above bitmap shadow halos | No transparent notch or halo strip between icon and details |
| Kindergarten fill #E8EBFA blended into light ground | Fill #D1CBEA and outline #9B90C5 | Distinguishes the mapped territory from buildings and neighboring land |
| Theme reload could query the disposed SymbolManager layer | Cache the layer ID when its manager is created | Prevents `wstring_convert: from_bytes error` in layerAdded during a native style replacement |
| Marker bitmap refresh could run before the new map style finished loading | Pass the completed style revision to both endpoints | Restore current colors/images after style loading without moving coordinates or remounting annotations |

The fixed 360×112 canvas, ground point (130,104), geographic anchor, compact sizing and existing GL renderer are preserved. Layer ordering still changes only on native layer creation, never during pan/zoom frames. The native patch retains source/version guards, previous-patch migration and idempotence.

## Verification

- TypeScript passed.
- 103 focused tests passed: endpoint rendering, map selection, native patch Java regression, route focus and native lifecycle. Coverage includes both passenger night glyphs, black ETA text, driver letters after offer details disappear, one bitmap refresh after a completed style reload, and layer creation while the previous native SymbolManager handle is invalid.
- Android debug build compiled and installed the updated native patch.
- Repeated light/dark switching on Android showed correct client colors in both directions, driver А/Б in both themes and no native style-load exceptions.
- Real Android screenshot of Teremok in Shamaldy-Say confirms the stronger light fill, visible outline and retained name.
- Local proof images: `.local/marker-verified-client-dark.png`, `.local/marker-verified-client-light-return.png`, `.local/marker-verified-driver-offer-dark.png`, `.local/marker-fixed-driver-settled.png`, `.local/marker-kindergarten-visible.png`. Native error log: `.local/marker-verified-native-errors.txt`.
- Visual checks use the existing debug-only Vulkan emulator workaround. Production builds use the default OpenGL SDK.

The temporary QA entry was removed and the production App entry restored before release builds. No server changes are required.

## Final APK verification

Both signed arm64 release APKs passed package, role, version, certificate, permissions, production API, source-map and native-patch checks. Both DEX files include the cached annotation-layer ID. All 520 named sites remain in each final Hermes bundle. Both release reports use OpenGL SDK 11.12.1.

- Client: Atlas-client-1.2.39-arm64.apk, 95,639,706 bytes, SHA256 18dabb97d9f131d3c6ba401b14ab9156f6bfd86dcba55f555c99b4a7c1d2b3aa.
- Driver: Atlas-driver-1.2.39-arm64.apk, 95,639,902 bytes, SHA256 12c0c42d05d297fd75978fe1fe49d8e23179af7eab662aaf58c7c4e0a9ff3447.
- Local artifact report: .local/endpoint-1.2.39-apks-proof.json.

Native screenshot pixels confirm the kindergarten fill changed from RGB (232,235,250) to (209,203,234), against surrounding ground (240,244,248).
