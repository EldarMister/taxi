import { NativeModules, Platform } from 'react-native';
import YaMap, { Search, Suggest } from 'react-native-yamap';

export interface MapPoint { latitude: number; longitude: number; address?: string }
export type MapAddress = MapPoint & { address: string };
export const BISHKEK: MapPoint = { latitude: 42.8746, longitude: 74.5698 };
export const mapKitKey = process.env.EXPO_PUBLIC_YANDEX_MAPKIT_KEY?.trim();
let initialization: Promise<void> | undefined;

export function initializeMapKit(): Promise<void> {
  if (!mapKitKey) return Promise.reject(new Error(__DEV__ ? 'Карта пока недоступна. Добавьте ключ Yandex MapKit в настройки приложения.' : 'Карта временно недоступна. Попробуйте позже.'));
  if (!NativeModules.yamap || Platform.OS === 'web') return Promise.reject(new Error('Карта работает в установленном приложении Android или iOS.'));
  // iOS AppDelegate initializes before React Native. Setting its key again after
  // sharedInstance creation is forbidden by MapKit.
  initialization ??= (Platform.OS === 'ios' ? Promise.resolve() : YaMap.init(mapKitKey)).catch((error) => { initialization = undefined; throw error; });
  return initialization;
}

const nativePoint = (point: MapPoint) => ({ lat: point.latitude, lon: point.longitude });
const isCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// The native Search module maintains one session on iOS: serialize lookups so a
// later address request cannot cancel a previous one and leave it unresolved.
let searchQueue: Promise<unknown> = Promise.resolve();
function queued<T>(work: (isCancelled: () => boolean) => Promise<T>): Promise<T> {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => {
      cancelled = true;
      reject(new Error('Поиск занял слишком много времени. Проверьте интернет и повторите попытку.'));
    }, 18000);
  });
  const start = () => {
    if (cancelled) throw new Error('Время поиска истекло. Повторите попытку.');
    return work(() => cancelled);
  };
  const operation = Promise.race([searchQueue.then(start, start), timeout]).finally(() => clearTimeout(timer));
  // Releasing this queue on timeout allows retry even if native promise hangs.
  // Cancelled work checks its flag before making another native search call.
  searchQueue = operation.catch(() => undefined);
  return operation;
}

export async function searchAddresses(query: string, center: MapPoint = BISHKEK): Promise<MapAddress[]> {
  if (query.trim().length < 3) return [];
  await initializeMapKit();
  return queued(async (isCancelled) => {
    const suggestions = await Suggest.suggestWithCoords(query.trim(), {
      userPosition: nativePoint(center),
      boundingBox: {
        southWest: { lat: center.latitude - 0.4, lon: center.longitude - 0.5 },
        northEast: { lat: center.latitude + 0.4, lon: center.longitude + 0.5 },
      },
      suggestWords: false,
    });
    const results: MapAddress[] = [];
    for (const item of suggestions.slice(0, 6)) {
      if (isCancelled()) throw new Error('Время поиска истекло. Повторите попытку.');
      const address = [item.title, item.subtitle].filter(Boolean).join(', ');
      let point: { lat?: number; lon?: number } = item;
      if (!isCoordinate(point.lat) || !isCoordinate(point.lon)) {
        // Wrapper typings for geocodeAddress are inaccurate; native returns a point.
        point = await Search.geocodeAddress(address) as unknown as typeof point;
      }
      if (isCoordinate(point?.lat) && isCoordinate(point?.lon)) results.push({ latitude: point.lat, longitude: point.lon, address });
    }
    return results;
  });
}

export async function reverseGeocode(point: MapPoint): Promise<MapAddress> {
  await initializeMapKit();
  return queued(async () => {
    const address = await Search.geocodePoint(nativePoint(point));
    if (!address?.formatted) throw new Error('Адрес этой точки не найден. Выберите ближайший адрес.');
    return { ...point, address: address.formatted };
  });
}
