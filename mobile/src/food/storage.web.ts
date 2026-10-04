import type { CartLine } from './types';
import type { CheckoutDetails } from './CheckoutScreens';
export type FoodCart = { restaurantId: string; lines: CartLine[]; restaurantComment?: string; cutleryCount?: number };
export type FoodState = { restaurantId: string | null; lines: CartLine[]; carts?: FoodCart[]; favorites: string[]; favoriteDishes: string[]; address: string; checkout?: Omit<CheckoutDetails, 'address'>; pending?: { signature: string; requestId: string }; resumeCheckout?: boolean };
const states = new Map<string, FoodState>();
export async function readFoodState(userId: string): Promise<FoodState | null> { return states.get(userId) ?? null; }
export async function writeFoodState(userId: string, state: FoodState): Promise<void> { states.set(userId, state); }
