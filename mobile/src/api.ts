import { readTokens, writeTokens, clearTokens } from './native/sessionStore';
import type { Tokens } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ApiError'; }
}
type Listener = (event: 'tokens' | 'logout' | 'online' | 'offline') => void;
let tokens: Tokens | null = null;
let refreshPromise: Promise<Tokens> | null = null;
let sessionGeneration = 0;
let authEpoch = 0;
const listeners = new Set<Listener>();
const emit = (event: Parameters<Listener>[0]) => listeners.forEach(listener => listener(event));
const baseUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api').replace(/\/$/, '');

async function raw<T>(path: string, init: RequestInit, accessToken?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init, signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init.headers },
    });
    emit('online');
    const text = await response.text();
    let body: any;
    try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    if (!response.ok) {
      const message = Array.isArray(body?.message) ? body.message.join('\n') : body?.message;
      throw new ApiError(response.status, message || `Ошибка сервера (${response.status})`);
    }
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    emit('offline');
    throw new ApiError(0, 'Нет связи с сервером. Проверьте интернет и повторите попытку.');
  } finally { clearTimeout(timeout); }
}

export const api = {
  baseUrl,
  socketUrl: baseUrl.replace(/\/api$/, ''),
  subscribe(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getTokens() { return tokens; },
  async restore() { const generation = sessionGeneration; const stored = await readTokens(); if (generation === sessionGeneration && !tokens) tokens = stored; return tokens; },
  async setTokens(next: Tokens, rotated = false) { const generation = ++sessionGeneration; if (!rotated) authEpoch++; tokens = next; await writeTokens(next); if (generation === sessionGeneration) emit('tokens'); },
  async clear() { sessionGeneration++; authEpoch++; tokens = null; refreshPromise = null; await clearTokens(); emit('logout'); },
  async refresh(): Promise<Tokens> {
    if (refreshPromise) return refreshPromise;
    if (!tokens?.refreshToken) throw new ApiError(401, 'Войдите в аккаунт заново.');
    const pending = (async () => {
      const generation = sessionGeneration;
      try {
        if (!tokens?.refreshToken) throw new ApiError(401, 'Войдите в аккаунт заново.');
        const next = await raw<Tokens>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: tokens.refreshToken }) });
        if (generation !== sessionGeneration) throw new ApiError(401, 'Сессия завершена.');
        await api.setTokens(next, true);
        return next;
      } catch (error) {
        if (generation === sessionGeneration && error instanceof ApiError && (error.status === 401 || error.status === 403)) await api.clear();
        throw error;
      }
    })();
    refreshPromise = pending;
    void pending.finally(() => { if (refreshPromise === pending) refreshPromise = null; }).catch(() => undefined);
    return refreshPromise;
  },
  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const accessToken = tokens?.accessToken;
    const epoch = authEpoch;
    try { const result = await raw<T>(path, init, accessToken); if (accessToken && epoch !== authEpoch) throw new ApiError(401, 'Сессия завершена.'); return result; }
    catch (error) {
      if (epoch !== authEpoch) throw new ApiError(401, 'Сессия завершена.');
      if (error instanceof ApiError && error.status === 401 && tokens && !['/auth/request-code', '/auth/verify-code', '/auth/refresh'].includes(path)) {
        const next = tokens.accessToken !== accessToken ? tokens : await api.refresh();
        if (epoch !== authEpoch) throw new ApiError(401, 'Сессия завершена.');
        const result = await raw<T>(path, init, next.accessToken);
        if (epoch !== authEpoch) throw new ApiError(401, 'Сессия завершена.');
        return result;
      }
      throw error;
    }
  },
  post<T>(path: string, body: unknown = {}) { return api.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); },
  patch<T>(path: string, body: unknown) { return api.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); },
};

export const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
export const requestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
