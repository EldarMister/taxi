import { requireTestDatabase } from './test-database';
requireTestDatabase();
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, request as proxyRequest, Server } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashAdminPassword } from '../src/admin.security';

const { AppModule } = require('../dist/src/app.module.js');
const { AppConfig } = require('../dist/src/config.js');
const { AuthService } = require('../dist/src/auth.js');
const { PrismaService } = require('../dist/src/prisma.service.js');
const { BackgroundJobs } = require('../dist/src/jobs.js');
const { OrderOutboxWorker } = require('../dist/src/order-outbox.js');
const { apiValidation, ApiExceptionFilter } = require('../dist/src/http.js');
const db = new PrismaClient(), runtimeDb = new PrismaClient();
const adminId = randomUUID(), clientId = randomUUID(), username = 'cookie-' + randomUUID().slice(0, 18);
const password = 'cookie-fixture-' + randomUUID();
const digits = BigInt('0x' + adminId.replaceAll('-', '').slice(0, 10)).toString().padStart(10, '0');
let app: any, website: Server, origin = '', privatePort = 0, outage = false, migrateAccessFailure = false;
let rememberedCookie = '', rememberedAccess = '', temporaryCookie = '';
const dependency = new Proxy(runtimeDb, { get(target, property) {
  const value = Reflect.get(target, property, target);
  if (typeof value === 'function') return (...args: unknown[]) => { if (outage) throw new ServiceUnavailableException('Synthetic database outage'); return value.apply(target, args); };
  if (value && typeof value === 'object') return new Proxy(value, { get(model, method) { const work = Reflect.get(model, method, model); return typeof work === 'function' ? (...args: unknown[]) => { if (outage) throw new ServiceUnavailableException('Synthetic database outage'); return work.apply(model, args); } : work; } });
  return value;
} });

