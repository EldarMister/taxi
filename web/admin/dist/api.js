// Website, panel, API and live events share the website's current origin.
export const API = `${window.location.origin}/api`;
const KEY = 'taxigo.control.session', REMEMBER_KEY = 'taxigo.control.remember', USERNAME_KEY = 'taxigo.control.username', LOGOUT_KEY = 'taxigo.control.logout';
let current = null, rotation = null, restoration = null, epoch = 0, cookieQueue = Promise.resolve(), pendingLogout = null, signedInAt = 0;
function browserStorage(name) { try { return window[name]; } catch { return null; } }
const local = browserStorage('localStorage'), temporary = browserStorage('sessionStorage');
const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel('taxigo.control.session-events') : null;
export const session = () => current;
export const rememberedUsername = () => { try { return local?.getItem(USERNAME_KEY) || ''; } catch { return ''; } };
export const rememberEnabled = () => { try { return local?.getItem(REMEMBER_KEY) !== '0'; } catch { return true; } };
function cookieLogout() {
  try {
    const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith('atlas.admin.logout-pending='));
    return item ? JSON.parse(decodeURIComponent(item.slice('atlas.admin.logout-pending='.length))) : null;
  } catch { return null; }
}
function writeLogoutCookie(marker) {
  try {
    const secure = new URL(window.location.origin).protocol === 'https:' ? '; Secure' : '';
    document.cookie = `atlas.admin.logout-pending=${marker ? encodeURIComponent(JSON.stringify(marker)) : ''}; Path=/; SameSite=Strict; Max-Age=${marker ? 31536000 : 0}${secure}`;
  } catch {}
}
function readLogout() {
  const cookie = cookieLogout(); if (cookie?.state === 'pending') return cookie;
  if (!local) return pendingLogout;
  try { return JSON.parse(local.getItem(LOGOUT_KEY) || 'null'); } catch { return pendingLogout; }
}
export const logoutPending = () => readLogout()?.state === 'pending';
function removeSaved() { for (const storage of [local, temporary]) { try { storage?.removeItem(KEY); } catch {} } }
function stale() { const error = new Error('Сессия завершена.'); error.status = 401; error.code = 'STALE_SESSION'; return error; }
function check(generation) { if (generation !== epoch) throw stale(); }
function checkAccess(generation) { check(generation); if (logoutPending()) throw stale(); }
function forgetSession() { ++epoch; current = null; rotation = null; restoration = null; window.dispatchEvent(new Event('admin:signed-out')); }
export function clearSession() { removeSaved(); forgetSession(); }
function publishLogout(marker) {
  pendingLogout = marker.state === 'pending' ? marker : null;
  writeLogoutCookie(pendingLogout);
  try { local?.setItem(LOGOUT_KEY, JSON.stringify(marker)); } catch {}
  channel?.postMessage(marker);
}
function receiveLogout(marker) {
  if (!marker || !['pending', 'complete'].includes(marker.state) || typeof marker.id !== 'string' || typeof marker.at !== 'number' || marker.at < signedInAt) return;
  try { if (local && JSON.parse(local.getItem(LOGOUT_KEY) || 'null')?.id !== marker.id) return; } catch {}
  pendingLogout = marker.state === 'pending' ? marker : null;
  removeSaved(); forgetSession();
}
window.addEventListener('storage', event => {
  if (event.key !== LOGOUT_KEY || !event.newValue) return;
  try { receiveLogout(JSON.parse(event.newValue)); } catch {}
});
if (channel) channel.onmessage = event => receiveLogout(event.data);
function cookieMutation(work) {
  const task = cookieQueue.catch(() => undefined).then(() => globalThis.navigator?.locks
    ? navigator.locks.request('taxigo.control.cookie-write', work) : work());
  cookieQueue = task.catch(() => undefined);
  return task;
}
function validateSession(value) {
  if (!value?.accessToken || typeof value.accessToken !== 'string' || value.user?.role !== 'ADMIN') throw new Error('Доступ разрешён только администратору.');
  return { accessToken: value.accessToken, user: value.user, expiresIn: value.expiresIn };
}
async function request(path, { method = 'GET', body, token = current?.accessToken, browser = false } = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const multipart = body instanceof FormData;
    const response = await fetch(API + path, { method, signal: controller.signal, cache: 'no-store', credentials: 'same-origin', headers: {
      Accept: 'application/json', ...(browser ? { 'X-Atlas-Admin': '1' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
    let data; try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      let message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
      if (!message || /^Cannot (GET|POST|PATCH|DELETE)/.test(message)) message = response.status === 404 ? 'Раздел пока недоступен на сервере.' : 'Сервер не смог выполнить запрос.';
      const error = new Error(message); error.status = response.status; throw error;
    }
    return data;
  } catch (error) {
    if (error.status) throw error;
    throw new Error(controller.signal.aborted ? 'Сервер долго отвечает. Попробуйте ещё раз.' : 'Нет соединения с сервером. Проверьте подключение.');
  } finally { clearTimeout(timeout); }
}
async function requestBlob(path, token = current?.accessToken) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API + path, { signal: controller.signal, cache: 'no-store', credentials: 'same-origin', headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) {
      let data; try { data = await response.json(); } catch { data = null; }
      const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
      const error = new Error(message || (response.status === 404 ? 'Файл не найден.' : 'Не удалось открыть файл.')); error.status = response.status; throw error;
    }
    return { blob: await response.blob(), contentType: response.headers.get('content-type') || 'application/octet-stream' };
  } catch (error) {
    if (error.status) throw error;
    throw new Error(controller.signal.aborted ? 'Сервер долго отвечает. Попробуйте ещё раз.' : 'Нет соединения с сервером. Проверьте подключение.');
  } finally { clearTimeout(timeout); }
}
async function completeLogout(marker) {
  try {
    await request('/admin/auth/browser/logout', { method: 'POST', body: {}, token: null, browser: true });
    const latest = readLogout();
    if (latest?.id === marker.id) publishLogout({ ...marker, state: 'complete' });
  } catch (error) { error.logoutPending = true; throw error; }
}
export async function restoreSession() {
  if (current && !logoutPending()) return current;
  if (current) forgetSession();
  if (restoration?.generation === epoch) return restoration.promise;
  const generation = epoch;
  const promise = (async () => {
    const marker = readLogout();
    if (marker?.state === 'pending') { await cookieMutation(() => completeLogout(marker)); check(generation); return null; }
    let legacy = null;
    for (const storage of [local, temporary]) {
      try {
        const saved = JSON.parse(storage?.getItem(KEY) || 'null');
        if (saved?.user?.role === 'ADMIN' && typeof saved.refreshToken === 'string' && saved.refreshToken) { legacy = { token: saved.refreshToken, remember: storage === local }; break; }
      } catch {}
    }
    try {
      let next;
      if (legacy) {
        try {
          next = await cookieMutation(async () => { check(generation); return request('/admin/auth/browser/migrate', { method: 'POST', body: { refreshToken: legacy.token, remember: legacy.remember }, token: null, browser: true }); });
        } catch (error) {
          checkAccess(generation);
          if (error.status !== 401) throw error;
          // The prior migration may have committed its HttpOnly cookie before
          // its response body was lost. Validate that cookie before signing out.
          next = await request('/admin/auth/browser/refresh', { method: 'POST', body: {}, token: null, browser: true });
        }
      } else next = await request('/admin/auth/browser/refresh', { method: 'POST', body: {}, token: null, browser: true });
      check(generation);
      if (logoutPending()) throw stale();
      current = validateSession(next); signedInAt = Date.now(); removeSaved();
      return current;
    } catch (error) {
      check(generation);
      if (error.status === 401) { removeSaved(); forgetSession(); return null; }
      throw error;
    }
  })();
  restoration = { generation, promise };
  void promise.finally(() => { if (restoration?.promise === promise) restoration = null; }).catch(() => undefined);
  return promise;
}
export async function refresh() {
  if (!current || logoutPending()) throw stale();
  if (rotation?.generation === epoch) return rotation.promise;
  const generation = epoch;
  const promise = (async () => {
    try {
      const next = await request('/admin/auth/browser/refresh', { method: 'POST', body: {}, token: null, browser: true });
      check(generation); if (logoutPending()) throw stale(); current = validateSession(next); return current;
    } catch (error) { check(generation); if (error.status === 401) forgetSession(); throw error; }
  })();
  rotation = { generation, promise };
  void promise.finally(() => { if (rotation?.promise === promise) rotation = null; }).catch(() => undefined);
  return promise;
}
export async function api(path, options = {}) {
  if (!current || logoutPending()) throw stale();
  const generation = epoch, previous = current.accessToken;
  try { const result = await request(path, options); checkAccess(generation); return result; }
  catch (error) {
    checkAccess(generation);
    if (error.status !== 401 || !current) throw error;
    if (previous === current.accessToken) await refresh();
    checkAccess(generation);
    const result = await request(path, options); checkAccess(generation); return result;
  }
}
export async function apiBlob(path) {
  if (!current || logoutPending()) throw stale();
  const generation = epoch, previous = current.accessToken;
  try { const result = await requestBlob(path); checkAccess(generation); return result; }
  catch (error) {
    checkAccess(generation);
    if (error.status !== 401 || !current) throw error;
    if (previous === current.accessToken) await refresh();
    checkAccess(generation);
    const result = await requestBlob(path); checkAccess(generation); return result;
  }
}
export async function signIn(username, password, remember = true) {
  const generation = ++epoch; current = null; rotation = null; restoration = null;
  return cookieMutation(async () => {
    check(generation);
    const marker = readLogout();
    if (marker?.state === 'pending') await completeLogout(marker);
    check(generation);
    const result = await request('/admin/auth/browser/login', { method: 'POST', body: { username, password, remember }, token: null, browser: true });
    check(generation);
    const next = validateSession(result);
    removeSaved();
    try {
      local?.removeItem(LOGOUT_KEY);
      if (remember) { local?.setItem(USERNAME_KEY, username); local?.setItem(REMEMBER_KEY, '1'); }
      else { local?.removeItem(USERNAME_KEY); local?.setItem(REMEMBER_KEY, '0'); }
    } catch {}
    writeLogoutCookie(null);
    pendingLogout = null; current = next; signedInAt = Math.max(Date.now(), (marker?.at || 0) + 1);
    return current;
  });
}
export async function signOut() {
  removeSaved(); forgetSession();
  const marker = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, at: Date.now(), state: 'pending' };
  publishLogout(marker);
  return cookieMutation(() => completeLogout(marker));
}
export async function upload(file) { if (!file || file.size > 5 * 1024 * 1024) throw new Error('Выберите изображение до 5 МБ.'); const body = new FormData(); body.append('image', file); return api('/admin/media', { method: 'POST', body }); }
export function mediaUrl(value) {
  if (!value) return '';
  const path = String(value).trim();
  if (!path || path.startsWith('//')) return '';
  try {
    const url = new URL(path.startsWith('/content/media/') ? `/api${path}` : path, `${window.location.origin}/`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
