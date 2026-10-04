# Food cards and dish panel

Catalog cards use `DishCard` for the grid and horizontal dish recommendations.
Their frame, photo, two-line title and 38 dp footer stay fixed as cart counts change.
The shared cart caps a dish at 20 portions across its configurations. Catalog `+`
repeats the latest configuration, and `−` removes portions from that configuration.

`DishSheet` has an 83% frame, a scrolling body and a separate 56 dp action footer.
It enters in 420 ms and exits in 360 ms. Gesture Handler and Reanimated 3 run its
drag on the UI thread. A short drag settles with a clamped spring. Reduced motion
uses a 120 ms fade/settle. Content can dismiss only when the drag begins at scroll
offset zero; horizontal motion fails the dismissal recognizer.

## Optional catalog fields

Existing catalogs need no changes. Options without `priceScope` remain priced
per portion. New fields are stored in the restaurant's existing catalog JSON:

```json
{
  "dish": {
    "optionIds": ["small", "large", "box"],
    "defaultOptionIds": [],
    "optionGroups": [
      { "id": "size", "name": "Размер", "optionIds": ["small", "large"], "minSelected": 1, "maxSelected": 1 }
    ]
  },
  "options": [
    { "id": "small", "name": "Маленький", "price": 10, "priceScope": "PER_PORTION" },
    { "id": "large", "name": "Большой", "price": 20, "priceScope": "PER_PORTION" },
    { "id": "box", "name": "Упаковка", "price": 30, "priceScope": "PER_ITEM" }
  ]
}
```

This is a field example, not a replacement restaurant catalog: retain the existing
IDs, images, dish fields and merchant data. Groups must reference the dish's offered
options; use a single group per option. `minSelected` defaults to zero,
`maxSelected` to the group's size. Options outside groups are optional. Explicit
`defaultOptionIds` overrides the legacy initial soy-sauce selection.

The client and server both enforce group selection and calculate
`dish price × quantity + per-portion options × quantity + per-item options`.
Deploy the updated food pricing server before introducing required groups or
per-item prices in production catalog data. No database migration is needed.

Validation: `npm run test:food` and `npm run typecheck` in mobile;
`npx tsx --test test/food.test.ts` and `npx tsc --noEmit` in server.
