import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from './config';

export type OtpChannel = 'whatsapp' | 'sms' | 'development';
const MESSAGGIO_SEND_URL = 'https://msg.messaggio.com/api/v1/send';

class DeliveryError extends Error {}

// Messaggio API UPD 22.06.2026: authentication template with a Copy Code button.
export function whatsappOtpPayload(config: AppConfig, phone: string, code: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(code)) throw new DeliveryError('invalid-input');
  return {
    recipients: [{ phone: phone.slice(1) }],
    channels: ['whatsapp'],
    options: { ttl: 300, external_id: randomUUID() },
    whatsapp: {
      from: config.messaggioWhatsappSender,
      content: [{ type: 'template', template: {
        id: config.messaggioWhatsappTemplate,
        language: config.messaggioWhatsappLanguage,
        body: { parameters: [{ text: code }] },
        buttons: [{ type: 'url', url_parameter: code }],
      } }],
    },
  };
}

export function acceptedWhatsappMessage(value: unknown, phone: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const messages = Reflect.get(value, 'messages');
  if (!Array.isArray(messages) || messages.length !== 1) return false;
  const message = messages[0];
  return !!message && typeof message === 'object' && !message.error
    && typeof message.message_id === 'string' && message.message_id.trim().length > 0
    && message.recipient?.phone === phone.slice(1);
}

@Injectable()
export class OtpDelivery {
  private readonly logger = new Logger(OtpDelivery.name);
  constructor(private readonly config: AppConfig) {}

  async send(phone: string, code: string): Promise<OtpChannel> {
    if (this.config.smsProvider === 'development') {
      if (!this.config.devAuth) throw new ServiceUnavailableException('Отправка кодов входа не настроена.');
      return 'development';
    }
    try {
      if (this.config.smsProvider === 'messaggio') {
        const response = await fetch(MESSAGGIO_SEND_URL, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'Messaggio-Login': this.config.messaggioLogin, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(whatsappOtpPayload(this.config, phone, code)),
        });
        if (response.status !== 200) throw new DeliveryError(`http-${response.status}`);
        // A 200 response can still reject this recipient. Accepted is not delivered.
        if (!acceptedWhatsappMessage(await response.json(), phone)) throw new DeliveryError('recipient-not-accepted');
        return 'whatsapp';
      }
      if (this.config.smsProvider !== 'http') throw new DeliveryError('unknown-provider');
      const response = await fetch(this.config.require('SMS_GATEWAY_URL'), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${this.config.require('SMS_GATEWAY_TOKEN')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, message: `Код для входа в Atlas: ${code}. Никому не сообщайте код.` }),
      });
      if (!response.ok) throw new DeliveryError(`http-${response.status}`);
      return 'sms';
    } catch (error) {
      // Never log request/response bodies, credentials, phone numbers or OTPs.
      this.logger.warn(`OTP ${this.config.smsProvider}: ${error instanceof DeliveryError ? error.message : 'transport-error'}`);
      // No automatic retry: a timeout can follow an accepted, billable request.
      throw new ServiceUnavailableException(this.config.smsProvider === 'messaggio'
        ? 'Не удалось отправить код в WhatsApp. Попробуйте позже.'
        : 'Не удалось отправить код. Попробуйте позже.');
    }
  }
}
