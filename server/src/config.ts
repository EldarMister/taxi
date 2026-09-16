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
  readonly minimumDeposit = this.integer('MIN_DRIVER_DEPOSIT', 50, 0, 100000);
  readonly devAuth = this.development && process.env.DEV_AUTH_ENABLED === 'true';
  readonly devCode = process.env.DEV_OTP_CODE ?? '123456';
  readonly smsProvider = process.env.SMS_PROVIDER ?? 'development';
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
    for (const [key, value] of [['JWT_SECRET', this.jwtSecret], ['OTP_SECRET', this.otpSecret]]) {
      if (value.length < 32) throw new Error(`${key} must contain at least 32 characters`);
      if (!this.development && value.startsWith('replace-')) throw new Error(`${key}: replace example secret`);
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    if (this.jwtSecret === this.otpSecret) throw new Error('Use different JWT_SECRET and OTP_SECRET');
    if (!['development','http'].includes(this.smsProvider)) throw new Error('Unknown SMS_PROVIDER');
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
