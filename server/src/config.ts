import 'dotenv/config';
import {trustedProxyPeers} from './request-client-ip';
import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';

@Injectable()
export class AppConfig {
  readonly environment = process.env.NODE_ENV ?? 'development';
  readonly development = this.environment === 'development';
  readonly jwtSecret = process.env.JWT_SECRET ?? '';
  readonly otpSecret = process.env.OTP_SECRET ?? '';
  readonly port = this.integer('PORT', 3000, 1, 65535);
  readonly accessSeconds = this.integer('ACCESS_TOKEN_SECONDS', 900, 60, 3600);
  readonly refreshDays = this.integer('REFRESH_TOKEN_DAYS', 30, 1, 90);
  readonly minimumDeposit = this.integer('MIN_DRIVER_DEPOSIT', 50, 0, 100000);
  readonly smsProvider = process.env.SMS_PROVIDER ?? 'development';
  readonly devAuth = this.development && this.smsProvider === 'development' && process.env.DEV_AUTH_ENABLED === 'true';
  readonly devCode = process.env.DEV_OTP_CODE ?? '123456';
  readonly messaggioLogin = process.env.MESSAGGIO_LOGIN?.trim() || '';
  readonly messaggioWhatsappSender = process.env.MESSAGGIO_WHATSAPP_SENDER?.trim() || '';
  readonly messaggioWhatsappTemplate = process.env.MESSAGGIO_WHATSAPP_TEMPLATE?.trim() || '';
  readonly messaggioWhatsappLanguage = process.env.MESSAGGIO_WHATSAPP_LANGUAGE?.trim() || 'ru';
  readonly telegramGatewayToken = process.env.TELEGRAM_GATEWAY_TOKEN?.trim() || '';
  readonly nikitaApiKey = process.env.NIKITA_API_KEY?.trim() || '';
  readonly testAuthPhones = (process.env.TEST_AUTH_PHONES ?? '').split(',').map(phone => phone.trim()).filter(Boolean);
  readonly testAuthCode = process.env.TEST_AUTH_CODE ?? this.devCode;
  readonly whatsappCloudToken = process.env.WHATSAPP_CLOUD_TOKEN?.trim() || '';
  readonly whatsappCloudPhoneId = process.env.WHATSAPP_CLOUD_PHONE_ID?.trim() || '';
  readonly whatsappCloudWabaId = process.env.WHATSAPP_CLOUD_WABA_ID?.trim() || '';
  readonly whatsappCloudTemplate = process.env.WHATSAPP_CLOUD_TEMPLATE?.trim() || '';
  readonly whatsappCloudLanguage = process.env.WHATSAPP_CLOUD_LANGUAGE?.trim() || 'ru';
  readonly whatsappCloudVersion = process.env.WHATSAPP_CLOUD_VERSION?.trim() || 'v25.0';
  readonly whatsappCloudAppSecret = process.env.WHATSAPP_CLOUD_APP_SECRET?.trim() || '';
  readonly whatsappCloudVerifyToken = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN?.trim() || '';
  readonly routingProvider = process.env.ROUTING_PROVIDER ?? 'osrm';
  readonly osrmBaseUrl = this.endpoint('OSRM_BASE_URL', 'https://router.project-osrm.org');
  readonly nominatimBaseUrl = process.env.NOMINATIM_BASE_URL?.trim() ? this.endpoint('NOMINATIM_BASE_URL', '') : '';
  readonly photonBaseUrl = process.env.PHOTON_BASE_URL?.trim() ? this.endpoint('PHOTON_BASE_URL', '') : '';
  readonly nominatimUserAgent = process.env.NOMINATIM_USER_AGENT?.trim() || 'TaxiGO/1.0 (development)';
  readonly nominatimIntervalMs = this.integer('NOMINATIM_MIN_INTERVAL_MS', 1000, 1000, 60000);
  readonly pushProvider = process.env.PUSH_PROVIDER ?? 'development';
  readonly expoAccessToken = process.env.EXPO_ACCESS_TOKEN?.trim() || undefined;
  readonly origins = (process.env.CORS_ORIGINS ?? 'http://localhost:8081').split(',').map(v => v.trim()).filter(Boolean);
  constructor() {
    trustedProxyPeers(process.env.TRUSTED_PROXY_CIDRS??'');
    for (const [key, value] of [['JWT_SECRET', this.jwtSecret], ['OTP_SECRET', this.otpSecret]]) {
      if (value.length < 32) throw new Error(`${key} must contain at least 32 characters`);
      if (!this.development && value.startsWith('replace-')) throw new Error(`${key}: replace example secret`);
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    if (this.jwtSecret === this.otpSecret) throw new Error('Use different JWT_SECRET and OTP_SECRET');
    if (!['development','http','messaggio','whatsapp_cloud','nikita'].includes(this.smsProvider)) throw new Error('Unknown SMS_PROVIDER');
    if (this.routingProvider !== 'osrm') throw new Error('ROUTING_PROVIDER must be osrm');
    if (!['development','firebase','expo'].includes(this.pushProvider)) throw new Error('Unknown PUSH_PROVIDER');
    if (!this.development && [this.smsProvider, this.pushProvider].includes('development')) {
      throw new Error('Development providers are forbidden outside NODE_ENV=development');
    }
    if (process.env.DEV_AUTH_ENABLED === 'true' && !this.development) throw new Error('DEV_AUTH_ENABLED is forbidden outside development');
    if (this.devAuth && !/^\d{6}$/.test(this.devCode)) throw new Error('DEV_OTP_CODE must have six digits');
    if (this.smsProvider === 'http') {
      this.require('SMS_GATEWAY_TOKEN');
      if (!this.require('SMS_GATEWAY_URL').startsWith('https://')) throw new Error('SMS_GATEWAY_URL must use HTTPS');
    }
    if (this.smsProvider === 'nikita' && !/^[a-f0-9]{32}$/i.test(this.nikitaApiKey)) throw new Error('Invalid or missing NIKITA_API_KEY');
    if (this.testAuthPhones.some(phone => !/^\+996\d{9}$/.test(phone))) throw new Error('Invalid TEST_AUTH_PHONES');
    if (this.testAuthPhones.length && !/^\d{6}$/.test(this.testAuthCode)) throw new Error('TEST_AUTH_CODE must have six digits');
    if (this.smsProvider === 'messaggio') {
      for (const [key, value] of [
        ['MESSAGGIO_LOGIN', this.messaggioLogin],
        ['MESSAGGIO_WHATSAPP_SENDER', this.messaggioWhatsappSender],
        ['MESSAGGIO_WHATSAPP_TEMPLATE', this.messaggioWhatsappTemplate],
      ]) {
        if (!value || value.length > 512 || /[\r\n]/.test(value)) throw new Error(`Invalid or missing ${key}`);
      }
      if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(this.messaggioWhatsappLanguage)) throw new Error('Invalid MESSAGGIO_WHATSAPP_LANGUAGE');
    }
    if (this.telegramGatewayToken && (this.telegramGatewayToken.length > 512 || /[\r\n]/.test(this.telegramGatewayToken))) throw new Error('Invalid TELEGRAM_GATEWAY_TOKEN');
    if (this.smsProvider === 'whatsapp_cloud') {
      for (const [key,value] of [
        ['WHATSAPP_CLOUD_TOKEN',this.whatsappCloudToken],
        ['WHATSAPP_CLOUD_APP_SECRET',this.whatsappCloudAppSecret],
        ['WHATSAPP_CLOUD_VERIFY_TOKEN',this.whatsappCloudVerifyToken],
      ]) if (!value || value.length > 4096 || /[\r\n]/.test(value)) throw new Error(`Invalid or missing ${key}`);
      if (!/^\d{6,30}$/.test(this.whatsappCloudPhoneId)) throw new Error('Invalid WHATSAPP_CLOUD_PHONE_ID');
      if (!/^\d{6,30}$/.test(this.whatsappCloudWabaId)) throw new Error('Invalid WHATSAPP_CLOUD_WABA_ID');
      if (!/^[a-z0-9_]{1,512}$/.test(this.whatsappCloudTemplate)) throw new Error('Invalid WHATSAPP_CLOUD_TEMPLATE');
      if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(this.whatsappCloudLanguage)) throw new Error('Invalid WHATSAPP_CLOUD_LANGUAGE');
      if (!/^v\d{2}\.0$/.test(this.whatsappCloudVersion)) throw new Error('Invalid WHATSAPP_CLOUD_VERSION');
    }
    if (!this.development) {
      if (!process.env.OSRM_BASE_URL || new URL(this.osrmBaseUrl).hostname === 'router.project-osrm.org') throw new Error('Configure a dedicated OSRM_BASE_URL outside development');
      if (!this.nominatimBaseUrl) throw new Error('Configure a dedicated NOMINATIM_BASE_URL outside development');
      this.require('NOMINATIM_USER_AGENT');
    }
    if (this.nominatimBaseUrl && new URL(this.nominatimBaseUrl).hostname === 'nominatim.openstreetmap.org') throw new Error('Use a dedicated Nominatim service for the taxi application; the OSMF public endpoint is not supported');
    if (this.nominatimUserAgent.length < 5 || this.nominatimUserAgent.length > 250 || /[\r\n]/.test(this.nominatimUserAgent)) throw new Error('Invalid NOMINATIM_USER_AGENT');
    if (this.pushProvider === 'firebase' && !existsSync(this.require('GOOGLE_APPLICATION_CREDENTIALS'))) {
      throw new Error('Firebase service-account file not found');
    }
    if (!this.development && (!this.origins.length || this.origins.includes('*'))) throw new Error('Set explicit CORS_ORIGINS');
  }
  require(key: string) { const value = process.env[key]; if (!value) throw new Error(`${key} is required`); return value; }
  private endpoint(key: string, fallback: string) {
    let url: URL;
    try { url = new URL(process.env[key]?.trim() || fallback); } catch { throw new Error(`Invalid ${key}`); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(`Invalid ${key}: use an HTTP(S) base URL without credentials, query or fragment`);
    return url.toString().replace(/\/+$/, '');
  }
  private integer(key: string, fallback: number, min: number, max: number) {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  }
}
