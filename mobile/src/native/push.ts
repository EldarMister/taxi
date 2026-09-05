import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});
const PUSH_TOKEN_KEY = 'taxi.pushToken';
let pushGeneration = 0;
let registrationNetwork: Promise<unknown> | undefined;
let registration: Promise<string | null> | undefined;

export async function registerPushNotifications(): Promise<string | null> {
  if (registration) return registration;
  registration = registerPush().finally(() => { registration = undefined; });
  return registration;
}

async function registerPush(): Promise<string | null> {
  if (!Device.isDevice || Platform.OS === 'web') return null;
  const generation = pushGeneration;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('orders', {
    name: 'Заказы и поездки', importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 100, 200], lightColor: '#246BFD',
  });
  let permission = await Notifications.getPermissionsAsync();
  if (permission.status !== 'granted') permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== 'granted') return null;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) throw new Error('Push-уведомления пока не подключены. Статусы поездки доступны в приложении.');
  const result = await Notifications.getExpoPushTokenAsync({ projectId });
  if (generation !== pushGeneration) return null;
  const { api } = await import('../api');
  if (!api.getTokens() || generation !== pushGeneration) return null;
  await SecureStore.setItemAsync(PUSH_TOKEN_KEY, result.data);
  if (generation !== pushGeneration) return null;
  const operation = api.request('/users/me/push-token', { method: 'POST', body: JSON.stringify({ token: result.data, platform: Platform.OS }) });
  registrationNetwork = operation;
  try { await operation; }
  finally { if (registrationNetwork === operation) registrationNetwork = undefined; }
  return result.data;
}

// Call before api.clear() so the DELETE still has the current authentication.
export async function unregisterPushNotifications(): Promise<void> {
  pushGeneration += 1;
  if (Platform.OS === 'web') return;
  // A POST already in flight must finish before its matching DELETE, otherwise
  // a late registration could reattach a logged-out account to this device.
  await registrationNetwork?.catch(() => undefined);
  const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY);
  if (!token) return;
  const { api } = await import('../api');
  if (api.getTokens()) await api.request('/users/me/push-token', { method: 'DELETE', body: JSON.stringify({ token }) });
  await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
}

export function onNotificationOpened(handler: (orderId: string | undefined) => void): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const id = response.notification.request.content.data.orderId;
    handler(typeof id === 'string' ? id : undefined);
  });
  return () => subscription.remove();
}
