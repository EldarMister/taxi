const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const exportsObject = {};
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food/restaurantDiscovery.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(source, { exports: exportsObject });
const { restaurantCategories, filterRestaurants } = exportsObject;
const clone = value => JSON.parse(JSON.stringify(value));
const merchants = [
  { id: 'east', name: 'Восток', cuisine: 'Узбекская кухня', categories: ['Плов', 'Национальная кухня'], imageKey: 'east', dishes: [{ name: 'Самса', category: 'Выпечка', imageKey: 'samsa', available: true }] },
  { id: 'burger', name: 'Парк Бургер', cuisine: 'Бургеры', categories: ['Бургеры', 'Фастфуд', 'Бургеры'], imageKey: 'restaurant-burger', dishes: [{ name: 'Комбо', category: 'Комбо', imageKey: 'combo', available: true }, { name: 'Чизбургер', category: 'Бургеры', imageKey: 'burger', imageUrl: 'https://example.test/burger.jpg', available: true }] },
  { id: 'sushi', name: 'Море', cuisine: 'Суши', categories: ['Суши'], imageKey: 'restaurant-sushi', imageUrl: 'https://example.test/merchant.jpg', dishes: [] },
];

test('category rail contains only live merchant categories and uses their actual dish photographs', () => {
  const result = clone(restaurantCategories(merchants));
  assert.deepEqual(result.map(item => item.name), ['Бургеры', 'Суши', 'Плов', 'Национальная кухня', 'Фастфуд']);
  assert.deepEqual(result[0], { name: 'Бургеры', imageKey: 'burger', imageUrl: 'https://example.test/burger.jpg' });
  assert.deepEqual(result[1], { name: 'Суши', imageKey: 'restaurant-sushi', imageUrl: 'https://example.test/merchant.jpg' });
  assert.equal(result[2].imageKey, 'samsa');
  assert.deepEqual(clone(restaurantCategories([])), []);
  assert.equal(result.some(item => ['Пицца', 'Шаурма'].includes(item.name)), false);
});

test('category photograph prefers a merchant specializing in that real category', () => {
  const specialized = { ...merchants[0], id: 'special', cuisine: 'Плов', dishes: [{ name: 'Плов', category: 'Плов', imageKey: 'plov', available: true }] };
  assert.equal(restaurantCategories([...merchants, specialized]).find(item => item.name === 'Плов').imageKey, 'plov');
  const before = clone(merchants);
  restaurantCategories(merchants);
  assert.deepEqual(merchants, before);
});

test('search matches names, cuisines, categories and dish names while preserving the selected filter', () => {
  const ids = (query, category = 'Все') => clone(filterRestaurants(merchants, query, category)).map(item => item.id);
  assert.deepEqual(ids('  ПАРК '), ['burger']);
  assert.deepEqual(ids('узбекская'), ['east']);
  assert.deepEqual(ids('фастфуд'), ['burger']);
  assert.deepEqual(ids('чизбургер'), ['burger']);
  assert.deepEqual(ids('', 'Суши'), ['sushi']);
  assert.deepEqual(ids('Чизбургер', 'Суши'), []);
  assert.deepEqual(ids('', 'Все'), ['east', 'burger', 'sushi']);
  assert.deepEqual(ids('несуществующее блюдо'), []);
});

test('reference filters combine dish groups and cuisine without changing catalog order', () => {
  const filters = exportsObject.emptyRestaurantFilters();
  const catalog = [
    { ...merchants[0], rating: 4.2, reviewCount: 4, etaMin: 20, etaMax: 45, dishes: [{ name: 'Плов', category: 'Горячее', available: true, price: 300, originalPrice: 400 }] },
    { ...merchants[1], rating: 4.8, reviewCount: 8, etaMin: 25, etaMax: 35, discountPercent: 10 },
    { ...merchants[2], rating: 4.8, reviewCount: 16, etaMin: 20, etaMax: 30 },
  ];
  const before = clone(catalog);
  const ids = overrides => clone(filterRestaurants(catalog, '', 'Все', { ...filters, ...overrides })).map(item => item.id);
  assert.deepEqual(ids({ dishes: ['Плов'] }), ['east']);
  assert.deepEqual(ids({ dishes: ['Плов', 'Бургеры'] }), ['east', 'burger']);
  assert.deepEqual(ids({ dishes: ['Плов', 'Бургеры'], cuisines: ['Восток'] }), ['east']);
  assert.deepEqual(ids({ cuisines: ['Япония'] }), ['sushi']);
  assert.deepEqual(ids({ sort: 'rating' }), ['sushi', 'burger', 'east']);
  assert.deepEqual(ids({ sort: 'fast' }), ['sushi', 'burger', 'east']);
  assert.deepEqual(ids({ dishes: ['Пицца'] }), []);
  assert.deepEqual(ids({}), ['east', 'burger', 'sushi']);
  assert.deepEqual(catalog, before);
});
