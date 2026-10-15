import type { FoodDish, FoodOption, FoodOptionGroup, RestaurantCatalog } from '../../domain/types';

export type DraftOption = FoodOption & { priceText: string; selectedByDefault: boolean };
export type DraftGroup = Omit<FoodOptionGroup, 'optionIds' | 'minSelected' | 'maxSelected'> & {
  minText: string; maxText: string; options: DraftOption[];
};
export type DishDraft = {
  original?: FoodDish;
  id: string; name: string; category: string; description: string; portion: string;
  price: string; weightGrams: string; available: boolean; imageUrl?: string; heroImageUrl?: string;
  ingredients: string; calories: string; originalPrice: string; badge: string;
  nutrition: boolean; nutritionCalories: string; protein: string; fat: string; carbohydrates: string; estimated: boolean;
  groups: DraftGroup[];
};

let sequence = 0;
export const newMenuId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createDishDraft(catalog: RestaurantCatalog, dish?: FoodDish): DishDraft {
  const grouped = new Set(dish?.optionGroups?.flatMap(group => group.optionIds) ?? []);
  const groups: FoodOptionGroup[] = [...(dish?.optionGroups ?? [])];
  const loose = dish?.optionIds.filter(id => !grouped.has(id)) ?? [];
  if (loose.length) groups.push({ id: newMenuId('group'), name: 'Дополнения', optionIds: loose, minSelected: 0, maxSelected: loose.length });
  const defaults = dish?.defaultOptionIds ?? (dish?.optionIds.includes('soy') ? ['soy'] : []);
  return {
    original: dish, id: dish?.id ?? newMenuId('dish'), name: dish?.name ?? '', category: dish?.category ?? catalog.menuCategories[0] ?? '',
    description: dish?.description ?? '', portion: dish?.portion ?? '', price: String(dish?.price ?? ''), weightGrams: String(dish?.weightGrams ?? ''),
    available: dish?.available ?? true, imageUrl: dish?.imageUrl ?? undefined, heroImageUrl: dish?.heroImageUrl ?? undefined,
    ingredients: dish?.ingredients ?? '', calories: String(dish?.calories ?? ''), originalPrice: String(dish?.originalPrice ?? ''), badge: dish?.badge ?? '',
    nutrition: !!dish?.nutritionPer100g, nutritionCalories: String(dish?.nutritionPer100g?.calories ?? ''),
    protein: String(dish?.nutritionPer100g?.protein ?? ''), fat: String(dish?.nutritionPer100g?.fat ?? ''), carbohydrates: String(dish?.nutritionPer100g?.carbohydrates ?? ''), estimated: dish?.nutritionPer100g?.estimated ?? false,
    groups: groups.map(group => ({ id: group.id, name: group.name, minText: String(group.minSelected ?? 0), maxText: String(group.maxSelected ?? group.optionIds.length),
      options: group.optionIds.flatMap(id => {
        const option = catalog.options.find(item => item.id === id);
        return option ? [{ ...option, priceText: String(option.price), selectedByDefault: defaults.includes(id) }] : [];
      }),
    })),
  };
}

export function menuNumber(value: string, label: string, max = 1_000_000, decimal = false): number {
  const text = value.trim().replace(',', '.');
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) throw new Error(`${label}: укажите число от 0 до ${max}.`);
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > max || (!decimal && !Number.isSafeInteger(number))) throw new Error(`${label}: ${decimal ? 'число' : 'целое число'} от 0 до ${max}.`);
  return number;
}

function text(value: string, label: string, max: number, required = false) {
  const result = value.trim();
  if ((required && !result) || result.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(result)) throw new Error(`${label}: ${required ? 'заполните поле, ' : ''}не более ${max} символов.`);
  return result;
}

