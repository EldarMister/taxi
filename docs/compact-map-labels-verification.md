# Compact map bubbles and named territories — 2026-10-15

Release: 1.2.38 / 150, client and driver.

## Changes

- Endpoint icons are 44dp instead of 52dp. Information blocks take their width from the text, with a maximum for long names. Native Android measurements: pickup 98.86dp, destination 123.43dp, focused pickup 153.14dp, focused destination 181.14dp. Previously regular/focused blocks occupied 198/244dp.
- The 360×112 bitmap canvas, geographic ground (130,104), native anchor and PointAnnotation renderer remain unchanged. Live selection pins retain their ground too.
- DriverNavigation no longer adds a speed-limit sign below the left maneuver instruction. RoadFeatureAlerts keeps the right-hand signs and distances.
- Named kindergarten and market/retail territories have one dedicated label layer from zoom 14, with Russian/Kyrgyz names, collision handling and both themes.

## Missing names: cause and data

Shortbread's land/site geometry does not carry territory names, and kindergarten POIs are absent from the checked tiles. The OpenMapTiles kindergarten POI names were also hidden by the switch to Shortbread at zoom 14. For example, Teremok's name exists in the OpenMapTiles `poi` layer, but the market's `landuse=retail` name is absent from both vector sources.

`mobile/src/native/site-labels.json` is a 98,640-byte OSM snapshot with 520 named objects across Kyrgyzstan. It contains only OSM names and interior points, retaining OSM object IDs. Unnamed grounds receive no invented labels. Data © OpenStreetMap contributors, licensed under [ODbL 1.0](https://www.openstreetmap.org/copyright); the existing in-app attribution applies. Snapshot labels replace kindergarten/marketplace POIs in the detailed vector layer to avoid showing both copies.

Inputs:

- [Geofabrik Kyrgyzstan extract](https://download.geofabrik.de/asia/kyrgyzstan.html), local `kyrgyzstan-20261014.osm.pbf`, SHA256 `c02eb4913703d35facd7805462188dc3cf4a8f9a30dbe2a96b6b80683733df2a`.
- Verified OSM XML extracts fetched October 15: bbox `72.168,41.187,72.188,41.207` (SHA256 `6fd86783e7226d21f24b2cb3ef320652f8272bc4b4de9d868e8760d977228c37`) and bbox `72.178,41.194,72.191,41.198` (SHA256 `ebb90f477d1b227b3a72b66e5823058bcc20ebbd0b62fcaf46bab7c0a57c8ccf9`). These supplement the daily extract with newer mapped objects.
- Verified examples: [market 1561788162](https://www.openstreetmap.org/way/1561788162), [Teremok 1557365207](https://www.openstreetmap.org/way/1557365207), [Umut 219427676](https://www.openstreetmap.org/way/219427676).

The snapshot is bundled, not a live lookup. Refresh it when updating map data:

```powershell
python -m pip install osmium shapely
python mobile/scripts/build-site-labels.py kyrgyzstan-latest.osm.pbf --overlay newer-area.osm
python mobile/tests/site-labels-builder.test.py
```

Overlays are optional complete OSM XML extracts with their referenced nodes. Labels use polygon interior points, not bounding-box centers. Running against the same inputs produces identical output.

## Verification

- Mobile TypeScript passed; 145 focused native/map/navigation tests passed; 2 Python generator tests passed.
- Snapshot regenerated identically from the inputs above (SHA256 `af6b256c04dd075578e1a5900550f0e42cedb0e44414feae195eae5ec47117fe`).
- Android native screenshots checked normal and focused compact bubbles. MapLibre displayed `Рынок` and `Детский сад теремок` in Russian, and `Базар` / `Теремок бала бакчасы` in Kyrgyz, in light and dark themes.
- Local screenshots: `.local/compact-shamaldy-initial.png`, `.local/compact-focused-settled.png`, `.local/site-labels-native-light.png`, `.local/site-labels-native-dark.png`, `.local/site-labels-native-ky.png`.
- Emulator visual checks use the existing debug-only Vulkan build because of the documented SwiftShader/OpenGL symbol issue. Production APKs use the default OpenGL SDK.

These changes are bundled in the apps; no API/server changes are required.

## Release artifacts

Both signed arm64 APKs passed package/version, certificate, role, permissions, production API, current bundled-source and native anchor-patch checks. All 520 site IDs and their names were verified inside each final Hermes bundle.

- Client: Atlas-client-1.2.38-arm64.apk, 95,639,522 bytes, SHA256 f11b9baf605eb84bd35e7a9cff2ac6abbe04763882b0014632a793632f55cbc9.
- Driver: Atlas-driver-1.2.38-arm64.apk, 95,639,718 bytes, SHA256 95a35584b6a544cb07afe06f9d93ae68d8f53c34452ebf3497ac99f7f858c5e4.
- Both release dependency reports select android-sdk-opengl 11.12.1. Local verification report: .local/endpoint-1.2.38-apks-proof.json.
