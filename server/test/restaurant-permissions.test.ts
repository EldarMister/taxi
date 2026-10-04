import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertRestaurantCatalogPermissions, DEFAULT_MANAGER_PERMISSIONS, requireRestaurantPermission, restaurantPermissions, restaurantPhone, RESTAURANT_PERMISSIONS } from '../src/restaurant-domain';

test('new managers are limited to orders and unknown or duplicate permissions are rejected', () => {
  assert.deepEqual(DEFAULT_MANAGER_PERMISSIONS, ['orders.read', 'orders.manage']);
  assert.deepEqual(restaurantPermissions(['orders.read', 'menu.manage']), ['orders.read', 'menu.manage']);
  for (const value of [['admin'], ['orders.read', 'orders.read'], ['orders.manage'], null, 'OWNER']) {
    assert.throws(() => restaurantPermissions(value), BadRequestException);
  }
});

test('restaurant permission checks deny missing membership and isolate manager capabilities', () => {
  const manager = { role: 'MANAGER', permissions: [...DEFAULT_MANAGER_PERMISSIONS] };
  requireRestaurantPermission(manager, 'orders.read');
  requireRestaurantPermission(manager, 'orders.manage');
  for (const permission of RESTAURANT_PERMISSIONS.filter(value => !manager.permissions.includes(value))) {
    assert.throws(() => requireRestaurantPermission(manager, permission), ForbiddenException);
  }
  assert.throws(() => requireRestaurantPermission(null, 'orders.read'), ForbiddenException);
  for (const permission of RESTAURANT_PERMISSIONS) requireRestaurantPermission({ role: 'OWNER', permissions: [] }, permission);
});

test('menu access cannot be used to change delivery, restaurant identity or promotions in a full catalog update', () => {
  const manager = { role: 'MANAGER', permissions: ['menu.manage'] };
  const current = { name: 'Кафе', deliveryFee: 100, promotions: [], dishes: [{ id: 'dish', price: 300 }], options: [], menuCategories: ['Основное'] };
  assertRestaurantCatalogPermissions(manager, current, { ...current, dishes: [{ id: 'dish', price: 350 }] });
  for (const patch of [{ name: 'Другое кафе' }, { deliveryFee: 0 }, { promotions: [{ id: 'discount' }] }, { latitude: 42 }]) {
    assert.throws(() => assertRestaurantCatalogPermissions(manager, current, { ...current, ...patch }), ForbiddenException);
  }
  assert.throws(() => assertRestaurantCatalogPermissions({ role: 'MANAGER', permissions: [...DEFAULT_MANAGER_PERMISSIONS] }, current, { ...current, dishes: [] }), ForbiddenException);
});

test('owner controls all operational fields but cannot alter Atlas-managed ratings or reviews', () => {
  const owner = { role: 'OWNER', permissions: [] };
  const current = { name: 'Кафе', rating: 4.7, reviewCount: 10, reviews: [{ id: 'review' }], isDemo: false };
  assertRestaurantCatalogPermissions(owner, current, { ...current, name: 'Новое кафе', deliveryFee: 0, latitude: 42.8, longitude: 74.5 });
  for (const patch of [{ rating: 5 }, { reviewCount: 1000 }, { reviews: [] }, { isDemo: true }, { arbitrary: 'data' }]) {
    assert.throws(() => assertRestaurantCatalogPermissions(owner, current, { ...current, ...patch }), ForbiddenException);
  }
});

test('unchanged nested catalog objects do not require unrelated permissions and phone normalization is bounded', () => {
  const manager = { role: 'MANAGER', permissions: [] };
  assertRestaurantCatalogPermissions(manager, { reviews: [{ id: 'r', text: 'Отзыв' }] }, { reviews: [{ text: 'Отзыв', id: 'r' }], unused: undefined });
  assert.equal(restaurantPhone('+996 (700) 123-456'), '+996700123456');
  for (const phone of ['700123456', '+', '+00000000', '+996<script>']) assert.throws(() => restaurantPhone(phone), BadRequestException);
});
