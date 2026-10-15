import * as SecureStore from 'expo-secure-store';
import { savedPermissionStep, type PermissionIntroState, type PermissionRole } from '../permissionFlow';

export interface SessionTokens { accessToken: string; refreshToken: string }
const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
let storageQueue: Promise<unknown> = Promise.resolve();
function serializeStorage<T>(work: () => Promise<T>): Promise<T> {
  const operation = storageQueue.then(work, work);
  storageQueue = operation.catch(() => undefined);
  return operation;
}

export async function readTokens(): Promise<SessionTokens | null> {
  await storageQueue;
  const stored = await SecureStore.getItemAsync('taxi.session', options);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<SessionTokens>;
      if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') return parsed as SessionTokens;
    } catch { /* An interrupted/invalid record is treated as an expired session. */ }
    return null;
  }
  // Migration path for an earlier installation that stored tokens separately.
  const [accessToken, refreshToken] = await Promise.all([
    SecureStore.getItemAsync('taxi.accessToken', options),
    SecureStore.getItemAsync('taxi.refreshToken', options),
  ]);
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export async function writeTokens(tokens: SessionTokens): Promise<void> {
  // One Keychain/Keystore value keeps a rotated token pair atomic.
  await serializeStorage(() => SecureStore.setItemAsync('taxi.session', JSON.stringify(tokens), options));
}

export async function clearTokens(): Promise<void> {
  await serializeStorage(() => Promise.all([
    SecureStore.deleteItemAsync('taxi.session', options),
    SecureStore.deleteItemAsync('taxi.accessToken', options),
    SecureStore.deleteItemAsync('taxi.refreshToken', options),
  ]).then(() => undefined));
}

export async function readLastOrderId(): Promise<string | null> {
  await storageQueue;
  return SecureStore.getItemAsync('taxi.lastOrderId', options);
}

export async function writeLastOrderId(id: string | null): Promise<void> {
  await serializeStorage(() => id
    ? SecureStore.setItemAsync('taxi.lastOrderId', id, options)
    : SecureStore.deleteItemAsync('taxi.lastOrderId', options));
}

export type { PermissionIntroState } from '../permissionFlow';
const permissionIntroKey = (userId: string) => `taxi.permissionIntro.v1.${userId}`;
const permissionFlowKey = (userId: string, role: PermissionRole) => `taxi.permissionIntro.v2.${role.toLowerCase()}.${userId}`;
const deletedPermissionAccounts = new Set<string>();

export async function readPermissionIntro(userId: string, role: PermissionRole = 'CLIENT'): Promise<PermissionIntroState> {
  await storageQueue;
  const value = await SecureStore.getItemAsync(permissionFlowKey(userId, role), options);
  if (value != null) return savedPermissionStep(value, role);
  // Completed accounts retain their result. Unfinished legacy flows restart
  // at notifications so the changed order cannot skip a required step.
  const legacy = await SecureStore.getItemAsync(permissionIntroKey(userId), options);
  return legacy === 'done' ? 'done' : 'notifications';
}

export async function writePermissionIntro(userId: string, value: PermissionIntroState, role: PermissionRole = 'CLIENT'): Promise<void> {
  await serializeStorage(async () => { if (!deletedPermissionAccounts.has(userId)) await SecureStore.setItemAsync(permissionFlowKey(userId, role), savedPermissionStep(value, role), options); });
}

export async function clearPermissionIntro(userId: string): Promise<void> {
  deletedPermissionAccounts.add(userId);
  await serializeStorage(() => Promise.all([
    SecureStore.deleteItemAsync(permissionIntroKey(userId), options),
    SecureStore.deleteItemAsync(permissionFlowKey(userId, 'CLIENT'), options),
    SecureStore.deleteItemAsync(permissionFlowKey(userId, 'DRIVER'), options),
  ]).then(() => undefined));
}
