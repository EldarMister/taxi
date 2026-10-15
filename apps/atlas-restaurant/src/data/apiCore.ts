import type { Catalog, DeliveryQuote, DispatchInput, MerchantOrder, OrderAction, Profile, RestaurantDetail, Session, Staff, StaffInput, Stats, StatsPeriod } from '../domain/types';

export class ApiError extends Error {
  constructor(message: string, public readonly status = 0, public readonly code = 'API_ERROR') { super(message); this.name = 'ApiError'; }
}
export class StaleSessionError extends ApiError {
  constructor() { super('Сессия завершена. Повторите вход.', 401, 'STALE_SESSION'); }
}
type Tokens = Pick<Session, 'accessToken' | 'refreshToken'>;
export interface TokenStorage { read(): Promise<string | null>; write(value: string): Promise<void>; clear(): Promise<void> }
export interface HttpResponse { ok: boolean; status: number; text(): Promise<string> }
export type Transport = (url: string, init: RequestInit) => Promise<HttpResponse>;
export type ApiDependencies = { baseUrl: string; storage: TokenStorage; transport: Transport; timeoutMs?: number };

/** Serialises a resource's mutations; a double tap shares the original operation. */
export class MutationGate {
  private readonly pending = new Map<string, { fingerprint: unknown; promise: Promise<unknown> }>();
  run<T>(key: string, fingerprint: unknown, work: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing.fingerprint === fingerprint
      ? existing.promise as Promise<T>
      : Promise.reject(new ApiError('Предыдущее действие ещё выполняется. Дождитесь обновления.', 409, 'MUTATION_PENDING'));
    const promise = Promise.resolve().then(work);
    this.pending.set(key, { fingerprint, promise });
    const clear = () => { if (this.pending.get(key)?.promise === promise) this.pending.delete(key); };
    void promise.then(clear, clear);
    return promise;
  }
}

