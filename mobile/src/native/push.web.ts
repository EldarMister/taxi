export interface NotificationPermissionState { granted: boolean; canAskAgain: boolean; supported?: boolean }
export async function registerPushNotifications(): Promise<null> { return null; }
export async function unregisterPushNotifications(): Promise<void> {}
export async function getNotificationPermissionState(): Promise<NotificationPermissionState> { return { granted: false, canAskAgain: false, supported: false }; }
export async function requestNotificationAccess(): Promise<NotificationPermissionState> { return { granted: false, canAskAgain: false, supported: false }; }
export async function openNotificationSettings(): Promise<void> {}
export function onNotificationOpened(_handler: (orderId: string | undefined) => void): () => void { return () => {}; }
export function onNotificationReceived(_handler: (data: Record<string, unknown>) => void): () => void { return () => {}; }
