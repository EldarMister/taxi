# Restaurant catalog 1.1.78

The restaurant catalog keeps the existing `CartDock` component and its styles,
props, delivery action and cart navigation. The service home and checkout remain
unchanged. Catalog bottom padding reserves the dock height plus a small gap.

`CatalogScreens.tsx` uses a single wide restaurant column, the existing Inter
fonts and project photographs. Search and favorites remain in the top toolbar;
the round filter opens the existing `BottomPanel` with live cuisine choices.
`restaurantDiscovery.ts` derives category names and photographs from the current
catalog. Missing reference categories and offers are not added as placeholders.

`FoodExperience.tsx` passes the existing banner feed and shared favorite state.
Banner actions reuse the same restaurant, food and taxi destinations as the
service home. Built-in illustration banners include their configured title and
subtitle; uploaded posters display their full image without duplicate text.

Validation: all 70 food tests and mobile TypeScript checks pass. A temporary
React Native Web preview rendered the actual catalog components at 393×852 and
320×760 using public API snapshots and existing assets. Search, categories,
filters, favorite toggling, restaurant navigation, add/remove, cart summary and
the last card above the dock were checked. Checkout behavior is covered by the
existing flow tests; no real orders were submitted. Preview screenshots are in
`mobile/screenshots/restaurants-*.jpg`. This preview does not replace a check on
physical Android or iOS hardware.
