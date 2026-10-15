import assert from 'node:assert/strict';
import { test } from 'node:test';

globalThis.window = { location: { origin: 'https://atlas.example' }, addEventListener() {}, dispatchEvent() {} };

// Read successful native form controls from the editor's rendered markup.
// This catches controls that disappear from the UI as well as reader regressions.
const decode = value => String(value || '').replace(/&(amp|lt|gt|quot|#39);/g, (_, key) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[key]));
const attribute = (tag, name) => decode(tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]);
function renderedForm(html, changes = {}) {
  const entries = [];
  for (const tag of html.matchAll(/<input\b[^>]*>/g)) {
    const name = attribute(tag[0], 'name'), type = attribute(tag[0], 'type');
    if (!name || /\bdisabled(?:\s|>)/.test(tag[0]) || type === 'file') continue;
    if (type === 'checkbox' && !/\bchecked(?:\s|>)/.test(tag[0])) continue;
    entries.push([name, attribute(tag[0], 'value') || (type === 'checkbox' ? 'on' : '')]);
  }
  for (const [, tag, value] of html.matchAll(/(<textarea\b[^>]*>)([\s\S]*?)<\/textarea>/g)) entries.push([attribute(tag, 'name'), decode(value)]);
  for (const [, tag, content] of html.matchAll(/(<select\b[^>]*>)([\s\S]*?)<\/select>/g)) {
    if (/\bdisabled(?:\s|>)/.test(tag)) continue;
    const options = [...content.matchAll(/<option\b[^>]*>/g)].map(match => match[0]);
    const selected = options.find(option => /\bselected(?:\s|>)/.test(option)) || options[0];
    entries.push([attribute(tag, 'name'), attribute(selected || '', 'value')]);
  }
  const result = { entries };
  for (const [name, value] of Object.entries(changes)) {
    result.entries = result.entries.filter(([key]) => key !== name);
    for (const item of Array.isArray(value) ? value : [value]) if (item !== null) result.entries.push([name, String(item)]);
  }
  return result;
}
globalThis.FormData = class {
  constructor(form) { this.entries = form.entries; }
  get(name) { return this.entries.find(([key]) => key === name)?.[1] ?? null; }
  getAll(name) { return this.entries.filter(([key]) => key === name).map(([, value]) => value); }
  has(name) { return this.entries.some(([key]) => key === name); }
};

const { tariffEditor, restaurantEditor, menuDishEditor, menuOptionEditor, bannerEditor, readEditor, readMenuDish, readMenuOption, validateMenuDish } = await import('../dist/editors.js');
const { photo, bannerPreview } = await import('../dist/ui.js');

const options = [
  { id: 'small', name: 'Обычная & свежая', price: 0, imageKey: 'philadelphia', priceScope: 'PER_PORTION' },
  { id: 'large', name: 'Большая', price: 120, imageKey: 'philadelphia', priceScope: 'PER_ITEM' },
  { id: 'soy', name: 'Соевый соус', price: 25, imageKey: 'soy' },
];
const dish = {
  id: 'philadelphia', name: 'Филадельфия', category: 'Роллы', description: 'Р'.repeat(2500), portion: '8 шт.', weightGrams: 250,
  price: 520, originalPrice: 600, imageKey: 'philadelphia', imageUrl: '/api/content/media/11111111-1111-1111-1111-111111111111',
  heroImageKey: 'philadelphia-hero', heroImageUrl: 'https://images.example/hero.jpg', available: true,
  optionIds: ['small', 'large', 'soy'], optionGroups: [{ id: 'portion', name: 'Размер', optionIds: ['small', 'large'], minSelected: 1, maxSelected: 1 }],
  defaultOptionIds: ['small'], ingredients: 'Лосось, рис & сыр', calories: 0,
  nutritionPer100g: { calories: 0, protein: 0, fat: 0, carbohydrates: 0, estimated: true },
  badge: 'Хит', ratingPercent: 0, reviewCount: 0,
};
const catalog = { id: 'sushi-roll', name: 'Sushi & Roll', cuisine: 'Японская', categories: ['Суши', 'Роллы'], rating: 4.83, reviewCount: 48, ratingCount: 0,
  etaMin: 30, etaMax: 45, deliveryFee: 100, freeDeliveryThreshold: 900, minimumOrder: 300, address: 'Бишкек, ул. Абая', latitude: 42.8746, longitude: 74.5698, phone: '+996700123456',
  imageKey: 'sushi-roll', heroImageKey: 'sushi-hero', imageUrl: 'https://images.example/restaurant.jpg', heroImageUrl: 'https://images.example/cover.jpg',
  discountPercent: 15, isOpen: true, isDemo: true, menuCategories: ['Роллы'], options, dishes: [dish],
  reviews: [{ id: 'review-1', authorName: 'Айжан', rating: 4.3, createdAt: '2026-09-29T18:47:35.527Z', text: 'Вкусно & быстро\nЗакажу ещё.', source: 'Клиент' }],
  promotions: [{ id: 'sale', title: 'Скидка', type: 'PERCENT', value: 10, active: true, dishIds: ['philadelphia'], minSubtotal: 0 }],
};
const restaurant = { id: catalog.id, catalog, active: true, isDemo: true, sortOrder: 2, updatedAt: '2026-10-09T02:03:04.123Z' };

test('tariff editor submits long-distance defaults and preserves custom and disabled values', () => {
  const item = { id: 'economy', name: 'Эконом', description: 'Такси', basePrice: 60, pricePerKm: 14, pricePerMinute: 2, minimumPrice: 100 };
  const defaults = readEditor('tariff', renderedForm(tariffEditor(item)), item);
  assert.deepEqual([defaults.longDistanceEnabled, defaults.longDistanceThresholdKm, defaults.longDistanceBasePrice, defaults.longDistancePricePerKm], [true, 5, 100, 40]);
  const custom = { ...item, longDistanceEnabled: false, longDistanceThresholdKm: 8, longDistanceBasePrice: 0, longDistancePricePerKm: 50 };
  const saved = readEditor('tariff', renderedForm(tariffEditor(custom)), custom);
  assert.deepEqual([saved.longDistanceEnabled, saved.longDistanceThresholdKm, saved.longDistanceBasePrice, saved.longDistancePricePerKm], [false, 8, 0, 50]);
  const edited = readEditor('tariff', renderedForm(tariffEditor(item), { longDistanceBasePrice: 120, longDistancePricePerKm: 55 }), item);
  assert.equal(edited.longDistanceBasePrice, 120);
  assert.equal(edited.longDistancePricePerKm, 55);
});

test('rendered dish editor round-trips current photos, nutrition, groups and zero values', () => {
  const html = menuDishEditor(dish, catalog);
  assert.match(html, /maxlength="3000"/);
  assert.match(html, /data-image-preferred-key="philadelphia"/);
  const saved = readMenuDish(renderedForm(html), dish, catalog);
  assert.deepEqual(saved, dish);
  assert.equal(validateMenuDish(saved, catalog), '');
});

test('removing an assigned option prunes its defaults and validates existing group limits', () => {
  const saved = readMenuDish(renderedForm(menuDishEditor(dish, catalog), { optionIds: ['soy'] }), dish, catalog);
  assert.deepEqual(saved.defaultOptionIds, []);
  assert.deepEqual(saved.optionGroups[0].optionIds, []);
  assert.match(validateMenuDish(saved, catalog), /Назначьте хотя бы одно/);
});

test('dish URL edits override bundled images and keep hero photos independently', () => {
  const saved = readMenuDish(renderedForm(menuDishEditor(dish, catalog), { imageUrl: 'https://images.example/new.jpg', imageKey: 'burger' }), dish, catalog);
  assert.equal(saved.imageUrl, 'https://images.example/new.jpg');
  assert.equal(saved.imageKey, 'burger');
  assert.equal(saved.heroImageUrl, dish.heroImageUrl);
  assert.match(photo(saved.imageUrl, saved.id, '', '', saved.imageKey), /https:\/\/images\.example\/new\.jpg/);
});

test('image upload captures unsaved fields before redrawing and keeps them on the next save', () => {
  const capture = readMenuDish(renderedForm(menuDishEditor(dish, catalog), { name: 'Новая Филадельфия', ingredients: 'Рис и лосось', price: '560' }), dish, catalog);
  capture.imageUrl = '/api/content/media/22222222-2222-2222-2222-222222222222';
  const saved = readMenuDish(renderedForm(menuDishEditor(capture, catalog)), capture, catalog);
  assert.deepEqual(saved, capture);
  assert.equal(saved.name, 'Новая Филадельфия');
  assert.equal(saved.imageUrl, capture.imageUrl);
  assert.equal(saved.price, 560);
});

test('restaurant edits preserve menu, promotions and unchanged review timestamp precision', () => {
  const saved = readEditor('restaurant', renderedForm(restaurantEditor(restaurant)), restaurant);
  assert.deepEqual(saved, restaurant);
});

test('cleared restaurant photos and deleted reviews stay cleared after form capture', () => {
  const saved = readEditor('restaurant', renderedForm(restaurantEditor(restaurant), { 'catalog.imageUrl': '', 'catalog.imageKey': '', reviewIds: [] }), restaurant);
  assert.equal(saved.catalog.imageUrl, undefined);
  assert.equal(saved.catalog.imageKey, '');
  assert.deepEqual(saved.catalog.reviews, []);
  assert.deepEqual(saved.catalog.promotions, catalog.promotions);
});

test('option editor persists per-item pricing without discarding its photograph', () => {
  const saved = readMenuOption(renderedForm(menuOptionEditor(options[1])), options[1]);
  assert.deepEqual(saved, options[1]);
});

test('banner editor preserves its server version and matches photographic versus uploaded creative behavior', () => {
  const banner = { title: 'Роллы на\nхороший вечер', subtitle: 'SUSHI ROLL', imageKey: 'sushi-roll', imageUrl: null, actionType: 'RESTAURANT', restaurantId: 'sushi-roll', sortOrder: 0, active: true, updatedAt: restaurant.updatedAt };
  const saved = readEditor('banner', renderedForm(bannerEditor(banner, [restaurant])), banner);
  assert.equal(saved.title, banner.title);
  assert.equal(saved.updatedAt, banner.updatedAt);
  assert.equal(saved.imageKey, 'sushi-roll');
  assert.match(bannerPreview(saved, [restaurant]), /campaign-preview/);
  const creative = bannerPreview({ ...saved, imageUrl: 'https://images.example/creative.jpg' }, [restaurant]);
  assert.match(creative, /creative-preview/);
  assert.doesNotMatch(creative, /campaign-copy|banner-copy/);
});

test('bundled photographs use the same crop and fallback priority as the app', () => {
  assert.match(photo('', 'chicken-wrap'), /viewBox="0 550 1400 1500"/);
  assert.match(photo('', 'oromo'), /viewBox="40 140 1200 1100"/);
  assert.match(photo('', 'homepage-burger', '', '', 'philadelphia'), /real\/philadelphia\.jpg/);
});
