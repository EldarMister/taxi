export type FoodPaymentMethod = 'CASH' | 'CARD' | 'ONLINE';

export type FoodOption = {
  id: string;
  name: string;
  price: number;
  imageKey: string;
  imageUrl?: string | null;
  /** Missing scope preserves the existing per-portion catalog prices. */
  priceScope?: 'PER_PORTION' | 'PER_ITEM';
};

export type FoodOptionGroup = {
  id: string;
  name: string;
  optionIds: string[];
  minSelected?: number;
  maxSelected?: number;
};

export type FoodDish = {
  id: string;
  name: string;
  category: string;
  description: string;
  portion: string;
  weightGrams: number;
  price: number;
  /** Original catalog price when an unconditional promotion is included in price. */
  promotionBasePrice?: number;
  imageKey: string;
  imageUrl?: string | null;
  heroImageKey?: string;
  heroImageUrl?: string | null;
  available: boolean;
  optionIds: string[];
  optionGroups?: FoodOptionGroup[];
  defaultOptionIds?: string[];
  /** Optional restaurant-supplied product details. Missing values stay hidden. */
  originalPrice?: number;
  ingredients?: string;
  calories?: number;
  nutritionPer100g?: { calories: number; protein: number; fat: number; carbohydrates: number; estimated?: boolean };
  badge?: string;
  ratingPercent?: number;
  reviewCount?: number;
};

export type FoodRestaurantReview = {
  id: string;
  authorName: string;
  rating: number;
  createdAt: string;
  text: string;
  source?: string;
};

export type FoodPromotion = {
  id: string;
  title: string;
  type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY';
  value: number;
  minSubtotal: number;
  dishIds: string[];
  active: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
};

export type FoodRestaurant = {
  id: string;
  name: string;
  rating: number;
  reviewCount: number;
  /** Written customer feedback, when supplied by the restaurant catalog. */
  reviews?: FoodRestaurantReview[];
  ratingCount?: number;
  cuisine: string;
  categories: string[];
  etaMin: number;
  etaMax: number;
  deliveryFee: number;
  promotionBaseDeliveryFee?: number;
  promotions?: FoodPromotion[];
  freeDeliveryThreshold?: number;
  minimumOrder: number;
  address: string;
  latitude?: number;
  longitude?: number;
  phone: string | null;
  imageKey: string;
  imageUrl?: string | null;
  heroImageKey: string;
  heroImageUrl?: string | null;
  discountPercent?: number;
  menuCategories: string[];
  dishes: FoodDish[];
  options: FoodOption[];
  isDemo: boolean;
  /** A published restaurant may temporarily stop accepting orders. */
  isOpen?: boolean;
};

export type FoodCatalog = {
  restaurants: FoodRestaurant[];
  paymentMethods: { id: FoodPaymentMethod; name: string; available: boolean }[];
  isDemo: boolean;
};

export type HomeBanner = {
  id: string;
  title: string;
  subtitle: string;
  imageKey?: string | null;
  imageUrl?: string | null;
  actionType: 'NONE' | 'RESTAURANT' | 'FOOD' | 'TAXI';
  restaurantId?: string | null;
  sortOrder: number;
  active: boolean;
};

export type CartLine = {
  dishId: string;
  quantity: number;
  optionIds: string[];
};

export type FoodOrderStatus = 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'DELIVERING' | 'COMPLETED' | 'CANCELLED';
export type FoodFulfillment = 'DELIVERY' | 'PICKUP';

export type FoodOrderItem = {
  dishId: string;
  name: string;
  portion: string;
  imageKey: string;
  imageUrl?: string | null;
  quantity: number;
  unitPrice: number;
  options: FoodOption[];
  lineTotal: number;
};

export type FoodOrder = {
  id: string;
  status: FoodOrderStatus;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  restaurant: Pick<FoodRestaurant, 'id' | 'name' | 'rating' | 'reviewCount' | 'address' | 'phone' | 'imageKey' | 'imageUrl' | 'etaMin' | 'etaMax'>;
  items: FoodOrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: 'KGS';
  fulfillment: FoodFulfillment;
  address: string;
  comment: string;
  paymentMethod: FoodPaymentMethod;
  isDemo: boolean;
};

export type CreateFoodOrder = {
  requestId: string;
  restaurantId: string;
  items: CartLine[];
  fulfillment: FoodFulfillment;
  address?: string;
  comment?: string;
  paymentMethod: FoodPaymentMethod;
};
