import type { FoodRestaurant } from './types';

export type RestaurantFilters = {
  dishes: string[];
  cuisines: string[];
  sort: 'default' | 'rating' | 'fast';
};

export const emptyRestaurantFilters = (): RestaurantFilters => ({ dishes: [], cuisines: [], sort: 'default' });

export function isFoodFilterCategoryAllowed(name: string) {
  const normalized = name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');
  return normalized.length > 0 && ![
    'алкоголь', 'алкогольные напитки', 'спиртные напитки',
    'alcohol', 'alcoholic drinks', 'alcoholic beverages',
  ].includes(normalized);
}

const categoryAliases: Record<string, string[]> = {
  Суши: ['суши', 'роллы', 'ролл'], Плов: ['плов'], Курица: ['курица', 'курицей', 'куриное', 'баскет'],
  Шаурма: ['шаурма', 'шаверма'], Шашлык: ['шашлык', 'кебаб'], Вок: ['вок', 'лапша'],
  Выпечка: ['выпечка', 'самса', 'круассан'], Бургеры: ['бургер', 'чизбургер'],
};
const cuisineAliases: Record<string, string[]> = {
  Местная: ['местная', 'национальная', 'кыргыз', 'киргиз', 'домашняя'],
  Европа: ['европ', 'француз', 'немец', 'испан'], Япония: ['япон', 'суши', 'роллы'],
  Италия: ['итал', 'пицца', 'паста'], Грузинская: ['грузин', 'хинкали', 'хачапури'],
  Восток: ['восточ', 'узбек', 'турец', 'плов'],
};

/** Categories and their photographs come from the current merchants, never a demo list. */
export function restaurantCategories(restaurants: FoodRestaurant[]) {
  const names = [...new Set(restaurants.flatMap(restaurant => restaurant.categories).filter(isFoodFilterCategoryAllowed))];
  const priority = ['Бургеры', 'Суши', 'Пицца', 'Шаурма', 'Плов'];
  names.sort((a, b) => {
    const rank = (name: string) => { const index = priority.indexOf(name); return index < 0 ? priority.length : index; };
    return rank(a) - rank(b);
  });
  return names.map(name => {
    const merchants = restaurants.filter(restaurant => restaurant.categories.includes(name));
    const merchant = merchants.find(restaurant => restaurant.cuisine.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru')) ?? merchants[0];
    const dish = merchant.dishes.find(item => item.category === name) ?? merchant.dishes.find(item => item.available) ?? merchant.dishes[0];
    return { name, imageKey: dish?.imageKey ?? merchant.imageKey, imageUrl: dish ? dish.imageUrl : merchant.imageUrl };
  });
}

export function filterRestaurants(restaurants: FoodRestaurant[], search: string, category: string, filters?: RestaurantFilters) {
  const query = search.trim().toLocaleLowerCase('ru');
  const result = restaurants.filter(restaurant => {
    const content = `${restaurant.name} ${restaurant.cuisine} ${restaurant.categories.join(' ')} ${restaurant.dishes.map(dish => dish.name).join(' ')}`.toLocaleLowerCase('ru');
    if ((category !== 'Все' && !restaurant.categories.includes(category)) || !content.includes(query)) return false;
    if (!filters) return true;
    const dishes = `${restaurant.categories.join(' ')} ${restaurant.dishes.map(dish => `${dish.category} ${dish.name}`).join(' ')}`.toLocaleLowerCase('ru');
    const cuisine = `${restaurant.cuisine} ${restaurant.categories.join(' ')}`.toLocaleLowerCase('ru');
    if (filters.dishes.length && !filters.dishes.some(name => (categoryAliases[name] ?? [name.toLocaleLowerCase('ru')]).some(alias => dishes.includes(alias)))) return false;
    if (filters.cuisines.length && !filters.cuisines.some(name => (cuisineAliases[name] ?? [name.toLocaleLowerCase('ru')]).some(alias => cuisine.includes(alias)))) return false;
    return true;
  });
  if (filters?.sort === 'rating') result.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
  if (filters?.sort === 'fast') result.sort((a, b) => a.etaMax - b.etaMax || a.etaMin - b.etaMin);
  return result;
}
