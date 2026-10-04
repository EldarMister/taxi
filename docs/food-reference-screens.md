# Food delivery reference implementation

References: all 15 files in `designe/еда`, supplied on 2026-10-04.

| Reference | Implementation |
| --- | --- |
| Главный экран; главный экран при скролле; главный экран при скролле 2 | `CatalogScreens.tsx`: restaurant advertisements, illustrated category rail, restaurant photo carousels, favorites, delivery badges, yellow cart action |
| Фильтры; фильтры при скролле | `FoodFiltersSheet.tsx`: dish/cuisine grids, offers, rating/speed sorting, reset/apply |
| Экран кафе; внешние карточки блюда | Restaurant title/metadata, offer strip, sticky menu tabs, two-column `DishCard` grid, delivery progress/footer |
| Карточка блюда и выбор варианта; экран блюда; вам может понравиться | `DishScreen.tsx` / `DishSheet.tsx`: photo, description/composition/nutrition when supplied, option groups, recommendations, pinned quantity and add action |
| Корзина; корзина2 | `CheckoutScreens.tsx`: restaurant cart, quantities, cutlery, restaurant comment, recommendations, total and delivery conditions |
| Комментарий ресторану | Editable comment sheet saved into checkout state |
| Оформление заказа | Delivery-only checkout, address details, recipient/courier instructions, available payment methods, price breakdown |
| Экран выбора адреса | `FoodAddressPicker.tsx` and the same native `TaxiMap.tsx` used by taxi/courier delivery, with a food-specific panel and pin |

Food destination coordinates and address details are separate from the taxi pickup.
Cancelling address editing retains the previously confirmed destination. An old
search/GPS response cannot overwrite a newer choice. Search reuses `AddressPicker`
and the existing authenticated geocoder. Native map gestures, tiles, localization
and GPS controls remain shared.

Self pickup is absent from the new food flow and every new submission uses
`DELIVERY`. Legacy order types remain readable. Additional restaurant/courier
instructions are formatted into the existing order comment API; the full combined
limit is checked before submission. Old plain courier comments keep their request
signature so a lost-response retry after an upgrade retains its idempotency key.

Restaurant ads use configured active `RESTAURANT` banners linked to a catalog
restaurant. When none are configured, the four explicitly marked demo restaurants
have local advertising compositions with their names and dishes, without invented
monetary promotions. The rail alternates wide and square creatives as in the
reference. Taxi/general service banners stay on the service home. Prices, ETA,
delivery thresholds, offers and payment availability come from the catalog.

Category artwork comes from the supplied references; it is clipped to illustrations
inside native controls. Food headings use bundled Oswald Bold with its SIL Open
Font License in `mobile/assets/fonts/Oswald-LICENSE.txt`. The font source is
[@expo-google-fonts/oswald](https://github.com/expo/google-fonts/tree/master/font-packages/oswald).

The temporary React Native Web preview imports production food components and uses
local state only. Its native sheet wrapper is static: browser screenshots verify
layout, not Android/iOS gesture behavior. The native sheet, map and order flows are
covered by component/state tests. No real orders were placed and no deployment was
performed.

Final verification (2026-10-04): mobile TypeScript check and Android Metro/Hermes
export passed; all 86 food tests, 48 map tests and 16 server content/food tests
passed. Server TypeScript build passed. Browser checks covered 393×852 and 320×680,
including the restaurant's pinned navigation, working menu search, filters, cart
and checkout. Native device visual/gesture verification has not been performed.

User correction, 2026-10-04:

- Favorites is restored in the catalog's top navigation.
- Restaurant offer cards are replaced by small discount/delivery labels matching
  the exterior restaurant card; the menu starts directly below them.
- Checkout uses a consistent 50×32 switch with a 28 px white thumb and yellow
  checked state. Filter choices use the reference's circular check indicators.
- Four demo menus now contain 12 dishes each, preserving existing IDs and prices.
- Restaurant covers and menu photographs use individual real photographs from
  the internet in `mobile/assets/food/photography/real`, replacing the generated
  sprite sheets. Sources and attribution are in `photography/SOURCES.md` and
  `photography/sources.json`. `FoodPhoto` preserves aspect ratio and supports
  presentation-only framing; uploaded merchant photographs retain priority.
- `npm --prefix server run db:seed:food` updates only pristine legacy demo menus
  in a local development database, preserving customized/real merchants. It was
  not executed because the configured database at port 55432 is unavailable;
  no remote database was modified. The preview uses the new source catalog.
- Updated verification: 89 food tests and 18 server content/food tests passed,
  mobile typecheck and Android Metro/Hermes export passed. Browser checks verified
  the new ads, restaurant labels, full-dish photography and both switch states.
  Screenshots use the native components with preview adaptations for sheets,
  Reanimated and Expo gradients; they do not verify native animation rendering.

Photography correction, 2026-10-04:

- Removed all five generated food sprite sheets and their prompt document.
- Bundled 48 individual internet photo files with source records; every one of
  the 48 demo dishes and four restaurant covers resolves to a verified local file.
- Original proportions are preserved. Long nigiri photos fit within their card;
  the wrap and oromo use explicit framing to keep the dish in view.
- Verification: all 89 food tests, mobile typecheck, and Android Metro/Hermes
  export passed. Browser preview checked catalog, restaurant and dish photos.