/** Option IDs used by another dish are forked only when edited. Existing orders keep their snapshots. */
export function buildDish(draft: DishDraft, catalog: RestaurantCatalog): { dish: FoodDish; options: FoodOption[] } {
  const price = menuNumber(draft.price, 'Цена');
  if (!catalog.menuCategories.includes(draft.category)) throw new Error('Выберите существующую категорию.');
  if (draft.groups.length > 10) throw new Error('У блюда может быть не более 10 групп.');
  if (draft.groups.reduce((sum, group) => sum + group.options.length, 0) > 10) throw new Error('У блюда может быть не более 10 вариантов дополнений.');
  const options: FoodOption[] = [], groups: FoodOptionGroup[] = [], defaults: string[] = [];
  for (const group of draft.groups) {
    if (!group.options.length) throw new Error(`Добавьте варианты в группу «${group.name || 'Без названия'}» или удалите её.`);
    const min = menuNumber(group.minText, 'Минимальный выбор', group.options.length);
    const max = menuNumber(group.maxText, 'Максимальный выбор', group.options.length);
    if (min > max) throw new Error('Минимальный выбор не может быть больше максимального.');
    const ids: string[] = [];
    for (const option of group.options) {
      const next: FoodOption = { id: option.id, name: text(option.name, 'Название варианта', 150, true), price: menuNumber(option.priceText, 'Доплата'), imageKey: option.imageKey,
        ...(option.imageUrl ? { imageUrl: option.imageUrl } : {}), ...(option.priceScope ? { priceScope: option.priceScope } : {}) };
      const previous = catalog.options.find(item => item.id === option.id);
      const usedElsewhere = catalog.dishes.some(item => item.id !== draft.id && item.optionIds.includes(option.id));
      if (usedElsewhere && previous && (previous.name !== next.name || previous.price !== next.price || (previous.priceScope ?? 'PER_PORTION') !== (next.priceScope ?? 'PER_PORTION'))) next.id = newMenuId('option');
      ids.push(next.id); options.push(next);
      if (option.selectedByDefault) defaults.push(next.id);
    }
    if (defaults.filter(id => ids.includes(id)).length > max) throw new Error(`В группе «${group.name}» слишком много вариантов по умолчанию.`);
    groups.push({ id: group.id, name: text(group.name, 'Название группы', 150, true), optionIds: ids, minSelected: min, maxSelected: max });
  }
  const dish: FoodDish = {
    ...draft.original, id: draft.id, name: text(draft.name, 'Название блюда', 150, true), category: draft.category,
    description: text(draft.description, 'Описание', 3000), portion: text(draft.portion, 'Размер порции', 100),
    weightGrams: menuNumber(draft.weightGrams || '0', 'Вес', 100_000), price, available: draft.available,
    imageKey: draft.original?.imageKey ?? '', heroImageKey: draft.original?.heroImageKey ?? '',
    imageUrl: draft.imageUrl, heroImageUrl: draft.heroImageUrl,
    optionIds: options.map(option => option.id), optionGroups: groups, defaultOptionIds: defaults,
    ingredients: draft.ingredients.trim() ? text(draft.ingredients, 'Состав', 3000) : undefined,
    calories: draft.calories.trim() ? menuNumber(draft.calories, 'Калорийность порции', 100_000) : undefined,
    originalPrice: draft.originalPrice.trim() ? menuNumber(draft.originalPrice, 'Старая цена') : undefined,
    badge: draft.badge.trim() ? text(draft.badge, 'Подпись', 60) : undefined,
    nutritionPer100g: draft.nutrition ? {
      calories: menuNumber(draft.nutritionCalories, 'Ккал на 100 г', 1000, true), protein: menuNumber(draft.protein, 'Белки', 100, true),
      fat: menuNumber(draft.fat, 'Жиры', 100, true), carbohydrates: menuNumber(draft.carbohydrates, 'Углеводы', 100, true), estimated: draft.estimated,
    } : undefined,
  };
  if (dish.originalPrice !== undefined && dish.originalPrice < price) throw new Error('Старая цена должна быть не меньше текущей.');
  return { dish, options };
}

export function saveDishInCatalog(catalog: RestaurantCatalog, draft: DishDraft): RestaurantCatalog {
  const { dish, options } = buildDish(draft, catalog);
  const exists = catalog.dishes.some(item => item.id === dish.id);
  if (!exists && catalog.dishes.length >= 500) throw new Error('Достигнут лимит: 500 блюд.');
  const dishes = exists ? catalog.dishes.map(item => item.id === dish.id ? dish : item) : [...catalog.dishes, dish];
  const byId = new Map(catalog.options.map(option => [option.id, option]));
  for (const option of options) byId.set(option.id, option);
  const retainedOptions = [...byId.values()];
  if (retainedOptions.length > 100) throw new Error('Достигнут лимит: 100 дополнений в меню. Удалите неиспользуемые дополнения в редакторе категорий.');
  return { ...catalog, dishes, options: retainedOptions };
}

