// Synthetic audit server only; never load a production .env or send provider calls.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import os from 'node:os';
import v8 from 'node:v8';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { assertTestDatabase } from '../lib/database-target.mjs';
import { candidateIdentity } from '../lib/candidate.mjs';
const root = resolve(import.meta.dirname, '../..'), directory = join(root, '.local/load'); mkdirSync(directory, { recursive: true });
// Existing server data readers intentionally resolve paths from the server cwd.
process.chdir(join(root, 'server'));
if (process.env.LOCAL_LOAD_EXCLUSIVE_DATABASE !== 'true') throw new Error('Requires exclusive disposable audit DB clearance: LOCAL_LOAD_EXCLUSIVE_DATABASE=true.');
const config = Object.fromEntries(readFileSync(join(root, '.local/database.env'), 'utf8').trim().split(/\r?\n/).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
const database = new URL(config.TEST_DATABASE_URL); database.searchParams.set('connection_limit', '10'); database.searchParams.set('pool_timeout', '5');
Object.assign(process.env, { DATABASE_URL: database.toString(), NODE_ENV: 'development', TEST_DATABASE_RESET: 'true', JWT_SECRET: randomBytes(32).toString('hex'), OTP_SECRET: randomBytes(32).toString('hex'), DEV_AUTH_ENABLED: 'true', DEV_OTP_CODE: '123456', ACCESS_TOKEN_SECONDS: '3600', SMS_PROVIDER: 'development', PUSH_PROVIDER: 'development', ROUTING_PROVIDER: 'osrm', OSRM_BASE_URL: 'http://127.0.0.1:9', NOMINATIM_BASE_URL: 'http://127.0.0.1:9', PHOTON_BASE_URL: 'http://127.0.0.1:9', CORS_ORIGINS: 'http://127.0.0.1:55449', TRUST_PROXY: 'false' });
const target = assertTestDatabase(process.env.DATABASE_URL);
if (target.port !== 55448 || target.database !== 'taxi_security_test') throw new Error('Synthetic load server uses only the newly provisioned audit database.');
// Routing is stubbed below. This extra guard prevents accidental fetch calls to providers.
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { const url = new URL(typeof input === 'string' ? input : input.url || String(input)); if (url.hostname !== '127.0.0.1') return Promise.reject(new Error('External fetch blocked in local synthetic load server.')); return nativeFetch(input, init); };
const requireServer = createRequire(join(root, 'server/package.json')); requireServer('reflect-metadata');
const { Test } = requireServer('@nestjs/testing'), { PrismaClient } = requireServer('@prisma/client'), { JwtService } = requireServer('@nestjs/jwt');
const { AppModule } = requireServer('./dist/src/app.module.js'), { RoutingService } = requireServer('./dist/src/providers.js'), { BackgroundJobs } = requireServer('./dist/src/jobs.js'), { OrdersService } = requireServer('./dist/src/orders.js');
const { apiValidation, ApiExceptionFilter } = requireServer('./dist/src/http.js'), { hashAdminPassword } = requireServer('./dist/src/admin.security.js');
const { CreateFoodOrderDto } = requireServer('./dist/src/food.dto.js');
const meal = { dishId: 'fixture-meal', quantity: 1, optionIds: [] };
// Exercise the actual candidate DTO/pipeline before a connection or seed write.
await apiValidation().transform({ requestId: randomUUID(), restaurantId: 'fixture-contract', fulfillment: 'PICKUP', paymentMethod: 'CASH', items: [meal] }, { type: 'body', metatype: CreateFoodOrderDto });
const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
const version = (await db.$queryRawUnsafe('SHOW server_version'))[0].server_version;
if (!String(version).startsWith('18.')) throw new Error('Synthetic candidate load requires PostgreSQL 18.');
const maxConnections = Number((await db.$queryRawUnsafe('SHOW max_connections'))[0].max_connections);
const run = `load-${randomUUID()}`, phonePrefix = BigInt('0x' + run.replace('load-', '').replaceAll('-', '').slice(0, 5)).toString().padStart(7, '0');
const pickup = { latitude: 42.8756, longitude: 74.604, address: 'Synthetic load pickup' }, dropoff = { latitude: 42.8528, longitude: 74.584, address: 'Synthetic load destination' };
const userRows = Array.from({ length: 950 }, (_, index) => ({ id: randomUUID(), name: `${run}-${index}`, phone: `+997${phonePrefix}${String(index).padStart(4, '0')}`, role: index < 800 ? 'CLIENT' : 'DRIVER' }));
const driverRows = userRows.slice(800).map(user => ({ userId: user.id, verified: true, online: false, deposit: 1_000_000, acceptsEconomy: true, locationLatitude: pickup.latitude, locationLongitude: pickup.longitude, locationAccuracyM: 8, locationMeasuredAt: new Date() }));
const restaurantRows = Array.from({ length: 50 }, (_, index) => ({ id: `${run}-restaurant-${index}`, active: true, isDemo: true, catalog: { id: `${run}-restaurant-${index}`, name: `Synthetic restaurant ${index}`, cuisine: 'Fixture', rating: 0, reviewCount: 0, categories: ['Fixture'], etaMin: 20, etaMax: 30, deliveryFee: 0, freeDeliveryThreshold: 0, minimumOrder: 0, address: pickup.address, latitude: pickup.latitude, longitude: pickup.longitude, phone: `+998${phonePrefix}${String(index).padStart(4, '0')}`, imageKey: '', heroImageKey: '', menuCategories: ['Fixture'], dishes: [{ id: 'fixture-meal', name: 'Synthetic meal', category: 'Fixture', description: '', portion: '1 serving', weightGrams: 250, price: 200, imageKey: '', available: true, optionIds: [] }], options: [], isOpen: true, isDemo: true } }));
const passwordHash = await hashAdminPassword(randomBytes(32).toString('hex'));
const accounts = restaurantRows.map((restaurant, index) => ({ id: randomUUID(), phone: `+999${phonePrefix}${String(index).padStart(4, '0')}`, name: `${run}-owner-${index}`, passwordHash, active: true, sessionVersion: 0 }));
const expiresAt = new Date(Date.now() + 3600_000), refreshRows = userRows.map(user => ({ id: randomUUID(), userId: user.id, familyId: randomUUID(), tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), expiresAt }));
const merchantSessions = accounts.map(account => ({ id: randomUUID(), accountId: account.id, familyId: randomUUID(), tokenHash: createHash('sha256').update(randomUUID()).digest('hex'), sessionVersion: 0, expiresAt }));
const tariffId = `${run}-economy`;
await db.$transaction(async tx => {
  // Only the exact disposable database can be reached. Prior fixture drivers are
  // made unavailable, without deleting their orders or other fixture records.
  await tx.driverProfile.updateMany({ data: { online: false } });
  await tx.user.createMany({ data: userRows }); await tx.driverProfile.createMany({ data: driverRows });
  await tx.vehicle.createMany({ data: driverRows.map((driver, index) => ({ driverId: driver.userId, make: 'Synthetic Toyota', color: 'White', plate: `${run}-${index}` })) });
  await tx.refreshSession.createMany({ data: refreshRows }); await tx.foodRestaurant.createMany({ data: restaurantRows });
  await tx.restaurantAccount.createMany({ data: accounts });
  await tx.restaurantMembership.createMany({ data: accounts.map((account, index) => ({ accountId: account.id, restaurantId: restaurantRows[index].id, role: 'OWNER', permissions: [] })) });
  await tx.restaurantSession.createMany({ data: merchantSessions });
  await tx.tariff.create({ data: { id: tariffId, name: 'Synthetic economy', description: 'Local load only', basePrice: 60, pricePerKm: 14, pricePerMinute: 2, minimumPrice: 100, commissionBps: 1000 } });
}, { timeout: 30000 });
const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RoutingService).useValue({ route: async (start, finish) => ({ distanceMeters: 3210, durationSeconds: 550, geometry: [start, finish], provider: 'osrm-fixture-local', steps: [] }) }).overrideProvider(BackgroundJobs).useValue({}).compile();
const app = module.createNestApplication({ logger: false }); app.setGlobalPrefix('api'); app.useGlobalPipes(apiValidation()); app.useGlobalFilters(new ApiExceptionFilter());
await app.listen(55449, '127.0.0.1');
const jwt = app.get(JwtService), signing = { secret: process.env.JWT_SECRET, expiresIn: 3600, issuer: 'taxi-api' };
const users = await Promise.all(userRows.map(async (user, index) => ({ userId: user.id, role: user.role, token: await jwt.signAsync({ sub: user.id, sid: refreshRows[index].id, fid: refreshRows[index].familyId }, { ...signing, audience: 'taxi-mobile' }), capabilities: index % 2 ? 'food-modifiers-v2' : '' })));
const merchants = await Promise.all(accounts.map(async (account, index) => ({ accountId: account.id, restaurantId: restaurantRows[index].id, token: await jwt.signAsync({ sub: account.id, sid: merchantSessions[index].id, ver: 0 }, { ...signing, audience: 'atlas-restaurant' }) })));
const fixtures = { fixtureRunId: run, clients: users.slice(0, 800).map((user, index) => ({ ...user, restaurantId: restaurantRows[index % 50].id, items: [structuredClone(meal)] })), drivers: users.slice(800), restaurants: merchants, pickup, dropoff, tariffId };
writeFileSync(join(directory, 'fixtures.json'), JSON.stringify(fixtures), { mode: 0o600 });
const candidate = candidateIdentity(root), memoryMiB = Math.round(os.totalmem() / 1024 / 1024), cpu = os.availableParallelism();
const resources = { host: { os: os.platform(), arch: os.arch(), logicalCpu: cpu, memoryMiB, cpuModel: os.cpus()[0].model }, api: { replicas: 1, cpu, memoryMiB, allocationMode: 'shared host; no hard CPU/RAM limit', maxHeapMiB: Math.round(v8.getHeapStatistics().heap_size_limit / 1024 / 1024), runtime: process.version, connectionLimit: 10 }, postgres: { replicas: 1, cpu, memoryMiB, allocationMode: 'shared host; no hard CPU/RAM limit', version, maxConnections }, generator: { replicas: 1, cpu, memoryMiB, allocationMode: 'shared host; no hard CPU/RAM limit', coLocatedWithApi: true }, maps: { osrm: 'deterministic local fixture; no real graph', photon: 'not exercised', nominatim: 'not exercised' } };
function writeProfile(activeUsers, label, foregroundMultiplier = 1) {
  writeFileSync(join(directory, `profile-${label}.json`), JSON.stringify({ fixtureRunId: run, approvalId: 'user-authorized-local-only', candidate, loadLabel: label, foregroundMultiplier, target: 'http://127.0.0.1:55449/api', approvedStagingOrigin: '', resources, providers: { sms: 'development (not invoked)', push: 'development (worker disabled)', routing: 'deterministic local OSRM-shaped fixture', payments: 'synthetic cash' }, activeUsers, durationSeconds: 120, intervalsSeconds: { clientSync: 12 / foregroundMultiplier, driverGps: 5 / foregroundMultiplier, driverOffers: 12 / foregroundMultiplier, restaurantOrders: 10 / foregroundMultiplier, catalog: 60 / foregroundMultiplier, bookingPerClient: 120, forcedReconnect: 60 }, mix: { clients: .8, drivers: .15, restaurants: .05, foodBooking: .5, taxiBooking: .5 }, notes: 'Local application/DB/Socket.IO fixture throughput only; accelerated order lifecycle, no real routing/search/push, colocated generators, no production capacity or savings claim. Peak doubles foreground polling/GPS only; booking, user count, resources and drain remain unchanged.' }, null, 2));
}
for (const activeUsers of [50, 100, 250, 500, 1000]) writeProfile(activeUsers, String(activeUsers));
writeProfile(1000, '1000-peak2x', 2);
writeFileSync(join(directory, 'server-state.json'), JSON.stringify({ fixtureRunId: run, serverPid: process.pid, baseUrl: 'http://127.0.0.1:55449/api', candidate, resources, startedAt: new Date().toISOString() }, null, 2));
const orders = app.get(OrdersService); let dispatching = false;
const dispatch = setInterval(async () => { if (dispatching) return; dispatching = true; try { const pending = await db.order.findMany({ where: { clientId: { in: users.slice(0, 800).map(user => user.userId) }, status: 'SEARCHING' }, select: { id: true }, take: 200 }); for (const row of pending) await orders.dispatchOrder(row.id); } catch { appendFileSync(join(directory, 'runtime.ndjson'), JSON.stringify({ at: new Date().toISOString(), dispatchError: true }) + '\n'); } finally { dispatching = false; } }, 3000);
const loop = monitorEventLoopDelay({ resolution: 20 }); loop.enable(); let sampling = false, previousCpu = process.cpuUsage();
const sampler = setInterval(async () => { if (sampling) return; sampling = true; try { const current = process.cpuUsage(), delta = { user: current.user - previousCpu.user, system: current.system - previousCpu.system }; previousCpu = current; const dbLoad = await db.$queryRawUnsafe("SELECT count(*)::int AS connections, count(*) FILTER (WHERE state='active')::int AS active, count(*) FILTER (WHERE wait_event_type='Lock')::int AS lock_waits FROM pg_stat_activity"); appendFileSync(join(directory, 'runtime.ndjson'), JSON.stringify({ at: new Date().toISOString(), pid: process.pid, memory: process.memoryUsage(), cpuMicroseconds: delta, eventLoopMs: { p95: loop.percentile(95) / 1e6, max: loop.max / 1e6 }, hostFreeMemoryBytes: os.freemem(), database: dbLoad[0] }) + '\n'); loop.reset(); } catch { appendFileSync(join(directory, 'runtime.ndjson'), JSON.stringify({ at: new Date().toISOString(), sampleError: true }) + '\n'); } finally { sampling = false; } }, 5000);
console.log('Synthetic local load server ready at http://127.0.0.1:55449/api; 800 clients, 150 drivers, 50 restaurants. Private fixtures/profiles: .local/load. No production capacity claim.');
let stopping = false; async function stop() { if (stopping) return; stopping = true; clearInterval(dispatch); clearInterval(sampler); loop.disable(); await app.close(); await db.$disconnect(); process.exit(0); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
