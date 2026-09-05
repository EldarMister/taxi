import 'dotenv/config';
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
  readonly searchSeconds = this.integer('SEARCH_TIMEOUT_SECONDS', 120, 10, 1800);
  readonly minimumDeposit = this.integer('MIN_DRIVER_DEPOSIT', 50, 0, 100000);
  readonly devAuth = this.development && process.env.DEV_AUTH_ENABLED === 'true';
  readonly devCode = process.env.DEV_OTP_CODE ?? '123456';
  readonly smsProvider = process.env.SMS_PROVIDER ?? 'development';
  readonly routingProvider = process.env.ROUTING_PROVIDER ?? 'approximation';
  readonly pushProvider = process.env.PUSH_PROVIDER ?? 'development';
  readonly origins = (process.env.CORS_ORIGINS ?? 'http://localhost:8081').split(',').map(v => v.trim()).filter(Boolean);
  constructor() {
    for (const [key, value] of [['JWT_SECRET', this.jwtSecret], ['OTP_SECRET', this.otpSecret]]) {
      if (value.length < 32) throw new Error(`${key} must contain at least 32 characters`);
      if (!this.development && value.startsWith('replace-')) throw new Error(`${key}: replace example secret`);
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    if (this.jwtSecret === this.otpSecret) throw new Error('Use different JWT_SECRET and OTP_SECRET');
    if (!['development','http'].includes(this.smsProvider)) throw new Error('Unknown SMS_PROVIDER');
    if (!['approximation','yandex'].includes(this.routingProvider)) throw new Error('Unknown ROUTING_PROVIDER');
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
    if (this.routingProvider === 'yandex') this.require('YANDEX_ROUTER_API_KEY');
    if (this.pushProvider === 'firebase' && !existsSync(this.require('GOOGLE_APPLICATION_CREDENTIALS'))) {
      throw new Error('Firebase service-account file not found');
    }
    if (this.pushProvider === 'expo') this.require('EXPO_ACCESS_TOKEN');
    if (!this.development && (!this.origins.length || this.origins.includes('*'))) throw new Error('Set explicit CORS_ORIGINS');
  }
  require(key: string) { const value = process.env[key]; if (!value) throw new Error(`${key} is required`); return value; }
  private integer(key: string, fallback: number, min: number, max: number) {
    const value = Number(process.env[key] ?? fallback);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Invalid ${key}`);
    return value;
  }
}
