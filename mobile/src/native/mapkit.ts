import { api, ApiError } from '../api';
import type { Language } from '../types';

export interface MapPoint { latitude: number; longitude: number; address?: string }
export type MapAddress = MapPoint & { address: string };
export const BISHKEK: MapPoint = { latitude: 42.8746, longitude: 74.5698 };

async function localizedRequest<T>(path: string, language: Language, signal?: AbortSignal): Promise<T> {
  if (language !== 'ky') return api.request(path, {signal});
  try { return await api.request(`${path}&language=ky`, {signal}); }
  catch (error) {
    // Older deployed APIs reject unknown query fields. Keep address selection
    // usable until the matching server version is rolled out.
    if (!(error instanceof ApiError) || error.status !== 400 || !error.message.includes('property language should not exist')) throw error;
    return api.request(path, {signal});
  }
}

// Both installed apps and web use the protected server geocoder, its cache and rate limits.
export async function searchAddresses(query: string, center: MapPoint = BISHKEK, signal?: AbortSignal, language: Language = 'ru'): Promise<MapAddress[]> {
  const text = query.trim();
  if (text.length < 2) return [];
  return localizedRequest('/places/search?q=' + encodeURIComponent(text) + '&latitude=' + center.latitude + '&longitude=' + center.longitude, language, signal);
}

export async function reverseGeocode(point: MapPoint, language: Language = 'ru'): Promise<MapAddress> {
  return localizedRequest('/places/reverse?latitude=' + point.latitude + '&longitude=' + point.longitude, language);
}
