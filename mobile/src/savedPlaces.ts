import * as SecureStore from 'expo-secure-store';
import type { Point } from './types';

export type SavedPlaceKind = 'home' | 'work' | 'favorite';
export type SavedPlaces = Partial<Record<SavedPlaceKind, Point>>;

const key = (userId: string) => `taxi.saved-places.v1.${userId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
const deletedAccounts = new Set<string>();
let writes: Promise<unknown> = Promise.resolve();

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<Point>;
  return typeof point.address === 'string' && point.address.trim().length > 0 && point.address.length <= 250
    && typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

export async function readSavedPlaces(userId: string): Promise<SavedPlaces> {
  await writes;
  if (deletedAccounts.has(userId)) return {};
  const raw = await SecureStore.getItemAsync(key(userId));
  if (!raw) return {};
  try {
    const stored = JSON.parse(raw) as Record<string, unknown>;
    if (!stored || typeof stored !== 'object') return {};
    return {
      ...(validPoint(stored.home) ? { home: stored.home } : {}),
      ...(validPoint(stored.work) ? { work: stored.work } : {}),
      ...(validPoint(stored.favorite) ? { favorite: stored.favorite } : {}),
    };
  } catch { return {}; }
}

export async function writeSavedPlaces(userId: string, places: SavedPlaces): Promise<void> {
  const operation = writes.then(async () => { if (!deletedAccounts.has(userId)) await SecureStore.setItemAsync(key(userId), JSON.stringify(places)); });
  writes = operation.catch(() => undefined);
  await operation;
}

export async function clearSavedPlaces(userId: string): Promise<void> {
  deletedAccounts.add(userId);
  const operation = writes.then(() => SecureStore.deleteItemAsync(key(userId)));
  writes = operation.catch(() => undefined);
  await operation;
}
