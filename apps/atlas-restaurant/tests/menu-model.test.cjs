const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, requireStub = () => ({})) {
  const exports = {};
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(js, { exports, require: requireStub, console, Date, Math, URL });
  return exports;
}
const menu = load(path.join(__dirname, '../src/features/menu/model.ts'));
// Run the unchanged server validator as the contract authority, with only its framework exception classes stubbed.
const server = load(path.join(__dirname, '../../../server/src/content-domain.ts'), name => name === '@nestjs/common' ? { BadRequestException: Error, ConflictException: Error } : {});
const serverPromotions = load(path.join(__dirname, '../../../server/src/food-promotions.ts'));
const plain = value => JSON.parse(JSON.stringify(value));
const base = () => ({ id: 'kitchen-a', name: 'Kitchen A', cuisine: 'Национальная', categories: ['Горячее'], address: 'Кочкор-Ата', phone: '+996700000001',
  imageKey: 'kitchen-a', heroImageKey: 'kitchen-a-cover', rating: 4.8, reviewCount: 43, etaMin: 20, etaMax: 40, deliveryFee: 100, minimumOrder: 0, isDemo: false, isOpen: true,
  menuCategories: ['Горячее', 'Напитки'], options: [{ id: 'sauce', name: 'Соус', price: 10, imageKey: 'sauce', priceScope: 'PER_PORTION' }],
  dishes: [{ id: 'manti', name: 'Манты', category: 'Горячее', description: 'С говядиной', portion: '5 шт.', weightGrams: 350, price: 340, imageKey: 'manti', heroImageKey: 'manti-hero', available: true, optionIds: ['sauce'] }],
  promotions: [{ id: 'p1', title: 'Скидка', type: 'PERCENT', value: 10, minSubtotal: 0, dishIds: [], active: false }],
});

test('creates a photo dish with ingredients, nutrition and required/default modifiers accepted by the real backend', () => {
  const catalog = base(), draft = menu.createDishDraft(catalog);
  Object.assign(draft, { name: 'Плов', price: '380', weightGrams: '350', portion: '1 порция', ingredients: 'Рис, мясо, морковь', imageUrl: '/api/content/media/12345678-1234-1234-1234-123456789abc',
    heroImageUrl: 'https://images.example.test/plov.jpg', calories: '700', nutrition: true, nutritionCalories: '200', protein: '8,4', fat: '11.2', carbohydrates: '23', estimated: true });
  draft.groups = [{ id: 'portion', name: 'Размер порции', minText: '1', maxText: '1', options: [{ id: 'large', name: 'Большая', price: 100, priceText: '100', imageKey: '', selectedByDefault: true }] }];
  const next = menu.saveDishInCatalog(catalog, draft);
  const validated = server.validateRestaurantCatalog(plain(next), catalog.id, false);
  const dish = validated.dishes[1];
  assert.equal(dish.nutritionPer100g.protein, 8.4);
  assert.equal(dish.imageUrl, draft.imageUrl);
  assert.deepEqual(plain(dish.defaultOptionIds), ['large']);
  assert.equal(dish.optionGroups[0].minSelected, 1);
  assert.deepEqual(plain(next.promotions), catalog.promotions);
  assert.equal(next.rating, catalog.rating);
  assert.equal(catalog.dishes.length, 1, 'does not mutate current catalog');
});

test('editing dish fields retains identities, existing photography and review values', () => {
  const catalog = base(); Object.assign(catalog.dishes[0], { ratingPercent: 98, reviewCount: 9 });
  const draft = menu.createDishDraft(catalog, catalog.dishes[0]); draft.price = '360';
  const next = menu.saveDishInCatalog(catalog, draft);
  server.validateRestaurantCatalog(plain(next), catalog.id, false);
  assert.equal(next.dishes[0].id, 'manti'); assert.equal(next.dishes[0].imageKey, 'manti');
  assert.equal(next.dishes[0].heroImageKey, 'manti-hero'); assert.equal(next.dishes[0].ratingPercent, 98);
  assert.equal(next.dishes[0].reviewCount, 9); assert.equal(next.dishes.length, 1);
});

test('editing a shared modifier forks its ID without changing another dish', () => {
  const catalog = base(); catalog.dishes.push({ ...catalog.dishes[0], id: 'other-dish' });
  const draft = menu.createDishDraft(catalog, catalog.dishes[0]); draft.groups[0].options[0].priceText = '25';
  const next = menu.saveDishInCatalog(catalog, draft);
  assert.equal(next.dishes[1].optionIds[0], 'sauce');
  assert.equal(next.options.find(option => option.id === 'sauce').price, 10);
  assert.notEqual(next.dishes[0].optionIds[0], 'sauce');
  assert.equal(next.options.find(option => option.id === next.dishes[0].optionIds[0]).price, 25);
  server.validateRestaurantCatalog(plain(next), catalog.id, false);
});

test('unchanged shared modifiers keep their IDs and default price scope', () => {
  const catalog = base(); catalog.dishes.push({ ...catalog.dishes[0], id: 'other-dish' });
  const draft = menu.createDishDraft(catalog, catalog.dishes[0]);
  const next = menu.saveDishInCatalog(catalog, draft);
  assert.equal(next.dishes[0].optionIds[0], 'sauce'); assert.equal(next.options.length, 1);
});

