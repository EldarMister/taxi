// Loopback-only browser fixture. It models the website -> private API proxy,
// never connects to PostgreSQL, Railway, external URLs or real user accounts.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const publicPort = 59421, privatePort = 59422;
const origin = 'http://127.0.0.1:' + publicPort;
const root = path.resolve(__dirname, '../dist');
const cookies = new Map(), access = new Map();
const state = { outage: false, login: 0, refresh: 0, logout: 0, protected: 0, lastRemember: null };
const cookieName = 'atlas.admin';
const cookiePath = '/api/admin/auth/browser';
const json = (res, status, value, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(value)); };
async function body(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; }
function currentCookie(req) { return req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1); }
function newAccess(token) { const value = 'fixture-access-' + randomUUID(); access.set(value, token); return { accessToken: value, expiresIn: 900, user: { id: 'fixture-admin-id', role: 'ADMIN', name: 'Local Fixture Admin' } }; }
const privateApi = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith(cookiePath + '/')) {
      if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['x-atlas-admin'] !== '1') return json(res, 403, { message: 'Untrusted browser origin' });
      if (state.outage) return json(res, 503, { message: 'Synthetic database outage' });
      const input = await body(req);
      if (req.url.endsWith('/login')) {
        if (input.username !== 'fixture-admin' || input.password !== 'fixture-password-only-42') return json(res, 401, { message: 'Incorrect synthetic credentials' });
        const token = 'fixture-cookie-' + randomUUID(); cookies.set(token, true); state.login++; state.lastRemember = input.remember;
        return json(res, 201, newAccess(token), { 'Set-Cookie': cookieName + '=' + token + '; Path=' + cookiePath + '; HttpOnly; SameSite=Strict' + (input.remember ? '; Max-Age=2592000' : '') });
      }
      const token = currentCookie(req);
      if (req.url.endsWith('/logout')) {
        state.logout++; if (token) cookies.delete(token);
        return json(res, 201, { ok: true }, { 'Set-Cookie': cookieName + '=; Path=' + cookiePath + '; HttpOnly; SameSite=Strict; Max-Age=0' });
      }
      if (!token || !cookies.has(token)) return json(res, 401, { message: 'No fixture session' });
      state.refresh++;
      return json(res, 201, newAccess(token));
    }
    if (state.outage) return json(res, 503, { message: 'Synthetic database outage' });
    const token = access.get(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!token || !cookies.has(token)) return json(res, 401, { message: 'No checked fixture access' });
    state.protected++;
    return json(res, 200, req.url === '/api/admin/cities' ? [] : { ok: true });
  } catch (error) { json(res, 400, { message: error.message }); }
});
const website = http.createServer(async (req, res) => {
  if (req.url.startsWith('/__fixture/control')) {
    if (req.method === 'POST') Object.assign(state, await body(req));
    return json(res, 200, state);
  }
  if (req.url.startsWith('/api/')) {
    const upstream = http.request({ hostname: '127.0.0.1', port: privatePort, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:' + privatePort } }, incoming => { res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res); });
    upstream.on('error', () => json(res, 503, { message: 'Private fixture API unavailable' }));
    req.pipe(upstream); return;
  }
  if (!req.url.startsWith('/admin/')) { res.writeHead(302, { Location: '/admin/#cities' }); res.end(); return; }
  const requestPath = decodeURIComponent(req.url.split('?')[0].slice('/admin/'.length)) || 'index.html';
  const file = path.resolve(root, requestPath);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream';
  let content = fs.readFileSync(file);
  if (path.basename(file) === 'index.html') content = content.toString().replace(/<script src="\.\/socket\.io\.min\.js" defer><\/script>/, '');
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(content);
});
privateApi.listen(privatePort, '127.0.0.1', () => website.listen(publicPort, '127.0.0.1', () => console.log('Synthetic browser fixture: ' + origin + '/admin/#cities')));
function stop() { website.close(); privateApi.close(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
