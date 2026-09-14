import * as SecureStore from 'expo-secure-store';
import type { CartLine } from './types';

export type FoodState = { restaurantId: string | null; lines: CartLine[]; favorites: string[]; favoriteDishes: string[]; address: string; checkout?: { fulfillment: 'DELIVERY'; comment: string; paymentMethod: 'CASH' | 'CARD' | 'ONLINE' }; pending?: { signature: string; requestId: string } };
const key = (userId: string) => `taxi.food.v1.${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
let queue: Promise<unknown> = Promise.resolve();
export async function readFoodState(userId: string): Promise<FoodState | null> {
  await queue;
  const raw = await SecureStore.getItemAsync(key(userId));
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.lines) || !Array.isArray(data.favorites) || !Array.isArray(data.favoriteDishes)) return null;
    return {
      restaurantId: typeof data.restaurantId === 'string' ? data.restaurantId : null,
      lines: data.lines.filter((line: CartLine) => typeof line.dishId === 'string' && Number.isInteger(line.quantity) && line.quantity > 0 && line.quantity <= 20 && Array.isArray(line.optionIds) && line.optionIds.every(id => typeof id === 'string')),
      favorites: data.favorites.filter((id: unknown) => typeof id === 'string'),
      favoriteDishes: data.favoriteDishes.filter((id: unknown) => typeof id === 'string'),
      address: typeof data.address === 'string' ? data.address : '',
      ...(['DELIVERY', 'PICKUP'].includes(data.checkout?.fulfillment) && ['CASH', 'CARD', 'ONLINE'].includes(data.checkout?.paymentMethod) && typeof data.checkout?.comment === 'string' ? { checkout: { ...data.checkout, fulfillment: 'DELIVERY' as const } } : {}),
      ...(typeof data.pending?.signature === 'string' && typeof data.pending?.requestId === 'string' ? { pending: data.pending } : {}),
    };
  } catch { return null; }
}
export function writeFoodState(userId: string, state: FoodState): Promise<void> {
  const operation = queue.then(() => SecureStore.setItemAsync(key(userId), JSON.stringify(state)));
  queue = operation.catch(() => undefined);
  return operation;
}