test('category rename moves dish references, preserves promotions and rejects collisions', () => {
  const catalog = base(), renamed = menu.renameCategory(catalog, 'Горячее', 'Основное');
  assert.equal(renamed.menuCategories[0], 'Основное'); assert.equal(renamed.dishes[0].category, 'Основное');
  assert.deepEqual(plain(renamed.promotions), catalog.promotions);
  assert.throws(() => menu.renameCategory(catalog, 'Горячее', 'Напитки'), /уже существует/);
  server.validateRestaurantCatalog(plain(renamed), catalog.id, false);
});

test('category removal requires empty category and never silently deletes dishes', () => {
  const catalog = base();
  assert.throws(() => menu.deleteCategory(catalog, 'Горячее'), /перенесите/);
  const next = menu.deleteCategory(catalog, 'Напитки');
  assert.equal(next.dishes.length, 1); assert.equal(next.menuCategories.length, 1);
});

test('deleting a dish referenced by a promotion is blocked to preserve permission boundaries', () => {
  const catalog = base(); catalog.promotions[0].dishIds = ['manti'];
  assert.throws(() => menu.deleteDish(catalog, 'manti'), /участвует в акции/);
  catalog.promotions[0].dishIds = [];
  const next = menu.deleteDish(catalog, 'manti');
  assert.equal(next.dishes.length, 0); assert.equal(next.options.length, 1);
});

test('dish validation rejects unsupported decimal prices and incomplete nutrition', () => {
  const catalog = base(), draft = menu.createDishDraft(catalog, catalog.dishes[0]);
  draft.price = '100.5'; assert.throws(() => menu.buildDish(draft, catalog), /целое/);
  draft.price = '100'; draft.nutrition = true; assert.throws(() => menu.buildDish(draft, catalog), /Ккал/);
  draft.nutrition = false; draft.originalPrice = '99'; assert.throws(() => menu.buildDish(draft, catalog), /Старая цена/);
});

test('modifier validation enforces limits, defaults and distinct required choices', () => {
  const catalog = base(), draft = menu.createDishDraft(catalog, catalog.dishes[0]);
  draft.groups[0].minText = '2'; assert.throws(() => menu.buildDish(draft, catalog), /Минимальный/);
  draft.groups[0].minText = '1'; draft.groups[0].maxText = '0'; assert.throws(() => menu.buildDish(draft, catalog), /Минимальный/);
  draft.groups[0].minText = '0'; draft.groups[0].options[0].selectedByDefault = true; assert.throws(() => menu.buildDish(draft, catalog), /по умолчанию/);
  draft.groups[0].maxText = '1'; draft.groups[0].minText = '1'; draft.groups[0].options[0].selectedByDefault = false;
  const built = menu.buildDish(draft, catalog);
  assert.equal(menu.previewOptionsValid(built.dish, []), false);
  assert.equal(menu.previewOptionsValid(built.dish, ['sauce']), true);
});

test('customer preview uses existing per-portion and per-item price semantics', () => {
  const dish = base().dishes[0], options = [{ id: 'portion', price: 10, priceScope: 'PER_PORTION' }, { id: 'item', price: 20, priceScope: 'PER_ITEM' }];
  assert.equal(menu.previewPrice(dish, options, ['portion', 'item'], 3), 340 * 3 + 10 * 3 + 20);
});

test('legacy soy defaults remain selected in client preview after editing', () => {
  const catalog = base(); catalog.options[0].id = 'soy'; catalog.dishes[0].optionIds = ['soy'];
  const draft = menu.createDishDraft(catalog, catalog.dishes[0]);
  assert.equal(draft.groups[0].options[0].selectedByDefault, true);
  assert.deepEqual(plain(menu.buildDish(draft, catalog).dish.defaultOptionIds), ['soy']);
});

test('catalog bound prevents silently exceeding backend modifier capacity', () => {
  const catalog = base(); catalog.options = Array.from({ length: 100 }, (_, i) => ({ id: `o${i}`, name: `Option ${i}`, price: 0, imageKey: '' })); catalog.dishes[0].optionIds = [];
  const draft = menu.createDishDraft(catalog, catalog.dishes[0]);
  draft.groups = [{ id: 'new-group', name: 'Соус', minText: '0', maxText: '1', options: [{ id: 'new-option', name: 'New', price: 0, priceText: '0', imageKey: '', selectedByDefault: false }] }];
  assert.throws(() => menu.saveDishInCatalog(catalog, draft), /100 дополнений/);
});

test('crop remains inside image bounds at every position, orientation and zoom', () => {
  for (const [width, height] of [[4000, 3000], [600, 1600], [1, 1], [3000, 500]]) for (const aspect of [1, 4 / 3]) for (const zoom of [1, 1.5, 3]) for (const x of [-1, 0, .5, 1, 2]) {
    const region = menu.cropRegion(width, height, aspect, zoom, x, 1 - x);
    assert.ok(region.originX >= 0 && region.originY >= 0);
    assert.ok(region.originX + region.width <= width && region.originY + region.height <= height);
    assert.ok(region.width > 0 && region.height > 0);
  }
});