export function createRestaurantApi({ baseUrl, storage, transport, timeoutMs = 20_000 }: ApiDependencies) {
  let session: Session | null = null;
  let generation = 0;
  let refreshTask: { generation: number; promise: Promise<Session> } | null = null;
  let restoreTask: Promise<Session | null> | null = null;
  let storageQueue: Promise<void> = Promise.resolve();
  const listeners = new Set<(value: Session | null) => void>();
  const mutations = new MutationGate();
  const emit = () => { for (const listener of listeners) listener(session); };
  const check = (expected: number) => { if (expected !== generation) throw new StaleSessionError(); };
  const queueStorage = (work: () => Promise<void>) => {
    const task = storageQueue.catch(() => undefined).then(work);
    storageQueue = task.catch(() => undefined);
    return task;
  };
  async function http<T>(path: string, method: string, body?: unknown, accessToken?: string): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    try {
      const response = await transport(`${baseUrl}/restaurant${path}`, {
        method, signal: abort.signal,
        headers: { Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}) },
        ...(body === undefined ? {} : { body: isForm ? body as FormData : JSON.stringify(body) }),
      });
      const raw = await response.text();
      let payload: unknown;
      try { payload = raw ? JSON.parse(raw) : undefined; }
      catch { throw new ApiError('Сервер вернул непонятный ответ. Повторите обновление.', response.status, 'INVALID_RESPONSE'); }
      if (!response.ok) {
        const message = (payload as { message?: unknown } | undefined)?.message;
        throw new ApiError(Array.isArray(message) ? message.join('\n') : typeof message === 'string' ? message : `Ошибка сервера (${response.status}). Повторите обновление.`, response.status);
      }
      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(abort.signal.aborted
        ? 'Сервер долго не отвечает. Обновите данные перед повтором действия.'
        : 'Нет связи с сервером. Проверьте интернет и обновите данные.', 0, abort.signal.aborted ? 'TIMEOUT' : 'NETWORK');
    } finally { clearTimeout(timer); }
  }
  function validateSession(value: Session): Session {
    if (!value || typeof value.accessToken !== 'string' || !value.accessToken || typeof value.refreshToken !== 'string' || !value.refreshToken || !value.user?.id || !Array.isArray(value.memberships)) {
      throw new ApiError('Не удалось прочитать сессию сервера. Повторите вход.', 0, 'INVALID_SESSION');
    }
    return value;
  }
  async function commit(value: Session, expected: number): Promise<Session> {
    check(expected);
    validateSession(value);
    await queueStorage(async () => { check(expected); await storage.write(JSON.stringify({ accessToken: value.accessToken, refreshToken: value.refreshToken })); });
    check(expected);
    session = value;
    emit();
    return value;
  }
  async function clearSession(expected: number): Promise<void> {
    check(expected);
    const clearedGeneration = ++generation;
    session = null;
    emit();
    await queueStorage(async () => { if (generation === clearedGeneration || !session) await storage.clear(); });
  }
  function refresh(tokens: Tokens, expected: number): Promise<Session> {
    check(expected);
    if (refreshTask?.generation === expected) return refreshTask.promise;
    const promise = (async () => {
      try { return await commit(await http<Session>('/auth/refresh', 'POST', { refreshToken: tokens.refreshToken }), expected); }
      catch (error) {
        check(expected);
        if (error instanceof ApiError && error.status === 401) await clearSession(expected);
        throw error;
      }
    })();
    refreshTask = { generation: expected, promise };
    const clear = () => { if (refreshTask?.promise === promise) refreshTask = null; };
    void promise.then(clear, clear);
    return promise;
  }
  function assertPath(path: string): string | null {
    if (!path.startsWith('/') || path.startsWith('//') || /[\\#]/.test(path)) throw new ApiError('Недопустимый путь запроса.', 400);
    const pathname = path.split('?')[0];
    let segments: string[];
    try { segments = pathname.slice(1).split('/').map(decodeURIComponent); }
    catch { throw new ApiError('Недопустимый путь запроса.', 400); }
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[\\/]/.test(segment))) throw new ApiError('Недопустимый путь запроса.', 400);
    if (pathname === '/me') return null;
    const restaurantId = segments[0];
    if (!session?.memberships.some(member => member.restaurantId === restaurantId)) throw new ApiError('Нет доступа к этому ресторану.', 403);
    return restaurantId;
  }
  async function execute<T>(path: string, method: string, body: unknown, expected: number): Promise<T> {
    check(expected);
    if (!session) throw new ApiError('Войдите в приложение ресторана.', 401);
    assertPath(path);
    const original = session;
    let result: T;
    try { result = await http<T>(path, method, body, original.accessToken); }
    catch (error) {
      check(expected);
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      if (!session) throw new StaleSessionError();
      if (session.accessToken === original.accessToken) await refresh(original, expected);
      check(expected);
      assertPath(path);
      try { result = await http<T>(path, method, body, session!.accessToken); }
      catch (retryError) {
        check(expected);
        if (retryError instanceof ApiError && retryError.status === 401) await clearSession(expected);
        throw retryError;
      }
    }
    check(expected);
    // A batched customer checkout still consists of independently owned FoodOrders.
    const restaurantId = assertPath(path);
    if (/\/orders(?:\?|$)/.test(path)) {
      const orders = (result as { orders?: MerchantOrder[] })?.orders;
      if (!Array.isArray(orders) || orders.some(order => order.restaurantId !== restaurantId)) {
        throw new ApiError('Ответ заказов не соответствует выбранному ресторану. Обновите данные.', 0, 'SCOPE_MISMATCH');
      }
    }
    return result;
  }
  function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const verb = method.toUpperCase();
    const expected = generation;
    if (verb === 'GET') return execute<T>(path, verb, body, expected);
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    const fingerprint = isForm ? body : `${verb}:${JSON.stringify(body)}`;
    const resource = path.endsWith('/dispatch') ? path.slice(0, -'/dispatch'.length) : path;
    return mutations.run(`${expected}:${resource}`, fingerprint, () => execute<T>(path, verb, body, expected));
  }
  const api = {
    request,
    snapshot: () => session,
    subscribe(listener: (value: Session | null) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async login(phone: string, password: string): Promise<Session> {
      const expected = ++generation;
      session = null;
      await queueStorage(async () => { if (expected === generation) await storage.clear(); });
      check(expected);
      return commit(await http<Session>('/auth/login', 'POST', { phone: phone.trim(), password }), expected);
    },
    restore(): Promise<Session | null> {
      if (session) return Promise.resolve(session);
      if (restoreTask) return restoreTask;
      const expected = generation;
      const promise = (async () => {
        await storageQueue;
        check(expected);
        const raw = await storage.read();
        check(expected);
        if (!raw) return null;
        let tokens: Tokens;
        try { tokens = JSON.parse(raw); if (typeof tokens.refreshToken !== 'string' || !tokens.refreshToken || typeof tokens.accessToken !== 'string') throw new Error(); }
        catch { await clearSession(expected); return null; }
        try { return await refresh(tokens, expected); }
        catch (error) { if (error instanceof ApiError && error.status === 401 && !(error instanceof StaleSessionError)) return null; throw error; }
      })();
      restoreTask = promise;
      const clear = () => { if (restoreTask === promise) restoreTask = null; };
      void promise.then(clear, clear);
      return promise;
    },
    async logout(): Promise<void> {
      const previous = session;
      const clearing = clearSession(generation);
      const revoking = previous ? http('/auth/logout', 'POST', { refreshToken: previous.refreshToken }).catch(() => undefined) : Promise.resolve();
      await Promise.all([clearing, revoking]);
    },
    async me(): Promise<Profile> {
      const expected = generation;
      const profile = await request<Profile>('/me');
      check(expected);
      if (!session) throw new StaleSessionError();
      session = validateSession({ ...session, ...profile });
      emit();
      return profile;
    },
    restaurant: (id: string) => request<RestaurantDetail>(`/${encodeURIComponent(id)}`),
    saveCatalog: (id: string, catalog: Catalog, updatedAt: string) => {
      if (id !== catalog.id || !updatedAt) return Promise.reject(new ApiError('Обновите ресторан перед сохранением.', 409, 'MISSING_VERSION'));
      return request<RestaurantDetail>(`/${encodeURIComponent(id)}/catalog`, 'PUT', { catalog, updatedAt });
    },
    orders: (id: string) => request<{ orders: MerchantOrder[] }>(`/${encodeURIComponent(id)}/orders`),
    action: (id: string, orderId: string, action: OrderAction, reason?: string) => request<MerchantOrder>(`/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}`, 'PATCH', { action, ...(reason ? { reason } : {}) }),
    quote: (id: string, orderId: string, input: DispatchInput) => request<DeliveryQuote>(`/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/dispatch-quote`, 'POST', input),
    dispatch: (id: string, orderId: string, input: DispatchInput) => request<Partial<MerchantOrder>>(`/${encodeURIComponent(id)}/orders/${encodeURIComponent(orderId)}/dispatch`, 'POST', input),
    stats: (id: string, period: StatsPeriod) => request<Stats>(`/${encodeURIComponent(id)}/stats?period=${period}`),
    staff: (id: string) => request<{ staff: Staff[] }>(`/${encodeURIComponent(id)}/staff`),
    saveStaff: (id: string, input: StaffInput, accountId?: string) => request<Staff>(`/${encodeURIComponent(id)}/staff${accountId ? `/${encodeURIComponent(accountId)}` : ''}`, accountId ? 'PATCH' : 'POST', input),
    deleteStaff: (id: string, accountId: string) => request<Staff>(`/${encodeURIComponent(id)}/staff/${encodeURIComponent(accountId)}`, 'DELETE'),
    uploadForm: (id: string, form: FormData) => request<{ url: string }>(`/${encodeURIComponent(id)}/media`, 'POST', form),
    scope(id: string) {
      let active = true;
      const expected = generation;
      return {
        restaurantId: id,
        dispose() { active = false; },
        async request<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
          if (!active) throw new ApiError('Ресторан изменён. Откройте экран заново.', 0, 'STALE_SCOPE');
          check(expected);
          const result = await request<T>(`/${encodeURIComponent(id)}${path}`, method, body);
          check(expected);
          if (!active) throw new ApiError('Ресторан изменён. Откройте экран заново.', 0, 'STALE_SCOPE');
          return result;
        },
      };
    },
  };
  return api;
}
export type RestaurantApi = ReturnType<typeof createRestaurantApi>;
