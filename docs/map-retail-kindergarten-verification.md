# Retail and kindergarten area rendering — 2026-10-15

Checked live OSM XML for Shamaldy-Say and both live vector sources.

- OSM way 1561788162 (market): `landuse=retail`, near 72.17825,41.19601. Present in Shortbread land. The night theme flattened its fill to #1E1E1E, identical to residential ground. Light colors also had little contrast.
- OSM way 1557365207 (Teremok): `amenity=kindergarten`, near 72.17751,41.19961. Present as OpenMapTiles landuse class kindergarten. Shortbread v1 does not provide kindergarten grounds and our supplemental site layers did not draw this class.
- OSM way 219427676 (Umut) is also present in raw OSM. No blanket claim that every kindergarten exists in the external vector snapshots; source refresh dates remain independent from Nominatim/Photon.

Changes: distinct retail/commercial fills and outlines in both themes; retail overview fill until zoom 14, then Shortbread only; kindergarten OpenMapTiles supplemental fill below buildings and roads, retained at detail.

Validation: mobile TypeScript passed; two focused map-style tests passed; real MapLibre source/render queries showed market as retail and Teremok as site-kindergarten after the fix, with no map errors. Before/after previews checked in light and dark. Screenshots: .local/map-area-dark-proof.png and .local/map-area-light-proof.png.

These are bundled mobile style changes; installed APKs need rebuilding to include them. No production server deployment or APK build performed for this request.