const previewNow = Date.parse('2026-10-11T12:00:00Z');
const promotion = (patch = {}) => ({ id: 'promo', title: 'Offer', type: 'PERCENT', value: 10, minSubtotal: 0, dishIds: [], active: true, ...patch });

test('client preview matches real public catalog pricing for the best non-stacking offer', () => {
  const catalog = base(); Object.assign(catalog.dishes[0], { price: 341, originalPrice: 400 });
  catalog.promotions = [promotion({ value: 17 })];
  assert.equal(menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow).dish.price, 283, 'percentage discount rounds once per dish');
  catalog.promotions = [promotion({ value: 17 }), promotion({ id: 'fixed', type: 'FIXED', value: 70 })];
  const before = plain(catalog), result = menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow);
  const actual = serverPromotions.applyFoodPromotionsForDisplay(catalog, previewNow).dishes[0];
  assert.equal(result.dish.price, 271); assert.equal(result.dish.price, actual.price);
  assert.equal(result.dish.originalPrice, actual.originalPrice); assert.equal(result.discountPercent, 32);
  assert.deepEqual(plain(catalog), before, 'projection does not rewrite the merchant catalog');
});

test('client preview honors active/start inclusive/end exclusive dates exactly like server', () => {
  const cases = [
    { active: false }, { startsAt: '2026-10-11T12:00:00.001Z' }, { startsAt: '2026-10-11T12:00:00.000Z' },
    { endsAt: '2026-10-11T12:00:00.000Z' }, { endsAt: '2026-10-11T12:00:00.001Z' },
  ];
  for (const patch of cases) {
    const catalog = base(); catalog.promotions = [promotion(patch)];
    const result = menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow);
    const actual = serverPromotions.applyFoodPromotionsForDisplay(catalog, previewNow).dishes[0];
    assert.equal(result.dish.price, actual.price, JSON.stringify(patch));
    assert.equal(result.dish.originalPrice, actual.originalPrice, JSON.stringify(patch));
  }
});

test('dish preview does not assume a basket threshold even when quantity would reach it', () => {
  const catalog = base(); catalog.promotions = [promotion({ value: 50, minSubtotal: 500 })];
  const result = menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow);
  assert.equal(result.dish.price, 340); assert.equal(result.hasBasketOffers, true);
  assert.equal(menu.previewPrice(result.dish, [], [], 3), 1020);
  catalog.promotions[0].active = false;
  assert.equal(menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow).hasBasketOffers, false);
});

test('promotions use restaurant-local dish IDs, work for new drafts and do not invent category targeting', () => {
  const catalog = base(); catalog.promotions = [promotion({ value: 50, dishIds: ['manti'] })];
  const source = catalog.dishes[0], newDraft = { ...source, id: 'new-draft' };
  assert.equal(menu.customerPreviewPricing(source, catalog, previewNow).dish.price, 170);
  assert.equal(menu.customerPreviewPricing(newDraft, catalog, previewNow).dish.price, 340);
  assert.equal(menu.customerPreviewPricing({ ...source, category: 'Напитки' }, catalog, previewNow).dish.price, 170);
  assert.equal(menu.customerPreviewPricing(source, { promotions: [] }, previewNow).dish.price, 340);
  catalog.promotions[0].dishIds = [];
  assert.equal(menu.customerPreviewPricing(newDraft, catalog, previewNow).dish.price, 170);
});

test('discounted preview leaves modifiers at full per-item/per-portion prices', () => {
  const catalog = base(); catalog.promotions = [promotion({ value: 50 })];
  const result = menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow);
  const options = [{ id: 'portion', price: 10, priceScope: 'PER_PORTION' }, { id: 'item', price: 20, priceScope: 'PER_ITEM' }];
  assert.equal(menu.previewPrice(result.dish, options, ['portion', 'item'], 3), 170 * 3 + 10 * 3 + 20);
  const draft = menu.createDishDraft(catalog, catalog.dishes[0]);
  assert.equal(menu.saveDishInCatalog(catalog, draft).dishes[0].price, 340, 'preview price never becomes the saved base price');
});

test('free delivery and legacy restaurant badge do not discount dishes; fixed discounts clamp at zero', () => {
  const catalog = base(); catalog.discountPercent = 90;
  catalog.promotions = [promotion({ type: 'FREE_DELIVERY', value: 0 })];
  assert.equal(menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow).dish.price, 340);
  catalog.promotions.push(promotion({ id: 'fixed', type: 'FIXED', value: 500 }));
  const result = menu.customerPreviewPricing(catalog.dishes[0], catalog, previewNow);
  assert.equal(result.dish.price, 0); assert.equal(result.dish.originalPrice, 340); assert.equal(result.discountPercent, 100);
  const actual = serverPromotions.applyFoodPromotionsForDisplay(catalog, previewNow).dishes[0];
  assert.equal(result.dish.price, actual.price);
});
