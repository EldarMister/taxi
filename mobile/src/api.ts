import { readTokens, writeTokens, clearTokens } from './native/sessionStore';
import type { Tokens } from './types';

const { resolveApiUrl } = require('../config/api.cjs') as { resolveApiUrl: (value?: string) => string };

export class ApiError extends Error {
  readonly code?: string;
  readonly requestId?: string;
  readonly fieldErrors: Array<{ field: string; code?: string; message: string }>;
  constructor(public status: number, message: string, details?: { code?: unknown; requestId?: unknown; fieldErrors?: unknown }) {
    super(message); this.name = 'ApiError';
    this.code = typeof details?.code === 'string' ? details.code : undefined;
    this.requestId = typeof details?.requestId === 'string' ? details.requestId : undefined;
    this.fieldErrors = Array.isArray(details?.fieldErrors) ? details.fieldErrors.flatMap(item => {
      if (!item || typeof item !== 'object') return [];
      const value = item as Record<string, unknown>;
      return typeof value.field === 'string' && typeof value.message === 'string'
        ? [{ field: value.field, message: value.message, ...(typeof value.code === 'string' ? { code: value.code } : {}) }]
        : [];
    }) : [];
  }
}
type Listener = (event: 'tokens' | 'logout' | 'online' | 'offline') => void;
let tokens: Tokens | null = null;
let refreshPromise: Promise<Tokens> | null = null;
let sessionGeneration = 0;
let authEpoch = 0;
const listeners = new Set<Listener>();
const emit = (event: Parameters<Listener>[0]) => listeners.forEach(listener => listener(event));
// Expo replaces this public variable when bundling. A clean checkout also works
// on a physical phone, without depending on a local development server.
const baseUrl = resolveApiUrl(process.env.EXPO_PUBLIC_API_URL);

async function raw<T>(path: string, init: RequestInit, accessToken?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  const cancel = () => controller.abort();
  if (init.signal?.aborted) cancel();
  else init.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const formData = typeof FormData !== 'undefined' && init.body instanceof FormData;
    const request = (url: string, bypassCache = false) => fetch(url, {
      ...init, cache: 'no-store', signal: controller.signal,
      headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache', ...(!formData && init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...init.headers,
        ...(bypassCache ? { 'Cache-Control': 'no-cache, no-store, max-age=0', 'If-Modified-Since': 'Thu, 01 Jan 1970 00:00:00 GMT' } : {}) },
    });
    let response = await request(`${baseUrl}${path}`);
    // Android may keep an ETag for authenticated JSON even when the screen needs
    // a fresh body. A 304 has no JSON to restore, so retry through HTTP headers.
    // Do not add a cache-buster query key: strict API DTOs correctly reject it.
    if (response.status === 304) {
      response = await request(`${baseUrl}${path}`, true);
    }
    const text = await response.text();
    emit('online');
    let body: any;
    try { body = text ? JSON.parse(text) : undefined; }
    catch {
      if (response.ok) throw new ApiError(502, 'Сервер вернул некорректный ответ. Попробуйте ещё раз.');
    }
    if (!response.ok) {
      const message = Array.isArray(body?.message) ? body.message.join('\n') : body?.message;
      const routeMissing = response.status === 404 && (typeof message !== 'string' || /^Cannot (GET|POST|PATCH|PUT|DELETE)\s/i.test(message));
      const safeMessage = routeMissing
        ? 'Этот раздел временно недоступен. Попробуйте обновить его немного позже.'
        : typeof message === 'string' && !/<(?:html|body|!doctype)/i.test(message) ? message : undefined;
      throw new ApiError(response.status, safeMessage || 'Сервис временно недоступен. Попробуйте ещё раз немного позже.', body);
    }
    return body as T;
  } catch (error) {
    if (init.signal?.aborted) { const cancelled = new Error('Запрос отменён.'); cancelled.name = 'AbortError'; throw cancelled; }
    if (error instanceof ApiError) throw error;
    emit('offline');
    throw new ApiError(0, controller.signal.aborted
      ? 'Сервер долго не отвечает. Повторите попытку через несколько секунд.'
      : 'Не удалось подключиться к серверу. Проверьте интернет и повторите попытку.');
  } finally { clearTimeout(timeout); init.signal?.removeEventListener('abort', cancel); }
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
  upload<T>(path: string, body: FormData) { return api.request<T>(path, { method: 'POST', body }); },
  patch<T>(path: string, body: unknown) { return api.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); },
};

export const messageOf = (error: unknown) => error instanceof ApiError && error.requestId
  ? `${error.message}\nКод обращения: ${error.requestId}`
  : error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';
export const requestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
