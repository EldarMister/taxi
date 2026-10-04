# Client map panels — 1.1.69

The taxi booking, delivery booking and active client trip summaries previously grew
without a height limit. Larger Android display/text settings could cover most of
the map.

- Limit summary height to 52% of its actual parent map container. Short content
  keeps its natural height; the cap follows display scaling and window resizing.
- Scroll overflowing information inside the panel, keeping booking/arrival/cancel
  actions outside that scroll area. Report the actual outer height to map camera
  padding and existing panel transitions.
- Move delivery's swipe-to-open responder to its title so it cannot intercept
  content scrolling. The options button remains available in the fixed footer.
- Make taxi details and trip details/cancellation content scrollable too.
- Allow booking button labels to fit within two lines and shrink within their
  available width. No global font scaling change, new dependency or driver UI change.

Validation:

- TypeScript check passed; all 70 booking tests passed. Regression checks include
  fixed action callbacks, nested tariff scrolling, updated measured heights,
  theme preservation and delivery gesture ownership.
- Android emulator with real components and local sample data: 412×914 dp at
  normal text scale, 320×711 dp at 1.15 text scale, 360×800 dp at 1.30 text scale.
  At 320×711, taxi panel measured 331 dp (46.6%), delivery 364 dp (51.3%), arrived
  trip 370 dp (52%). At 360×800, taxi panel measured 344 dp (42.9%).
- Manually scrolled the arrived trip to its waiting/fare card; arrival and cancel
  actions stayed visible. Overflow was also exercised at unusually large settings,
  but normal and commonly enlarged layouts are the design target.
- Emulator fixture used a placeholder map, no backend actions or real orders.
  Preview entry was restored before the production build; emulator display/font
  settings restored. Screenshots are under `mobile/.local/panel-*.png`.

Client APK: `mobile/builds/Atlas-client-1.1.69-panels.apk` (versionCode 80).
No server update needed for these layout changes.
