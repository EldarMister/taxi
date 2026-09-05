export async function registerPushNotifications(): Promise<null> { return null; }
export async function unregisterPushNotifications(): Promise<void> {}
export function onNotificationOpened(_handler: (orderId: string | undefined) => void): () => void { return () => {}; }
