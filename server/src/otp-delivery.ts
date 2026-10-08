import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppConfig } from './config';

export type OtpChannel = 'whatsapp' | 'telegram' | 'sms' | 'development';
const MESSAGGIO_SEND_URL = 'https://msg.messaggio.com/api/v1/send';

class DeliveryError extends Error {}

// Messaggio API UPD 22.06.2026: authentication template with a Copy Code button.
export function whatsappOtpPayload(config: AppConfig, phone: string, code: string) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(code)) throw new DeliveryError('invalid-input');
  return {
    recipients: [{ phone: phone.slice(1) }],
    channels: ['whatsapp'],
    options: { ttl: config.telegramGatewayToken ? 60 : 300, external_id: randomUUID() },
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

  async sendWhatsapp(phone: string, code: string): Promise<string> {
    const response = await fetch(MESSAGGIO_SEND_URL, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(6000),
      headers: { 'Messaggio-Login': this.config.messaggioLogin, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(whatsappOtpPayload(this.config, phone, code)),
    });
    if (response.status !== 200) throw new DeliveryError(`http-${response.status}`);
    const result = await response.json();
    if (!acceptedWhatsappMessage(result, phone)) throw new DeliveryError('recipient-not-accepted');
    return result.messages[0].message_id;
  }

  async whatsappStatus(messageId: string, phone: string): Promise<'delivered' | 'failed' | 'pending'> {
    const response = await fetch('https://msg.messaggio.com/api/v1/statuses', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Messaggio-Login': this.config.messaggioLogin, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({recipients:[{id:messageId}],channels:['whatsapp'],whatsapp:[{from:this.config.messaggioWhatsappSender}]}),
    });
    if (response.status !== 200) throw new DeliveryError(`http-${response.status}`);
    const result = await response.json();
    const report = Array.isArray(result?.statuses) ? result.statuses.find((item: any) => item.message_id === messageId && item.type === 'status'
      && item.status?.channel === 'whatsapp' && item.status?.recipient?.phone === phone.slice(1)) : null;
    const status = report?.status?.status;
    if ([70,69,67].includes(status)) return 'delivered';
    if ([196,98,97,96,95,94,92,91,90,89,87,85,68,65,60].includes(status)) return 'failed';
    return 'pending';
  }

  async sendTelegram(phone: string, code: string, ttl: number): Promise<string> {
    if (!this.config.telegramGatewayToken || !/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(code) || ttl < 30) throw new DeliveryError('invalid-telegram-input');
    const response = await fetch('https://gatewayapi.telegram.org/sendVerificationMessage', {
      method:'POST', redirect:'error', signal:AbortSignal.timeout(6000),
      headers:{Authorization:`Bearer ${this.config.telegramGatewayToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({phone_number:phone,code,ttl:Math.min(ttl,300)}),
    });
    if (!response.ok) throw new DeliveryError(`telegram-http-${response.status}`);
    const value = await response.json();
    if (value?.ok !== true || value.result?.phone_number !== phone || typeof value.result?.request_id !== 'string' || !value.result.request_id.trim()
      || ['expired','revoked'].includes(value.result?.delivery_status?.status)) throw new DeliveryError('telegram-not-accepted');
    return value.result.request_id;
  }

  async send(phone: string, code: string): Promise<OtpChannel> {
    if (this.config.smsProvider === 'development') {
      if (!this.config.devAuth) throw new ServiceUnavailableException('Отправка кодов входа не настроена.');
      return 'development';
    }
    try {
      if (this.config.smsProvider === 'messaggio') {
        await this.sendWhatsapp(phone,code);
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
