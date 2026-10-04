import type { CartLine, FoodDish, FoodRestaurant } from './types';
import { dishLinePrice, dishOptionsValid } from './dishOptions';
import { currentFoodPromotions, foodDeliveryTerms, foodPromotionBasePrice, promotedDishPrice } from './promotions';

export const MAX_FOOD_QUANTITY = 20;
export const cartLineKey = (line: CartLine) => `${line.dishId}:${[...new Set(line.optionIds)].sort().join(',')}`;

export function addCartLine(lines: CartLine[], dish: FoodDish, quantity: number, optionIds: string[]): CartLine[] {
  if (!dish.available || !Number.isInteger(quantity) || quantity < 1) return lines;
  const remaining = MAX_FOOD_QUANTITY - lines.filter(line => line.dishId === dish.id).reduce((sum, line) => sum + line.quantity, 0);
  if (remaining <= 0) return lines;
  const item: CartLine = { dishId: dish.id, quantity: Math.min(remaining, quantity), optionIds: [...new Set(optionIds)].filter(id => dish.optionIds.includes(id)).sort() };
  const key = cartLineKey(item);
  const exists = lines.some(line => cartLineKey(line) === key);
  return exists ? lines.map(line => cartLineKey(line) === key ? { ...line, quantity: Math.min(MAX_FOOD_QUANTITY, line.quantity + item.quantity) } : line) : [...lines, item];
}

export function changeCartQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (!Number.isInteger(quantity)) return lines;
  const target = lines.find(line => cartLineKey(line) === key);
  const otherQuantity = lines.filter(line => line.dishId === target?.dishId && cartLineKey(line) !== key).reduce((sum, line) => sum + line.quantity, 0);
  // A legacy cart above the current cap can still be reduced one portion at a time.
  const limit = target && quantity <= target.quantity ? MAX_FOOD_QUANTITY : Math.max(target?.quantity ?? 0, MAX_FOOD_QUANTITY - otherQuantity);
  return lines.map(line => cartLineKey(line) === key ? { ...line, quantity: Math.min(limit, quantity) } : line).filter(line => line.quantity > 0);
}

/** Catalog buttons count all configurations of a dish and repeat the latest one. */
export function increaseCatalogDish(lines: CartLine[], dish: FoodDish): CartLine[] {
  if (lines.filter(line => line.dishId === dish.id).reduce((sum, line) => sum + line.quantity, 0) >= MAX_FOOD_QUANTITY) return lines;
  const latest = [...lines].reverse().find(line => line.dishId === dish.id);
  return addCartLine(lines, dish, 1, latest?.optionIds ?? []);
}

export function decreaseCatalogDish(lines: CartLine[], dish: FoodDish): CartLine[] {
  const latest = [...lines].reverse().find(line => line.dishId === dish.id);
  return latest ? changeCartQuantity(lines, cartLineKey(latest), latest.quantity - 1) : lines;
}

export function cartSummary(restaurant: FoodRestaurant | undefined, lines: CartLine[], fulfillment: 'DELIVERY' | 'PICKUP' = 'DELIVERY') {
  const baseItems = lines.flatMap(line => {
    const dish = restaurant?.dishes.find(item => item.id === line.dishId);
    if (!dish) return [];
    const options = restaurant!.options.filter(option => line.optionIds.includes(option.id));
    return [{ ...line, dish, options, total: dishLinePrice({ ...dish, price: foodPromotionBasePrice(dish) }, line.quantity, options, line.optionIds) }];
  });
  const subtotalBeforeDiscount = baseItems.reduce((sum, item) => sum + item.total, 0);
  const promotions = currentFoodPromotions(restaurant, subtotalBeforeDiscount);
  const items = baseItems.map(item => {
    const price = promotedDishPrice(item.dish, promotions);
    const basePrice = foodPromotionBasePrice(item.dish);
    const dish = { ...item.dish, price, ...(price < basePrice ? { originalPrice: Math.max(item.dish.originalPrice ?? 0, basePrice) } : {}) };
    const { options } = item;
    const unitPrice = dish.price + options.filter(option => option.priceScope !== 'PER_ITEM').reduce((sum, option) => sum + option.price, 0);
    return { ...item, dish, unitPrice, total: dishLinePrice(dish, item.quantity, options, item.optionIds) };
  });
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const delivery = foodDeliveryTerms(restaurant, subtotal, subtotalBeforeDiscount);
  const deliveryFee = count && fulfillment === 'DELIVERY' ? delivery.fee : 0;
  const invalid = lines.length !== items.length || lines.length > 50 || count > 99 || !Number.isSafeInteger(subtotal + deliveryFee) || subtotal + deliveryFee > 1_000_000 || items.some(item =>
    !item.dish.available || item.quantity < 1 || item.quantity > MAX_FOOD_QUANTITY || !Number.isInteger(item.quantity) ||
    !Number.isSafeInteger(item.dish.price) || item.dish.price < 0 || !Number.isSafeInteger(foodPromotionBasePrice(item.dish)) || foodPromotionBasePrice(item.dish) < 0 || item.optionIds.length > 10 ||
    new Set(item.optionIds).size !== item.optionIds.length || item.optionIds.some(id => !item.dish.optionIds.includes(id) || !restaurant!.options.some(option => option.id === id)) ||
    item.options.some(option => !Number.isSafeInteger(option.price) || option.price < 0) ||
    !dishOptionsValid(item.dish, restaurant!.options, item.optionIds));
  return { items, subtotal, subtotalBeforeDiscount, count, deliveryFee, total: subtotal + deliveryFee, invalid };
}
