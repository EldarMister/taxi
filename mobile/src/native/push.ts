import * as Device from 'expo-device';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Linking, Platform } from 'react-native';
import { driverSounds } from './driverSounds';

Notifications.setNotificationHandler({
  // Foreground driver audio is sequenced by the shared event ledger, not both push and socket.
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: !driverSounds.isDriver(), shouldSetBadge: false }),
});
export async function configureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  const channels = [
    { id: 'orders', name: 'Заказы и поездки', sound: 'default' },
    { id: 'driver-orders-v2', name: 'Новый заказ', sound: 'driver_new_order.wav' },
    { id: 'driver-messages-v1', name: 'Сообщения пассажира', sound: 'driver_passenger_message.wav' },
    { id: 'driver-completed-v1', name: 'Завершение поездки', sound: 'driver_trip_completed.wav' },
  ];
  await Promise.all(channels.map(({ id, ...channel }) => Notifications.setNotificationChannelAsync(id, {
    ...channel, audioAttributes: { usage: Notifications.AndroidAudioUsage.NOTIFICATION, contentType: Notifications.AndroidAudioContentType.SONIFICATION }, importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 200, 100, 200], lightColor: '#246BFD',
  })));
}
const PUSH_TOKEN_KEY = 'taxi.pushToken';
let pushGeneration = 0;
let registrationNetwork: Promise<unknown> | undefined;
let registration: Promise<string | null> | undefined;

export interface NotificationPermissionState { granted: boolean; canAskAgain: boolean; supported?: boolean }

export async function getNotificationPermissionState(): Promise<NotificationPermissionState> {
  if (Platform.OS === 'web') return { granted: false, canAskAgain: false, supported: false };
  try {
    const permission = await Notifications.getPermissionsAsync();
    return { granted: permission.status === 'granted', canAskAgain: permission.canAskAgain, supported: true };
  } catch { return { granted: false, canAskAgain: false, supported: false }; }
}

export async function openNotificationSettings(): Promise<void> {
  await Linking.openSettings();
}

export async function requestNotificationAccess(): Promise<NotificationPermissionState> {
  if (Platform.OS === 'web') return { granted: false, canAskAgain: false, supported: false };
  try {
    await configureNotificationChannels();
    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== 'granted' && permission.canAskAgain) permission = await Notifications.requestPermissionsAsync();
    return { granted: permission.status === 'granted', canAskAgain: permission.canAskAgain, supported: true };
  } catch { return { granted: false, canAskAgain: false, supported: false }; }
}

export async function registerPushNotifications(): Promise<string | null> {
  if (registration) return registration;
  // Delivery registration is independent of the OS permission. A temporary
  // provider/network failure must never block entering the app or disable it.
  registration = registerPush().catch(() => null).finally(() => { registration = undefined; });
  return registration;
}

async function registerPush(): Promise<string | null> {
  await configureNotificationChannels();
  if (Platform.OS === 'web') return null;
  const generation = pushGeneration;
  const permission = await getNotificationPermissionState();
  if (!permission.granted || !Device.isDevice) return null;
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID || Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
  if (!projectId) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let result: { data: string };
  try {
    result = await Promise.race([
      Notifications.getExpoPushTokenAsync({ projectId }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Push registration timed out')), 12000); }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
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
  let active = true;
  void Notifications.getLastNotificationResponseAsync().then(response => {
    if (!active || !response) return;
    const id = response.notification.request.content.data.orderId;
    handler(typeof id === 'string' ? id : undefined);
    void Notifications.clearLastNotificationResponseAsync();
  });
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const id = response.notification.request.content.data.orderId;
    handler(typeof id === 'string' ? id : undefined);
  });
  return () => { active = false; subscription.remove(); };
}

export function onNotificationReceived(handler: (data: Record<string, unknown>) => void): () => void {
  const subscription = Notifications.addNotificationReceivedListener(notification => handler(notification.request.content.data));
  return () => subscription.remove();
}
