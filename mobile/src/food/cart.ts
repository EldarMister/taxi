import type { CartLine, FoodDish, FoodOption, FoodOptionGroup, FoodRestaurant } from './types';

export const MAX_FOOD_QUANTITY = 20;
export const cartLineKey = (line: CartLine) => `${line.dishId}:${[...new Set(line.optionIds)].sort().join(',')}`;

export function dishOptionGroups(dish: FoodDish): FoodOptionGroup[] {
  const groups = dish.optionGroups ?? [];
  const grouped = new Set(groups.flatMap(group => group.optionIds));
  const loose = dish.optionIds.filter(id => !grouped.has(id));
  return loose.length ? [...groups, { id: '__loose', name: 'Комплектация и добавки', optionIds: loose }] : groups;
}

export function defaultDishOptions(dish: FoodDish): string[] {
  return [...new Set(dish.defaultOptionIds ?? (dish.optionIds.includes('soy') ? ['soy'] : []))].filter(id => dish.optionIds.includes(id));
}

export function dishOptionsValid(dish: FoodDish, selected: string[]): boolean {
  return selected.length <= 10 && new Set(selected).size === selected.length && selected.every(id => dish.optionIds.includes(id)) && (dish.optionGroups ?? []).every(group => {
    const count = group.optionIds.filter(id => selected.includes(id)).length;
    return count >= (group.minSelected ?? 0) && count <= (group.maxSelected ?? group.optionIds.length);
  });
}

export function toggleDishOption(dish: FoodDish, selected: string[], id: string): string[] {
  if (!dish.optionIds.includes(id)) return selected;
  if (selected.includes(id)) return selected.filter(value => value !== id);
  const group = dish.optionGroups?.find(value => value.optionIds.includes(id));
  if (group?.maxSelected === 1) {
    const remaining = selected.filter(value => !group.optionIds.includes(value));
    return remaining.length >= 10 ? selected : [...remaining, id];
  }
  if (selected.length >= 10 || (group && group.optionIds.filter(value => selected.includes(value)).length >= (group.maxSelected ?? group.optionIds.length))) return selected;
  return [...selected, id];
}

export function dishLineTotal(dish: FoodDish, options: FoodOption[], selected: string[], quantity: number): number {
  return dish.price * quantity + options.filter(option => selected.includes(option.id)).reduce((sum, option) => sum + option.price * (option.priceScope === 'PER_ITEM' ? 1 : quantity), 0);
}

export function addCartLine(lines: CartLine[], dish: FoodDish, quantity: number, optionIds: string[]): CartLine[] {
  if (!dish.available || !Number.isInteger(quantity) || quantity < 1) return lines;
  const item: CartLine = { dishId: dish.id, quantity: Math.min(MAX_FOOD_QUANTITY, quantity), optionIds: [...new Set(optionIds)].filter(id => dish.optionIds.includes(id)).sort() };
  if (!dishOptionsValid(dish, item.optionIds)) return lines;
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
    return [{ ...line, dish, options, unitPrice, total: dishLineTotal(dish, options, line.optionIds, line.quantity) }];
  });
  const subtotal = items.reduce((sum, item) => sum + item.total, 0);
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const deliveryFee = count && fulfillment === 'DELIVERY' ? restaurant?.deliveryFee || 0 : 0;
  const invalid = lines.length !== items.length || items.some(item => !item.dish.available || item.quantity < 1 || item.quantity > MAX_FOOD_QUANTITY || !Number.isInteger(item.quantity) || !dishOptionsValid(item.dish, item.optionIds) || item.optionIds.some(id => !restaurant!.options.some(option => option.id === id)));
  return { items, subtotal, count, deliveryFee, total: subtotal + deliveryFee, invalid };
}
