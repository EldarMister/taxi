import { FoodDish, FoodPromotion, FoodRestaurant } from './food-catalog';
export function currentFoodPromotions(restaurant:FoodRestaurant,subtotal:number,now=Date.now()) {
  return (restaurant.promotions??[]).filter(p=>p.active&&p.minSubtotal<=subtotal&&(!p.startsAt||Date.parse(p.startsAt)<=now)&&(!p.endsAt||Date.parse(p.endsAt)>now));
}
export function promotedDishPrice(dish:FoodDish,promotions:FoodPromotion[]) {
  return promotions.reduce((best,p)=>{
    if(p.type==='FREE_DELIVERY'||(p.dishIds.length&&!p.dishIds.includes(dish.id)))return best;
    const price=p.type==='PERCENT'?Math.round(dish.price*(100-p.value)/100):Math.max(0,dish.price-p.value);
    return Math.min(best,price);
  },dish.price);
}
export function applyFoodPromotionsForDisplay(restaurant:FoodRestaurant,now=Date.now()) {
  const promotions=currentFoodPromotions(restaurant,0,now);
  if(!promotions.length)return restaurant;
  return {...restaurant,dishes:restaurant.dishes.map(dish=>{
    const price=promotedDishPrice(dish,promotions);
    return price===dish.price?dish:{...dish,promotionBasePrice:dish.price,price,originalPrice:Math.max(dish.originalPrice??0,dish.price)};
  }),...(promotions.some(p=>p.type==='FREE_DELIVERY')?{deliveryFee:0,promotionBaseDeliveryFee:restaurant.deliveryFee}:{})};
}
