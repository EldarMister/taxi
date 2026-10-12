import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { LOAD_ROLES } from './roles.mjs';
export async function createStartupBarrier({ plan, fixtureDigest, candidate, onReady, deadlineMs = 45000 }) {
  const key = randomBytes(32).toString('hex'), ready = new Set(); let startAt = null, failure = null;
  const deadline = Date.now() + deadlineMs;
  const stats = { requests: 0, transportErrors: [], rejected: 0, ready: [], startAt: null };
  const server = createServer((request, response) => {
    stats.requests++;
    if (request.headers['x-load-startup-key'] !== key) { stats.rejected++; response.writeHead(403).end(); return; }
    if (failure || Date.now() >= deadline && !startAt) { response.writeHead(503).end(); return; }
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 1024) request.destroy(); });
    request.on('end', () => {
      try {
        const value = JSON.parse(body);
        if (!LOAD_ROLES.includes(value.role) || value.quota !== plan[value.role] || value.fixtureDigest !== fixtureDigest || value.sourceDigest !== candidate.sourceDigest) throw new Error('Invalid startup ownership.');
        if (request.method === 'POST' && request.url === '/ready') ready.add(value.role);
        else if (!(request.method === 'POST' && request.url === '/status') || !ready.has(value.role)) throw new Error('Unknown readiness operation.');
        if (ready.size === LOAD_ROLES.length && !startAt) { startAt = Date.now() + 2000; stats.startAt = new Date(startAt).toISOString(); onReady?.(startAt); }
        stats.ready = [...ready];
        response.writeHead(startAt ? 200 : 202, { 'Content-Type': 'application/json' }).end(JSON.stringify({ startAt, role: value.role, fixtureDigest, sourceDigest: candidate.sourceDigest }));
      } catch { stats.rejected++; response.writeHead(400).end(); }
    });
  });
  server.on('clientError', (error, socket) => { stats.transportErrors.push({ code: error.code || error.name, phase: startAt && Date.now() >= startAt ? 'after-start' : 'startup' }); socket.destroy(); });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  return { key, url: `http://127.0.0.1:${server.address().port}`, stats,
    assertReady() { if (!startAt || ready.size !== LOAD_ROLES.length || stats.rejected || stats.transportErrors.some(x => x.phase === 'startup') || failure) throw new Error('Four-role startup readiness was incomplete or failed.'); return startAt; },
    fail(message) { failure = message; },
    async close() { server.closeAllConnections(); await new Promise(done => server.close(done)); },
  };
}