async function call(path: string, data?: unknown, headers: Record<string, string> = {}) {
  const result = await fetch(origin + '/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  return { status: result.status, body: await result.json() as any, cookie: result.headers.get('set-cookie') };
}
const browserHeaders = (cookie?: string) => ({ Origin: origin, 'X-Atlas-Admin': '1', ...(cookie ? { Cookie: cookie } : {}) });
const firstCookie = (value: string | null) => { assert.ok(value); return value.split(';')[0]; };

before(async () => {
  website = createServer((req, res) => {
    const upstream = proxyRequest({ hostname: '127.0.0.1', port: privatePort, method: req.method, path: req.url, headers: { ...req.headers, host: '127.0.0.1:' + privatePort } }, reply => { res.writeHead(reply.statusCode!, reply.headers); reply.pipe(res); });
    upstream.on('error', () => { res.writeHead(503); res.end('{"message":"private API unavailable"}'); }); req.pipe(upstream);
  });
  await new Promise<void>(resolve => website.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + (website.address() as AddressInfo).port;
  process.env.CORS_ORIGINS = origin;
  await db.user.create({ data: { id: adminId, phone: '+998' + digits, name: 'Isolated Cookie Admin', role: 'ADMIN', adminCredential: { create: { username, passwordHash: await hashAdminPassword(password) } } } });
  await db.user.create({ data: { id: clientId, phone: '+999' + digits, name: 'Isolated Bearer Client', role: 'CLIENT' } });
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(dependency)
    .overrideProvider(BackgroundJobs).useValue({}).overrideProvider(OrderOutboxWorker).useValue({}).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(apiValidation()); app.useGlobalFilters(new ApiExceptionFilter());
  await app.listen(0, '127.0.0.1'); privatePort = (app.getHttpServer().address() as AddressInfo).port;
  const auth = app.get(AuthService), loadUser = auth.user.bind(auth);
  auth.user = async (...args: any[]) => {
    if (migrateAccessFailure && args[1]) throw new ServiceUnavailableException('Synthetic profile failure after migration writes');
    return loadUser(...args);
  };
});

after(async () => {
  outage = false;
  await app?.close();
  if (website) await new Promise<void>(resolve => website.close(() => resolve()));
  await db.refreshSession.deleteMany({ where: { userId: { in: [adminId, clientId] } } });
  await db.adminAudit.deleteMany({ where: { actorId: adminId } });
  await db.adminCredential.deleteMany({ where: { userId: adminId } });
  await db.user.deleteMany({ where: { id: { in: [adminId, clientId] } } });
  await db.rateLimit.deleteMany({ where: { key: 'admin-login:user:' + username } });
  await Promise.all([db.$disconnect(), runtimeDb.$disconnect()]);
});

test('real Nest browser cookie API through the website-to-private-API proxy', async t => {
  await t.test('exact Origin and custom CSRF header are required before login', async () => {
    for (const headers of [{}, { Origin: origin }, { Origin: 'https://untrusted.invalid', 'X-Atlas-Admin': '1' }]) {
      const result = await call('/admin/auth/browser/login', { username, password, remember: true }, headers);
      assert.equal(result.status, 403); assert.equal(result.cookie, null);
    }
    assert.equal(await db.refreshSession.count({ where: { userId: adminId } }), 0);
  });
  await t.test('remembered login returns no refresh token and sets a host-only HttpOnly Strict cookie', async () => {
    const result = await call('/admin/auth/browser/login', { username, password, remember: true }, browserHeaders());
    assert.equal(result.status, 201); assert.equal(result.body.user.id, adminId); assert.equal(result.body.refreshToken, undefined);
    assert.match(result.cookie!, /HttpOnly/); assert.match(result.cookie!, /SameSite=Strict/); assert.match(result.cookie!, /Path=\/api\/admin\/auth\/browser/);
    assert.match(result.cookie!, /Max-Age=/); assert.doesNotMatch(result.cookie!, /Domain=|Secure/);
    rememberedCookie = firstCookie(result.cookie); rememberedAccess = result.body.accessToken;
  });
  await t.test('reload and two-tab refresh reuse the stable family without rotating or revoking it', async () => {
    const before = await db.refreshSession.findMany({ where: { userId: adminId } });
    const results = await Promise.all([call('/admin/auth/browser/refresh', {}, browserHeaders(rememberedCookie)), call('/admin/auth/browser/refresh', {}, browserHeaders(rememberedCookie))]);
    for (const result of results) { assert.equal(result.status, 201); assert.equal(result.cookie, null); assert.equal(result.body.refreshToken, undefined); assert.equal(result.body.user.id, adminId); }
    const after = await db.refreshSession.findMany({ where: { userId: adminId } });
    assert.equal(after.length, before.length); assert.equal(after[0].id, before[0].id); assert.equal(after[0].tokenHash, before[0].tokenHash); assert.equal(after[0].revokedAt, null); assert.equal(after[0].browserSession, true);
  });
  await t.test('nonremembered login creates a session cookie and access remains ordinary Bearer', async () => {
    const result = await call('/admin/auth/browser/login', { username, password, remember: false }, browserHeaders());
    assert.equal(result.status, 201); assert.doesNotMatch(result.cookie!, /Max-Age=|Expires=/); temporaryCookie = firstCookie(result.cookie);
    const checked = await call('/users/me', undefined, { Authorization: 'Bearer ' + result.body.accessToken });
    assert.equal(checked.status, 200); assert.equal(checked.body.id, adminId);
  });
  await t.test('legacy administrator tokens migrate additively and mobile Bearer refresh stays intact', async () => {
    const legacy = await call('/admin/auth/login', { username, password }); assert.equal(legacy.status, 201); assert.ok(legacy.body.refreshToken);
    const oldHash = createHash('sha256').update(legacy.body.refreshToken).digest('hex');
    const old = await db.refreshSession.findUniqueOrThrow({ where: { tokenHash: oldHash } });
    const migrated = await call('/admin/auth/browser/migrate', { refreshToken: legacy.body.refreshToken, remember: true }, browserHeaders());
    assert.equal(migrated.status, 201); assert.equal(migrated.body.refreshToken, undefined);
    const cookie = firstCookie(migrated.cookie), newToken = cookie.slice('atlas.admin='.length);
    assert.notEqual(newToken, legacy.body.refreshToken, 'a legacy JavaScript token must not become the stable browser cookie');
    const record = await db.refreshSession.findUniqueOrThrow({ where: { tokenHash: oldHash } });
    assert.equal(record.browserSession, true); assert.ok(record.revokedAt);
    const browser = await db.refreshSession.findUniqueOrThrow({ where: { tokenHash: createHash('sha256').update(newToken).digest('hex') } });
    assert.equal(browser.familyId, old.familyId); assert.notEqual(browser.id, old.id); assert.equal(browser.browserSession, true); assert.equal(browser.revokedAt, null);
    assert.equal((await call('/users/me', undefined, { Authorization: 'Bearer ' + legacy.body.accessToken })).status, 401);
    const staleRequests = await Promise.all([call('/auth/refresh', { refreshToken: legacy.body.refreshToken }), call('/auth/refresh', { refreshToken: legacy.body.refreshToken }), call('/auth/refresh', { refreshToken: newToken })]);
    assert.equal(staleRequests.every(result => result.status === 401), true, 'both old JavaScript tokens and a browser cookie must be rejected by public rotation');
    assert.equal((await db.refreshSession.findUniqueOrThrow({ where: { id: browser.id } })).revokedAt, null, 'stale public refresh must not revoke the live stable-cookie session');
    const continued = await call('/admin/auth/browser/refresh', {}, browserHeaders(cookie)); assert.equal(continued.status, 201); assert.equal(continued.cookie, null); assert.equal(continued.body.user.id, adminId);
    const token = randomBytes(48).toString('base64url'), familyId = randomUUID();
    const session = await db.refreshSession.create({ data: { userId: clientId, familyId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000) } });
    const access = await app.get(JwtService).signAsync({ sub: clientId, sid: session.id, fid: familyId }, { secret: process.env.JWT_SECRET, expiresIn: 3600, issuer: 'taxi-api', audience: 'taxi-mobile' });
    assert.equal((await call('/users/me', undefined, { Authorization: 'Bearer ' + access, Cookie: rememberedCookie })).body.id, clientId);
    const rotated = await call('/auth/refresh', { refreshToken: token }); assert.equal(rotated.status, 201); assert.ok(rotated.body.refreshToken);
    const checked = await call('/users/me', undefined, { Authorization: 'Bearer ' + rotated.body.accessToken }); assert.equal(checked.status, 200); assert.equal(checked.body.id, clientId);
  });
  await t.test('a profile failure after migration writes rolls back revocation and replacement atomically', async () => {
    const legacy = await call('/admin/auth/login', { username, password }); assert.equal(legacy.status, 201);
    const oldHash = createHash('sha256').update(legacy.body.refreshToken).digest('hex');
    const original = await db.refreshSession.findUniqueOrThrow({ where: { tokenHash: oldHash } });
    const before = await db.refreshSession.count({ where: { familyId: original.familyId } });
    migrateAccessFailure = true;
    try {
      const failed = await call('/admin/auth/browser/migrate', { refreshToken: legacy.body.refreshToken, remember: true }, browserHeaders());
      assert.equal(failed.status, 503); assert.equal(failed.cookie, null); assert.equal(failed.body.accessToken, undefined); assert.equal(failed.body.refreshToken, undefined);
    } finally { migrateAccessFailure = false; }
    const retained = await db.refreshSession.findUniqueOrThrow({ where: { id: original.id } });
    assert.equal(retained.revokedAt, null); assert.equal(retained.browserSession, false); assert.equal(retained.tokenHash, original.tokenHash);
    assert.equal(await db.refreshSession.count({ where: { familyId: original.familyId } }), before, 'replacement row is rolled back');
    const oldAccess = await call('/users/me', undefined, { Authorization: 'Bearer ' + legacy.body.accessToken }); assert.equal(oldAccess.status, 200); assert.equal(oldAccess.body.id, adminId);
    const retried = await call('/admin/auth/browser/migrate', { refreshToken: legacy.body.refreshToken, remember: true }, browserHeaders()); assert.equal(retried.status, 201);
    assert.notEqual(firstCookie(retried.cookie).slice('atlas.admin='.length), legacy.body.refreshToken);
  });
  await t.test('dependency outage denies refresh and protected data without revoking the cookie family', async () => {
    outage = true;
    try {
      const refresh = await call('/admin/auth/browser/refresh', {}, browserHeaders(rememberedCookie)); assert.equal(refresh.status, 503); assert.equal(refresh.cookie, null); assert.equal(refresh.body.accessToken, undefined);
      const protectedResult = await call('/users/me', undefined, { Authorization: 'Bearer ' + rememberedAccess }); assert.equal(protectedResult.status, 503); assert.equal(protectedResult.body.id, undefined);
      const logout = await call('/admin/auth/browser/logout', {}, browserHeaders(rememberedCookie)); assert.equal(logout.status, 503); assert.equal(logout.cookie, null);
    } finally { outage = false; }
    assert.equal((await call('/admin/auth/browser/refresh', {}, browserHeaders(rememberedCookie))).status, 201);
  });
  await t.test('logout revokes the cookie family and its previously issued Bearer access', async () => {
    const out = await call('/admin/auth/browser/logout', {}, browserHeaders(rememberedCookie)); assert.equal(out.status, 201); assert.match(out.cookie!, /Expires=Thu, 01 Jan 1970/);
    assert.equal((await call('/admin/auth/browser/refresh', {}, browserHeaders(rememberedCookie))).status, 401);
    assert.equal((await call('/users/me', undefined, { Authorization: 'Bearer ' + rememberedAccess })).status, 401);
    assert.equal((await call('/admin/auth/browser/refresh', {}, browserHeaders(temporaryCookie))).status, 201, 'another independently created session remains valid');
  });
  await t.test('disabled credentials cannot refresh a browser session', async () => {
    await db.adminCredential.update({ where: { userId: adminId }, data: { disabled: true } });
    assert.equal((await call('/admin/auth/browser/refresh', {}, browserHeaders(temporaryCookie))).status, 401);
  });
});
