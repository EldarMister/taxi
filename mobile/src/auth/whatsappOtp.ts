import { AppState, NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type WhatsAppOtpCode = { requestId: string; phone: string; code: string };
type OtpModule = {
  begin(phone: string): Promise<string | null>;
  take(requestId: string): Promise<WhatsAppOtpCode | null>;
  end(requestId: string): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
};
const native: OtpModule | undefined = Platform.OS === 'android' ? NativeModules.AtlasWhatsAppOtp : undefined;

export async function beginWhatsAppOtp(phone: string): Promise<string | null> {
  try { return await native?.begin(phone) ?? null; } catch { return null; }
}
export async function takeWhatsAppOtp(requestId: string): Promise<WhatsAppOtpCode | null> {
  try { return await native?.take(requestId) ?? null; } catch { return null; }
}
export async function endWhatsAppOtp(requestId: string): Promise<void> {
  try { await native?.end(requestId); } catch { /* Optional autofill must not block manual login. */ }
}
export function subscribeWhatsAppOtp(onAvailable: () => void): () => void {
  if (!native) return () => undefined;
  const code = new NativeEventEmitter(native).addListener('AtlasWhatsAppOtpAvailable', onAvailable);
  const resumed = AppState.addEventListener('change', state => { if (state === 'active') onAvailable(); });
  return () => { code.remove(); resumed.remove(); };
}
