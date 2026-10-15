/** Merchant contracts independently described from server/src/restaurant*.ts. */
export const permissions = [
  ['orders.read', 'Просмотр заказов'], ['orders.manage', 'Управление заказами'],
  ['menu.manage', 'Меню и модификаторы'], ['restaurant.manage', 'Информация о ресторане'],
  ['delivery.manage', 'Условия доставки'], ['promotions.manage', 'Акции'],
  ['stats.read', 'Статистика'], ['staff.manage', 'Сотрудники и права'],
] as const;
export type Permission = typeof permissions[number][0];
export type Membership = { restaurantId: string; restaurantName: string; role: 'OWNER' | 'MANAGER'; permissions: string[] };
export type Profile = { user: { id: string; name: string; phone: string }; memberships: Membership[] };
export type Session = Profile & { accessToken: string; refreshToken: string; expiresIn: number };
export const can = (member: Pick<Membership, 'role' | 'permissions'> | undefined | null, permission: Permission): boolean =>
  !!member && (member.role === 'OWNER' || member.permissions.includes(permission));
export const money = (amount: number): string => `${(Number.isFinite(amount) ? amount : 0).toLocaleString('ru-RU')} сом`;
export const entityId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export type Option = { id: string; name: string; price: number; imageKey: string; imageUrl?: string | null; priceScope?: 'PER_PORTION' | 'PER_ITEM' };
export type OptionGroup = { id: string; name: string; optionIds: string[]; minSelected?: number; maxSelected?: number };
export type Dish = {
  id: string; name: string; category: string; description: string; portion: string; weightGrams: number;
  price: number; imageKey: string; imageUrl?: string | null; heroImageKey?: string; heroImageUrl?: string | null;
  available: boolean; optionIds: string[]; optionGroups?: OptionGroup[]; defaultOptionIds?: string[];
  originalPrice?: number; ingredients?: string; calories?: number;
  nutritionPer100g?: { calories: number; protein: number; fat: number; carbohydrates: number; estimated?: boolean };
  badge?: string; ratingPercent?: number; reviewCount?: number;
};
export type Promotion = {
  id: string; title: string; type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY'; value: number; minSubtotal: number;
  dishIds: string[]; active: boolean; startsAt?: string | null; endsAt?: string | null;
};
export type Restaurant = {
  id: string; name: string; cuisine: string; categories: string[]; address: string; phone: string | null;
  latitude?: number; longitude?: number; imageKey: string; imageUrl?: string | null;
  heroImageKey: string; heroImageUrl?: string | null; isOpen?: boolean;
  etaMin: number; etaMax: number; deliveryFee: number; freeDeliveryThreshold?: number; minimumOrder: number;
  menuCategories: string[]; dishes: Dish[]; options: Option[]; promotions?: Promotion[]; discountPercent?: number;
  rating: number; reviewCount: number; ratingCount?: number; isDemo: boolean;
  reviews?: { id: string; authorName: string; rating: number; createdAt: string; text: string; source?: string }[];
};
export type Catalog = Restaurant;
export type RestaurantCatalog = Restaurant;
export type RestaurantDetail = { catalog: Catalog; active: boolean; updatedAt: string };
export type FoodDish = Dish;
export type FoodOption = Option;
export type FoodOptionGroup = OptionGroup;
export type FoodRestaurant = Restaurant;

export type OrderStatus = 'PLACED' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'DELIVERING' | 'COMPLETED' | 'CANCELLED';
export type OrderAction = 'ACCEPT' | 'PREPARING' | 'READY' | 'COMPLETE' | 'CANCEL';
export type OrderItem = { dishId: string; name: string; portion: string; imageKey: string; imageUrl?: string | null; quantity: number; unitPrice: number; options: Option[]; lineTotal: number };
export type OrderHistory = { id: string; status: OrderStatus; createdAt: string; reason: string | null; actorId?: string };
export type MerchantOrder = {
  id: string; restaurantId: string; restaurantSnapshot: Pick<Restaurant, 'id' | 'name' | 'address'>;
  items: OrderItem[]; client: { name: string | null; phone: string }; status: OrderStatus;
  subtotal: number; deliveryFee: number; total: number; fulfillment: 'PICKUP' | 'DELIVERY';
  address: string; comment: string; paymentMethod: string; isDemo: boolean;
  createdAt: string; updatedAt: string; completedAt?: string | null;
  deliveryPoint?: { latitude: number; longitude: number } | null; deliveryMethod?: 'OWN' | 'ATLAS_CAR' | null;
  courierName?: string | null; courierPhone?: string | null; deliveryLat?: number | null; deliveryLng?: number | null;
  atlasOrderId?: string | null; atlasStatus?: string | null; deliveryPrice?: number | null;
  atlasDelivery?: { id: string; status: string; price: number; driverId?: string | null; driver?: { name: string | null; phone: string } | null } | null;
  /** Present only on server versions that include the read-only history relation. */
  history?: OrderHistory[];
};
export type DispatchInput = { method: 'OWN' | 'ATLAS_CAR'; courierName?: string; courierPhone?: string; deliveryLat?: number; deliveryLng?: number; expectedPrice?: number };
export type DeliveryQuote = { price: number; currency: 'KGS'; deliveryPayer: 'RESTAURANT' };
export type Staff = { id: string; name: string; phone: string; role: 'OWNER' | 'MANAGER'; permissions: string[]; active: boolean };
export type StaffMember = Staff;
export type StaffInput = { name?: string; phone?: string; password?: string; active?: boolean; permissions?: string[] };
export type StatsPeriod = 'day' | 'week' | 'month' | 'all';
export type Stats = { totalOrders: number; revenue: number; averageOrder: number; completedOrders: number; cancelledOrders: number; byDay: { date: string; orders: number; revenue: number }[] };
