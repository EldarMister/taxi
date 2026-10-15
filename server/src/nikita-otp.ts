import { ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// The provider token authorizes verification, so keep it encrypted on the server.
// Bind ciphertext to the phone and challenge; it cannot be moved to a new request.
export function sealNikitaToken(token: string, secret: string, identity: string): string {
  const key = createHmac('sha256', secret).update('atlas-nikita-otp-token-v1').digest();
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(identity));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
}

export function unsealNikitaToken(value: string, secret: string, identity: string): string {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 29) throw new Error('Invalid verification token');
  const key = createHmac('sha256', secret).update('atlas-nikita-otp-token-v1').digest();
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(identity));
  decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8');
}

export type NikitaVerification = 'valid' | 'invalid' | 'expired';
export class NikitaDeliveryError extends Error {}

// Provider descriptions may contain sensitive data. Expose only numeric statuses.
export async function nikitaRequest(apiKey: string, method: 'send' | 'verify', body: object): Promise<Record<string, unknown>> {
  const response = await fetch(`https://smspro.nikita.kg/api/otp/${method}`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new NikitaDeliveryError(`http-${response.status}`);
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new NikitaDeliveryError('invalid-response');
  return result as Record<string, unknown>;
}

export function nikitaStatus(result: Record<string, unknown>): number {
  const status = result.status;
  if (typeof status === 'number' && Number.isInteger(status) && status >= 0 && status <= 999) return status;
  if (typeof status === 'string' && /^\d{1,3}$/.test(status)) return Number(status);
  throw new NikitaDeliveryError('invalid-status');
}

export function nikitaUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException('Не удалось связаться с сервисом SMS. Попробуйте позже.');
}
