import * as Location from 'expo-location';
import type { MapPoint } from './mapkit';

export async function getCurrentPosition(): Promise<MapPoint & { accuracy?: number }> {
  if (!await Location.hasServicesEnabledAsync()) throw new Error('Включите геолокацию в настройках устройства.');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') throw new Error('Разрешите доступ к местоположению или выберите адрес вручную.');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const location = await Promise.race([
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Не удалось определить местоположение. Попробуйте ещё раз или выберите адрес вручную.')), 15000);
    }),
  ]).finally(() => { if (timeout) clearTimeout(timeout); });
  return { latitude: location.coords.latitude, longitude: location.coords.longitude, accuracy: location.coords.accuracy ?? undefined };
}
