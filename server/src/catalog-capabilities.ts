import {FoodDish,FoodRestaurant} from './food-catalog';
export type CatalogAudience='legacy'|'food-modifiers-v2';
export function catalogAudience(value:unknown):CatalogAudience {
  return typeof value==='string'&&value.length<=512&&value.split(',').map(part=>part.trim()).includes('food-modifiers-v2')?'food-modifiers-v2':'legacy';
}
export function legacyDishCompatible(dish:FoodDish,restaurant:Pick<FoodRestaurant,'options'>):boolean {
  if(restaurant.options.some(option=>dish.optionIds.includes(option.id)&&option.priceScope==='PER_ITEM'))return false;
  const defaults=dish.defaultOptionIds??[];
  if(defaults.length&&!(defaults.length===1&&defaults[0]==='soy'&&dish.optionIds.includes('soy')))return false;
  return !(dish.optionGroups??[]).some(group=>(group.minSelected??0)>0||(group.maxSelected??group.optionIds.length)<group.optionIds.length);
}
export function projectCatalog(restaurants:FoodRestaurant[],audience:CatalogAudience):FoodRestaurant[] {
  return structuredClone(restaurants).map(restaurant=>{
    if(audience==='food-modifiers-v2')return restaurant;
    restaurant.dishes=restaurant.dishes.filter(dish=>legacyDishCompatible(dish,restaurant)).map(dish=>{
      const {optionGroups,defaultOptionIds,...legacy}=dish;return legacy;
    });
    restaurant.options=restaurant.options.filter(option=>restaurant.dishes.some(dish=>dish.optionIds.includes(option.id))).map(option=>{
      const {priceScope,...legacy}=option;return legacy;
    });
    return restaurant;
  });
}
