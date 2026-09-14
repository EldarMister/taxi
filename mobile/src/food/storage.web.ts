import type { CartLine } from './types';
export type FoodState = { restaurantId: string | null; lines: CartLine[]; favorites: string[]; favoriteDishes: string[]; address: string; checkout?: { fulfillment: 'DELIVERY'; comment: string; paymentMethod: 'CASH' | 'CARD' | 'ONLINE' }; pending?: { signature: string; requestId: string } };
const states = new Map<string, FoodState>();
export async function readFoodState(userId: string): Promise<FoodState | null> { return states.get(userId) ?? null; }
export async function writeFoodState(userId: string, state: FoodState): Promise<void> { states.set(userId, state); }