export function renameCategory(catalog: RestaurantCatalog, previous: string | null, name: string): RestaurantCatalog {
  const next = text(name, 'Название категории', 100, true);
  if (catalog.menuCategories.some(item => item !== previous && item === next)) throw new Error('Категория с таким названием уже существует.');
  if (previous === null && catalog.menuCategories.length >= 40) throw new Error('В меню может быть не более 40 категорий.');
  return { ...catalog, menuCategories: previous === null ? [...catalog.menuCategories, next] : catalog.menuCategories.map(item => item === previous ? next : item),
    dishes: previous === null ? catalog.dishes : catalog.dishes.map(dish => dish.category === previous ? { ...dish, category: next } : dish) };
}

export function deleteCategory(catalog: RestaurantCatalog, name: string): RestaurantCatalog {
  if (catalog.dishes.some(dish => dish.category === name)) throw new Error('Сначала перенесите блюда в другую категорию.');
  return { ...catalog, menuCategories: catalog.menuCategories.filter(item => item !== name) };
}

export function deleteDish(catalog: RestaurantCatalog, id: string): RestaurantCatalog {
  if (catalog.promotions?.some(promotion => promotion.dishIds.includes(id))) throw new Error('Это блюдо участвует в акции. Сначала уберите его из акции или отключите доступность блюда.');
  return { ...catalog, dishes: catalog.dishes.filter(dish => dish.id !== id) };
}

export function previewOptionsValid(dish: FoodDish, selected: string[]) {
  return selected.length <= 10 && selected.every(id => dish.optionIds.includes(id)) && (dish.optionGroups ?? []).every(group => {
    const count = group.optionIds.filter(id => selected.includes(id)).length;
    return count >= (group.minSelected ?? 0) && count <= (group.maxSelected ?? group.optionIds.length);
  });
}

export function previewPrice(dish: FoodDish, options: FoodOption[], selected: string[], quantity: number) {
  return dish.price * quantity + options.filter(option => selected.includes(option.id)).reduce((sum, option) => sum + option.price * (option.priceScope === 'PER_ITEM' ? 1 : quantity), 0);
}

/** Mirrors the public catalog projection. Basket-dependent offers are evaluated only during checkout. */
export function customerPreviewPricing(dish: FoodDish, catalog: Pick<RestaurantCatalog, 'promotions'>, now = Date.now()) {
  const current = (catalog.promotions ?? []).filter(promotion => promotion.active &&
    (!promotion.startsAt || Date.parse(promotion.startsAt) <= now) && (!promotion.endsAt || Date.parse(promotion.endsAt) > now) &&
    (promotion.type === 'FREE_DELIVERY' || !promotion.dishIds.length || promotion.dishIds.includes(dish.id)));
  const price = current.filter(promotion => promotion.minSubtotal <= 0).reduce((best, promotion) => {
    if (promotion.type === 'FREE_DELIVERY') return best;
    const candidate = promotion.type === 'PERCENT' ? Math.round(dish.price * (100 - promotion.value) / 100) : Math.max(0, dish.price - promotion.value);
    return Math.min(best, candidate);
  }, dish.price);
  const displayed = price === dish.price ? dish : { ...dish, price, originalPrice: Math.max(dish.originalPrice ?? 0, dish.price) };
  return { dish: displayed, discountPercent: displayed.originalPrice && displayed.originalPrice > displayed.price ? Math.round((1 - displayed.price / displayed.originalPrice) * 100) : 0,
    hasBasketOffers: current.some(promotion => promotion.minSubtotal > 0) };
}

export function cropRegion(width: number, height: number, aspect: number, zoom: number, x: number, y: number) {
  const baseWidth = Math.min(width, height * aspect), cropWidth = Math.max(1, Math.floor(baseWidth / zoom));
  const cropHeight = Math.max(1, Math.floor(cropWidth / aspect));
  return { originX: Math.round(Math.max(0, Math.min(1, x)) * (width - cropWidth)), originY: Math.round(Math.max(0, Math.min(1, y)) * (height - cropHeight)), width: cropWidth, height: cropHeight };
}
