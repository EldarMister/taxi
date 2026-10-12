import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import request from 'supertest';
import { mountSiteRedirects } from '../src/site';
function application(site?: string) {
  const app = express();
  mountSiteRedirects(app, site);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/admin/dashboard', (_req, res) => res.status(401).json({ message: 'Login required' }));
  return app;
}
test('legacy website links redirect to the independent service, preserving paths and queries', async () => {
  const app = application('https://website.example');
  for (const path of ['/', '/admin', '/admin/', '/privacy/', '/terms/', '/drivers/', '/downloads/atlas-driver.apk', '/assets/main.js']) {
    const result = await request(app).get(path + '?source=old').set('Host', 'api.example').expect(307);
    assert.equal(result.headers.location, 'https://website.example' + path + '?source=old');
    assert.equal(result.headers['cache-control'], 'no-store');
  }
  await request(app).head('/admin/').expect(307);
});
test('redirects cannot intercept API, authentication, sockets, or unrelated requests', async () => {
  const app = application('https://website.example');
  await request(app).get('/api/health').expect(200, { ok: true });
  await request(app).get('/api/admin/dashboard').expect(401);
  for (const path of ['/api/missing', '/socket.io/', '/.env', '/missing', '//external.example/']) await request(app).get(path).expect(404);
  await request(app).post('/admin/').expect(404);
  await request(app).get('/admin/').set('Host', 'website.example').expect(404);
  await request(application()).get('/').expect(404);
});
test('website destination must be an origin, without credentials or executable schemes', () => {
  for (const url of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com/?query=1']) {
    assert.throws(() => application(url), /PUBLIC_SITE_URL/);
  }
});
