import { clearSavedPlaces } from './savedPlaces';
import { clearFoodState } from './food/storage';
import { deleteRegistrationDraft } from './registration/storage';
import { clearPermissionIntro, writeLastOrderId } from './native/sessionStore';
import { forgetPushNotifications } from './native/push';

export async function clearAccountLocalData(userId: string): Promise<void> {
  const results = await Promise.allSettled([
    clearSavedPlaces(userId), clearFoodState(userId), deleteRegistrationDraft(userId),
    clearPermissionIntro(userId), writeLastOrderId(null), forgetPushNotifications(),
  ]);
  if (results.some(result => result.status === 'rejected')) throw new Error('Аккаунт удалён. Не удалось очистить все данные на этом устройстве. Очистите данные приложения в настройках телефона.');
}
