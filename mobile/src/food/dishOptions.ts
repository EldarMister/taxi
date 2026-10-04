import type { FoodDish, FoodOption, FoodOptionGroup } from './types';

export const requiresDishConfiguration = (dish: FoodDish) =>
  !!dish.optionGroups?.some(group => (group.minSelected ?? 0) > 0);

export function dishOptionsValid(dish: FoodDish, options: FoodOption[], selected: string[]) {
  if (selected.length > 10 || new Set(selected).size !== selected.length ||
      selected.some(id => !dish.optionIds.includes(id) || !options.some(option => option.id === id))) return false;
  return (dish.optionGroups ?? []).every(group => {
    const count = group.optionIds.filter(id => selected.includes(id)).length;
    return count >= (group.minSelected ?? 0) && count <= (group.maxSelected ?? group.optionIds.length);
  });
}

export function initialDishOptions(dish: FoodDish, options: FoodOption[]) {
  const defaults = dish.defaultOptionIds ?? (dish.optionIds.includes('soy') ? ['soy'] : []);
  return [...new Set(defaults)].filter(id => dish.optionIds.includes(id) && options.some(option => option.id === id));
}

export function toggleDishOption(selected: string[], id: string, group?: FoodOptionGroup) {
  if (selected.includes(id)) return selected.filter(value => value !== id);
  if (group?.maxSelected === 1) return [...selected.filter(value => !group.optionIds.includes(value)), id];
  if (selected.length >= 10 || (group && group.optionIds.filter(value => selected.includes(value)).length >=
      (group.maxSelected ?? group.optionIds.length))) return selected;
  return [...selected, id];
}

export function dishLinePrice(dish: FoodDish, quantity: number, options: FoodOption[], selected: string[]) {
  return dish.price * quantity + options.filter(option => selected.includes(option.id))
    .reduce((sum, option) => sum + option.price * (option.priceScope === 'PER_ITEM' ? 1 : quantity), 0);
}
