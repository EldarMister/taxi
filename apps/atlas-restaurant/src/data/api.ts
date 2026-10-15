import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { resolveApiUrl } from '../../config/api.cjs';
import { ApiError, createRestaurantApi } from './apiCore';

export { ApiError, StaleSessionError } from './apiCore';
export const API_URL: string = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL);
export const SESSION_KEY = 'atlas.restaurant.session.v2';
const LEGACY_KEY = 'atlas.restaurant.session.v1';
let webSession: string | null = null;

// Browser refresh deliberately requires sign-in: merchant tokens never enter localStorage.
const storage = Platform.OS === 'web' ? {
  read: async () => webSession,
  write: async (value: string) => { webSession = value; },
  clear: async () => { webSession = null; },
} : {
  read: async () => (await SecureStore.getItemAsync(SESSION_KEY)) ?? SecureStore.getItemAsync(LEGACY_KEY),
  write: async (value: string) => {
    await SecureStore.setItemAsync(SESSION_KEY, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    await SecureStore.deleteItemAsync(LEGACY_KEY);
  },
  clear: async () => { await SecureStore.deleteItemAsync(SESSION_KEY); await SecureStore.deleteItemAsync(LEGACY_KEY); },
};
const client = createRestaurantApi({ baseUrl: API_URL, storage, transport: (url, init) => fetch(url, init) });

export type UploadImage = { uri: string; name?: string; mimeType?: string; fileSize?: number };
export const api = {
  ...client,
  async upload(restaurantId: string, file: UploadImage): Promise<{ url: string }> {
    if (file.fileSize !== undefined && file.fileSize > 8 * 1024 * 1024) throw new ApiError('Фотография должна быть меньше 8 МБ.', 400);
    const mimeType = file.mimeType || 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) throw new ApiError('Выберите фотографию JPEG, PNG или WebP.', 400);
    const scope = client.scope(restaurantId);
    const form = new FormData();
    try {
      if (Platform.OS === 'web') {
        const response = await fetch(file.uri);
        const blob = await response.blob();
        if (blob.size > 8 * 1024 * 1024) throw new ApiError('Фотография должна быть меньше 8 МБ.', 400);
        form.append('file', blob, file.name || 'restaurant-photo.jpg');
      } else {
        form.append('file', { uri: file.uri, name: file.name || 'restaurant-photo.jpg', type: mimeType } as unknown as Blob);
      }
      return await scope.request<{ url: string }>('/media', 'POST', form);
    } finally { scope.dispose(); }
  },
};

/** Media returned by the backend is origin-relative, not relative to /restaurant. */
export function mediaUrl(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^https:\/\//i.test(value)) return value;
  if (value.startsWith('/api/content/media/')) return `${new URL(API_URL).origin}${value}`;
  return undefined;
}
