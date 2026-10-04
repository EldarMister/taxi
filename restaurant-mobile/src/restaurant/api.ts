import * as SecureStore from 'expo-secure-store';
import type { Profile, Session } from './types';

const { resolveApiUrl } = require('../../config/api.cjs') as { resolveApiUrl: (value?: string) => string };
const baseUrl = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL);
const tokenKey = 'atlas.restaurant.session.v1';
type Tokens = Pick<Session, 'accessToken' | 'refreshToken'>;
let tokens: Tokens | null = null;
let generation = 0;
let refreshPromise: Promise<void> | null = null;
let storageQueue: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();

export class RestaurantApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'RestaurantApiError'; }
}
async function raw<T>(path: string, method: string, body?: unknown, accessToken?: string): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 20000);
  try {
    const multipart = typeof FormData !== 'undefined' && body instanceof FormData;
    const response = await fetch(`${baseUrl}/restaurant${path}`, {
      method, signal: abort.signal, cache: 'no-store',
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store', ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body !== undefined ? { body: multipart ? body as FormData : JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    let result: any;
    try { result = text ? JSON.parse(text) : undefined; } catch { /* A gateway may return HTML. */ }
    if (!response.ok) {
      const message = Array.isArray(result?.message) ? result.message.join('\n') : result?.message;
      throw new RestaurantApiError(response.status, typeof message === 'string' && !/^Cannot |<html/i.test(message) ? message : 'Не удалось выполнить запрос. Попробуйте ещё раз.');
    }
    return result as T;
  } catch (error) {
    if (error instanceof RestaurantApiError) throw error;
    throw new RestaurantApiError(0, abort.signal.aborted ? 'Сервер долго не отвечает. Попробуйте ещё раз.' : 'Нет соединения с сервером. Проверьте интернет.');
  } finally { clearTimeout(timer); }
}
async function store(next: Tokens, epoch = generation) {
  const value = { accessToken: next.accessToken, refreshToken: next.refreshToken };
  const operation = storageQueue.catch(() => {}).then(async () => {
    if (epoch !== generation) return;
    await SecureStore.setItemAsync(tokenKey, JSON.stringify(value));
    if (epoch === generation) tokens = value;
  });
  storageQueue = operation;
  await operation;
}
async function clear() {
  const epoch = ++generation;
  tokens = null; refreshPromise = null;
  const operation = storageQueue.catch(() => {}).then(() => SecureStore.deleteItemAsync(tokenKey));
  storageQueue = operation;
  await operation;
  if (epoch === generation) listeners.forEach(listener => listener());
}
async function refresh() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = tokens?.refreshToken;
  const epoch = generation;
  if (!refreshToken) throw new RestaurantApiError(401, 'Войдите в аккаунт заново.');
  const pending = (async () => {
    try {
      const next = await raw<Tokens>('/auth/refresh', 'POST', { refreshToken });
      if (epoch !== generation) throw new RestaurantApiError(401, 'Сессия завершена.');
      await store(next, epoch);
      if (epoch !== generation) throw new RestaurantApiError(401, 'Сессия завершена.');
    } catch (error) {
      if (epoch === generation && error instanceof RestaurantApiError && [401, 403].includes(error.status)) await clear();
      throw error;
    }
  })();
  refreshPromise = pending;
  try { await pending; } finally { if (refreshPromise === pending) refreshPromise = null; }
}
export const restaurantApi = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  async restore(): Promise<Profile | null> {
    const epoch = generation;
    await storageQueue.catch(() => {});
    const saved = await SecureStore.getItemAsync(tokenKey);
    if (epoch !== generation) return null;
    if (!saved) return null;
    try { tokens = JSON.parse(saved); } catch { await clear(); return null; }
    if (!tokens?.accessToken || !tokens?.refreshToken) { await clear(); return null; }
    return restaurantApi.request<Profile>('/me');
  },
  async login(phone: string, password: string) {
    const session = await raw<Session>('/auth/login', 'POST', { phone, password });
    const epoch = ++generation;
    await store({ accessToken: session.accessToken, refreshToken: session.refreshToken }, epoch);
    if (epoch !== generation) throw new RestaurantApiError(401, 'Сессия завершена.');
    return session;
  },
  async logout() {
    const previous = tokens;
    await clear();
    if (previous) await raw('/auth/logout', 'POST', { refreshToken: previous.refreshToken }, previous.accessToken);
  },
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!tokens) throw new RestaurantApiError(401, 'Войдите в аккаунт заново.');
    const epoch = generation;
    try {
      const result = await raw<T>(path, method, body, tokens.accessToken);
      if (epoch !== generation) throw new RestaurantApiError(401, 'Сессия завершена.');
      return result;
    }
    catch (error) {
      if (!(error instanceof RestaurantApiError) || error.status !== 401) throw error;
      if (epoch !== generation) throw new RestaurantApiError(401, 'Сессия завершена.');
      await refresh();
      if (epoch !== generation || !tokens) throw new RestaurantApiError(401, 'Сессия завершена.');
      const result = await raw<T>(path, method, body, tokens.accessToken);
      if (epoch !== generation) throw new RestaurantApiError(401, 'Сессия завершена.');
      return result;
    }
  },
};
