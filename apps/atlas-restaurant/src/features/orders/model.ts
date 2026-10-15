import type { DispatchInput, MerchantOrder, OrderAction, OrderStatus } from '../../domain/types';

export const statusLabels: Record<OrderStatus, string> = {
  PLACED: 'Новый', CONFIRMED: 'Принят', PREPARING: 'Готовится', READY: 'Готов к выдаче',
  DELIVERING: 'В доставке', COMPLETED: 'Завершён', CANCELLED: 'Отменён',
};
export const atlasLabels: Record<string, string> = {
  SEARCHING: 'Ищем машину', ASSIGNED: 'Водитель назначен', ARRIVED: 'Водитель у ресторана',
  IN_PROGRESS: 'В пути к клиенту', COMPLETED: 'Доставлено', CANCELLED: 'Вызов отменён', NO_DRIVER: 'Машина не найдена',
};
export const activeAtlas = (order: MerchantOrder) => ['SEARCHING', 'ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.atlasStatus || order.atlasDelivery?.status || '');
export const activeOrder = (order: MerchantOrder) => order.status !== 'COMPLETED' && order.status !== 'CANCELLED';
export const orderNumber = (order: MerchantOrder) => order.id.slice(-6).toUpperCase();
export function allowedActions(order: MerchantOrder): OrderAction[] {
  const next: OrderAction[] = [];
  if (order.status === 'PLACED') next.push('ACCEPT');
  if (order.status === 'CONFIRMED') next.push('PREPARING');
  if (order.status === 'PREPARING') next.push('READY');
  if (!activeAtlas(order)) {
    if (order.status === 'READY' && order.fulfillment === 'PICKUP' || order.status === 'DELIVERING') next.push('COMPLETE');
    if (activeOrder(order)) next.push('CANCEL');
  }
  return next;
}
export function canDispatch(order: MerchantOrder): boolean {
  return order.fulfillment === 'DELIVERY' && order.status === 'READY' && !activeAtlas(order)
    && (!order.atlasDelivery || ['CANCELLED', 'NO_DRIVER'].includes(order.atlasDelivery.status));
}
export function scopedOrders(orders: MerchantOrder[], restaurantId: string): MerchantOrder[] {
  return orders.filter(order => order.restaurantId === restaurantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export const actionStatus: Record<OrderAction, OrderStatus> = { ACCEPT: 'CONFIRMED', PREPARING: 'PREPARING', READY: 'READY', COMPLETE: 'COMPLETED', CANCEL: 'CANCELLED' };
export function destination(order: MerchantOrder): { latitude: number; longitude: number } | null {
  const value = order.deliveryPoint || (order.deliveryLat != null && order.deliveryLng != null ? { latitude: order.deliveryLat, longitude: order.deliveryLng } : null);
  return value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude) && Math.abs(value.latitude) <= 90 && Math.abs(value.longitude) <= 180 ? value : null;
}
export function fallbackCoordinates(latitude: string, longitude: string): Pick<DispatchInput, 'deliveryLat' | 'deliveryLng'> {
  const lat = Number(latitude.trim().replace(',', '.'));
  const lng = Number(longitude.trim().replace(',', '.'));
  if (!latitude.trim() || !longitude.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('Укажите корректную широту и долготу адреса клиента.');
  }
  return { deliveryLat: lat, deliveryLng: lng };
}
export type OrderFilter = 'active' | 'new' | 'preparing' | 'ready' | 'history';
export function filterOrders(orders: MerchantOrder[], filter: OrderFilter, search: string): MerchantOrder[] {
  const query = search.trim().toLocaleLowerCase('ru');
  return orders.filter(order => {
    const matching = filter === 'active' ? activeOrder(order) : filter === 'new' ? order.status === 'PLACED'
      : filter === 'preparing' ? ['CONFIRMED', 'PREPARING'].includes(order.status)
        : filter === 'ready' ? ['READY', 'DELIVERING'].includes(order.status) : !activeOrder(order);
    return matching && (!query || [orderNumber(order), order.client?.name, order.client?.phone, order.address, ...order.items.map(item => item.name)].join(' ').toLocaleLowerCase('ru').includes(query));
  });
}

/** Keep notifications stable across reconnects; never mix another restaurant's basket. */
export class OrderTracker {
  private known = new Set<string>();
  private initialized = false;
  constructor(readonly restaurantId: string) {}
  receive(input: MerchantOrder[]): { orders: MerchantOrder[]; unseen: string[]; initial: boolean } {
    const orders = scopedOrders(input, this.restaurantId);
    const initial = !this.initialized;
    const unseen = orders.filter(order => !this.known.has(order.id) && (initial ? order.status === 'PLACED' : activeOrder(order))).map(order => order.id);
    orders.forEach(order => this.known.add(order.id));
    this.initialized = true;
    return { orders, unseen, initial };
  }
}
