import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';
import type { MapPoint } from './mapkit';

export interface LocationPermissionState {
  granted: boolean;
  canAskAgain: boolean;
  servicesEnabled: boolean;
}

export async function getLocationPermissionState(): Promise<LocationPermissionState> {
  const [permission, servicesEnabled] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.hasServicesEnabledAsync().catch(() => false),
  ]);
  return { granted: permission.status === 'granted', canAskAgain: permission.canAskAgain, servicesEnabled };
}

export async function requestLocationAccess(): Promise<LocationPermissionState> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.status !== 'granted' && permission.canAskAgain) {
    await Location.requestForegroundPermissionsAsync();
    // The request result may arrive before Android has exposed the new grant to
    // subsequent consumers. Re-read the authoritative state before deciding.
    permission = await Location.getForegroundPermissionsAsync();
  }
  const servicesEnabled = await Location.hasServicesEnabledAsync().catch(() => false);
  return { granted: permission.status === 'granted', canAskAgain: permission.canAskAgain, servicesEnabled };
}

export async function openLocationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      const state = await getLocationPermissionState();
      if (state.granted && !state.servicesEnabled) {
        await Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
        return;
      }
    } catch { /* Fall back to the app settings page below. */ }
  }
  await Linking.openSettings();
}

async function ensureLocationAccess(): Promise<void> {
  const permission = await requestLocationAccess();
  if (!permission.granted) {
    if (!permission.canAskAgain) throw new Error('Разрешите доступ к местоположению в настройках устройства.');
    throw new Error('Разрешите доступ к местоположению или выберите адрес вручную.');
  }

  let servicesEnabled = permission.servicesEnabled;
  if (!servicesEnabled && Platform.OS === 'android') {
    try { await Location.enableNetworkProviderAsync(); } catch { /* The user can still open system settings or enter an address. */ }
    servicesEnabled = await Location.hasServicesEnabledAsync();
  }
  if (!servicesEnabled) throw new Error('Включите геолокацию в настройках устройства.');
}

function timeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('location-timeout')), milliseconds);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export async function getCurrentPosition(): Promise<MapPoint & { accuracy?: number }> {
  await ensureLocationAccess();
  const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 30_000, requiredAccuracy: 80 }).catch(() => null);
  const cachedAge = lastKnown ? Date.now() - lastKnown.timestamp : Infinity;
  const cachedAccuracy = lastKnown?.coords.accuracy ?? Infinity;
  // Only an almost-current precise fix can recenter the map immediately.
  if (lastKnown && cachedAge >= -5000 && cachedAge <= 15_000 && cachedAccuracy <= 35) {
    return { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude, accuracy: lastKnown.coords.accuracy ?? undefined };
  }
  let location: Location.LocationObject;
  try {
    location = await timeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High, mayShowUserSettingsDialog: true }), 15_000);
  } catch {
    if (!lastKnown || cachedAge < -5000 || cachedAge > 30_000 || cachedAccuracy > 80) throw new Error('Не удалось определить точное местоположение. Попробуйте ещё раз или выберите адрес вручную.');
    location = lastKnown;
  }
  if (!Number.isFinite(location.coords.latitude) || !Number.isFinite(location.coords.longitude)
    || (location.coords.accuracy ?? Infinity) > 80 || Date.now() - location.timestamp > 30_000) {
    throw new Error('Не удалось определить точное местоположение. Попробуйте ещё раз или выберите адрес вручную.');
  }
  return { latitude: location.coords.latitude, longitude: location.coords.longitude, accuracy: location.coords.accuracy ?? undefined };
}
