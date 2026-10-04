import type { ImageSourcePropType } from 'react-native';
import { foodPhotoRegion } from './foodPhotography';

const { resolveApiUrl } = require('../../config/api.cjs') as { resolveApiUrl: (value?: string) => string };
const apiOrigin = new URL(resolveApiUrl(process.env.EXPO_PUBLIC_API_URL)).origin;

export function foodImage(key?: string | null, imageUrl?: string | null, fallbackKey?: string | null): ImageSourcePropType {
  const url = imageUrl?.trim();
  if (url?.startsWith('/api/content/media/')) return { uri: `${apiOrigin}${url}` };
  if (url && /^https?:\/\//i.test(url)) return { uri: url };
  return foodPhotoRegion(key, fallbackKey)?.source ?? require('../../assets/icon.png');
}
