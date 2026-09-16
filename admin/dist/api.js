export const API = 'https://api-production-3839.up.railway.app/api';
const KEY = 'taxigo.control.session';
let current = null, rotation = null, epoch = 0;
try { const saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); if (saved?.user?.role === 'ADMIN' && saved?.refreshToken) current = saved; } catch {}
export const session = () => current;
function keep(value) { current = value; if (value) sessionStorage.setItem(KEY, JSON.stringify(value)); else sessionStorage.removeItem(KEY); }
export function clearSession() { ++epoch; keep(null); window.dispatchEvent(new Event('admin:signed-out')); }
async function request(path, { method = 'GET', body, token = current?.accessToken } = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const multipart = body instanceof FormData;
    const response = await fetch(API + path, { method, signal: controller.signal, cache: 'no-store', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : multipart ? body : JSON.stringify(body) });
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
export async function refresh() {
  if (rotation) return rotation;
  const generation = epoch, token = current?.refreshToken;
  if (!token) throw new Error('Войдите в панель управления.');
  rotation = (async () => {
    try { const next = await request('/auth/refresh', { method: 'POST', body: { refreshToken: token }, token: null }); if (generation !== epoch) throw new Error('Сессия завершена.'); keep({ ...current, ...next }); return current; }
    catch (error) { if (generation === epoch && [401, 403].includes(error.status)) clearSession(); throw error; }
    finally { rotation = null; }
  })();
  return rotation;
}
export async function api(path, options = {}) {
  const generation = epoch, previous = current?.accessToken;
  try { return await request(path, options); }
  catch (error) {
    if (error.status !== 401 || !current?.refreshToken || generation !== epoch) throw error;
    if (previous === current.accessToken) await refresh();
    if (generation !== epoch) throw new Error('Сессия завершена.');
    return request(path, options);
  }
}
export async function signIn(username, password) { const result = await request('/admin/auth/login', { method: 'POST', body: { username, password }, token: null }); if (result?.user?.role !== 'ADMIN') throw new Error('Доступ разрешён только администратору.'); ++epoch; keep(result); return result; }
export async function signOut() { const saved = current; try { if (saved) await request('/auth/logout', { method: 'POST', body: { refreshToken: saved.refreshToken }, token: saved.accessToken }); } finally { clearSession(); } }
export async function upload(file) { if (!file || file.size > 5 * 1024 * 1024) throw new Error('Выберите изображение до 5 МБ.'); const body = new FormData(); body.append('image', file); return api('/admin/media', { method: 'POST', body }); }
export function mediaUrl(value) { if (!value) return ''; if (String(value).startsWith('/')) return `${API}${value}`; try { const u = new URL(value, new URL(API).origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
