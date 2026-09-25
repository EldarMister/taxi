import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api, ApiError } from '../api';
import { isRoleAllowed } from '../appVariant';

const TASK = 'taxigo-driver-available-v1';
const KEY = 'taxi.driverAvailability.v1';
let operation: Promise<unknown> = Promise.resolve();

/** Keep an online, idle driver's position fresh after the screen is locked. */
export function setDriverAvailability(enabled: boolean, userId?: string): Promise<boolean> {
  const pending = operation.catch(() => undefined).then(async () => {
    if (Platform.OS === 'web' || !isRoleAllowed('DRIVER')) return false;
    if (!enabled || !userId) {
      await SecureStore.deleteItemAsync(KEY);
      if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
      return false;
    }
    const permission = await Location.getBackgroundPermissionsAsync();
    if (!permission.granted) return false;
    const foreground = await Location.getForegroundPermissionsAsync();
    if (!foreground.granted || (Platform.OS === 'android' && foreground.android?.accuracy === 'coarse')) return false;
    await SecureStore.setItemAsync(KEY, userId);
    if (!await Location.hasStartedLocationUpdatesAsync(TASK)) {
      try {
        await Location.startLocationUpdatesAsync(TASK, {
          accuracy: Location.Accuracy.High, timeInterval: 10_000, distanceInterval: 10,
          pausesUpdatesAutomatically: false,
          foregroundService: {
            notificationTitle: 'Atlas pro · на линии',
            notificationBody: 'Геолокация помогает получать заказы рядом',
            notificationColor: '#2477F3',
            killServiceOnDestroy: false,
          },
        });
      } catch (error) {
        await SecureStore.deleteItemAsync(KEY);
        throw error;
      }
    }
    return true;
  });
  operation = pending;
  return pending;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !isRoleAllowed('DRIVER')) return;
  const userId = await SecureStore.getItemAsync(KEY);
  if (!userId) {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
    return;
  }
  if (!api.getTokens()) await api.restore();
  if (!api.getTokens()) return;
  const location = [...(data?.locations || [])].reverse().find(item => {
    const { latitude, longitude, accuracy } = item.coords;
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && accuracy != null && accuracy >= 0 && accuracy <= 80
      && item.timestamp <= Date.now() + 5000 && Date.now() - item.timestamp <= 30_000;
  });
  if (!location) return;
  try {
    await api.patch('/driver/position', {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracyM: location.coords.accuracy,
      measuredAtMs: location.timestamp,
    });
  } catch (failure) {
    if (failure instanceof ApiError && [401, 403].includes(failure.status)) {
      await SecureStore.deleteItemAsync(KEY);
      if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
    }
  }
});
