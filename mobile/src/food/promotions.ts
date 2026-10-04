import type { FoodDish, FoodPromotion, FoodRestaurant } from './types';

export const foodPromotionBasePrice = (dish: FoodDish) => dish.promotionBasePrice ?? dish.price;

export function currentFoodPromotions(restaurant: FoodRestaurant | undefined, subtotal: number, now = Date.now()) {
  return (restaurant?.promotions ?? []).filter(promotion => promotion.active && promotion.minSubtotal <= subtotal &&
    (!promotion.startsAt || Date.parse(promotion.startsAt) <= now) &&
    (!promotion.endsAt || Date.parse(promotion.endsAt) > now));
}

/** Additions keep their own price; one best promotion applies to each dish. */
export function promotedDishPrice(dish: FoodDish, promotions: FoodPromotion[]) {
  const basePrice = foodPromotionBasePrice(dish);
  return promotions.reduce((best, promotion) => {
    if (promotion.type === 'FREE_DELIVERY' || (promotion.dishIds.length && !promotion.dishIds.includes(dish.id))) return best;
    const price = promotion.type === 'PERCENT'
      ? Math.round(basePrice * (100 - promotion.value) / 100)
      : Math.max(0, basePrice - promotion.value);
    return Math.min(best, price);
  }, basePrice);
}

/** Normal delivery minimum uses the discounted basket; promotion eligibility uses its base sum. */
export function foodDeliveryTerms(restaurant: FoodRestaurant | undefined, subtotal: number, subtotalBeforeDiscount = subtotal, now = Date.now()) {
  const baseFee = Math.max(0, restaurant?.promotionBaseDeliveryFee ?? restaurant?.deliveryFee ?? 0);
  const standardMinimum = Math.max(0, restaurant?.freeDeliveryThreshold ?? 0);
  const freePromotions = currentFoodPromotions(restaurant, Infinity, now).filter(promotion => promotion.type === 'FREE_DELIVERY');
  const targets = [
    ...(standardMinimum > 0 ? [{ threshold: standardMinimum, amount: Math.max(0, subtotal) }] : []),
    ...freePromotions.map(promotion => ({ threshold: promotion.minSubtotal, amount: Math.max(0, subtotalBeforeDiscount) })),
  ];
  const free = baseFee === 0 || targets.some(target => target.amount >= target.threshold);
  const target = targets.sort((left, right) => (left.threshold - left.amount) - (right.threshold - right.amount))[0];
  return { baseFee, fee: free ? 0 : baseFee, free, threshold: target?.threshold ?? 0,
    amount: target?.amount ?? Math.max(0, subtotal), remaining: free ? 0 : target ? Math.max(0, target.threshold - target.amount) : 0 };
}
