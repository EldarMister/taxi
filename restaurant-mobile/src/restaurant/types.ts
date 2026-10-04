import type { FoodDish, FoodOption, FoodRestaurant, FoodOrder, FoodPromotion } from '../food/types';

export const permissions = [
  ['orders.read', 'Просмотр заказов'], ['orders.manage', 'Управление заказами'],
  ['menu.manage', 'Блюда и категории'], ['restaurant.manage', 'Информация о ресторане'],
  ['delivery.manage', 'Условия доставки'], ['promotions.manage', 'Акции и скидки'],
  ['stats.read', 'Статистика'], ['staff.manage', 'Сотрудники и права'],
] as const;
export type Permission = typeof permissions[number][0];
export type Membership = { restaurantId: string; restaurantName: string; role: 'OWNER' | 'MANAGER'; permissions: string[] };
export type Profile = { user: { id: string; name: string; phone: string }; memberships: Membership[] };
export type Session = Profile & { accessToken: string; refreshToken: string };
export type Promotion = FoodPromotion;
export type Catalog = FoodRestaurant & { latitude?: number; longitude?: number; promotions?: Promotion[] };
export type RestaurantDetail = { catalog: Catalog; active: boolean; updatedAt: string };
export type MerchantOrder = FoodOrder & {
  client: { name?: string; phone?: string }; deliveryMethod?: 'OWN' | 'ATLAS_CAR' | null;
  atlasOrderId?: string | null; deliveryLat?: number | null; deliveryLng?: number | null;
  deliveryPoint?: { latitude: number; longitude: number } | null;
  courierName?: string | null; courierPhone?: string | null;
  deliveryPrice?: number | null; atlasStatus?: string | null;
  atlasDelivery?: { id: string; status: string; price: number } | null;
};
export type StaffMember = { id: string; name: string; phone: string; role: 'OWNER' | 'MANAGER'; permissions: string[]; active: boolean };
export type Stats = { totalOrders: number; revenue: number; averageOrder: number; completedOrders: number; cancelledOrders: number; byDay: { date: string; orders: number; revenue: number }[] };
export type OrderAction = 'ACCEPT' | 'PREPARING' | 'READY' | 'COMPLETE' | 'CANCEL';
export const can = (membership: Membership | undefined, permission: Permission) => !!membership && (membership.role === 'OWNER' || membership.permissions.includes(permission));
export const money = (value: number) => `${Number(value || 0).toLocaleString('ru-RU')} сом`;
export const entityId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
export type { FoodDish, FoodOption };
