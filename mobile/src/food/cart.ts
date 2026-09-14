import type { CartLine, FoodDish, FoodRestaurant } from './types';

export const MAX_FOOD_QUANTITY = 20;
export const cartLineKey = (line: CartLine) => `${line.dishId}:${[...new Set(line.optionIds)].sort().join(',')}`;

export function addCartLine(lines: CartLine[], dish: FoodDish, quantity: number, optionIds: string[]): CartLine[] {
  if (!dish.available || !Number.isInteger(quantity) || quantity < 1) return lines;
  const item: CartLine = { dishId: dish.id, quantity: Math.min(MAX_FOOD_QUANTITY, quantity), optionIds: [...new Set(optionIds)].filter(id => dish.optionIds.includes(id)).sort() };
  const key = cartLineKey(item);
  const exists = lines.some(line => cartLineKey(line) === key);
  return exists ? lines.map(line => cartLineKey(line) === key ? { ...line, quantity: Math.min(MAX_FOOD_QUANTITY, line.quantity + item.quantity) } : line) : [...lines, item];
}

export function changeCartQuantity(lines: CartLine[], key: string, quantity: number): CartLine[] {
  if (!Number.isInteger(quantity)) return lines;
  return lines.map(line => cartLineKey(line) === key ? { ...line, quantity: Math.min(MAX_FOOD_QUANTITY, quantity) } : line).filter(line => line.quantity > 0);
}

export function cartSummary(restaurant: FoodRestaurant | undefined, lines: CartLine[], fulfillment: 'DELIVERY' | 'PICKUP' = 'DELIVERY') {
  const items = lines.flatMap(line => {
    const dish = restaurant?.dishes.find(item => item.id === line.dishId);
    if (!dish) return [];
    const options = restaurant!.options.filter(option => line.optionIds.includes(option.id));
    const unitPrice = dish.price + options.reduce((sum, option) => sum + option.price, 0);
    return [{ ...line, dish, options, unitPrice, total: unitPrice * line.quantity }];
  });
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const deliveryFee = count && fulfillment === 'DELIVERY' ? restaurant?.deliveryFee || 0 : 0;
  const invalid = lines.length !== items.length || items.some(item => !item.dish.available || item.quantity < 1 || item.quantity > MAX_FOOD_QUANTITY || !Number.isInteger(item.quantity) || item.optionIds.some(id => !item.dish.optionIds.includes(id) || !restaurant!.options.some(option => option.id === id)));
  return { items, subtotal, count, deliveryFee, total: subtotal + deliveryFee, invalid };
}
