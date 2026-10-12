import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { assertTestDatabase } from '../lib/database-target.mjs';
import { assertLoadTarget, validateLoadManifest } from './target.mjs';
import { assertLoadResults } from './assert-results.mjs';
import { candidateIdentity } from '../lib/candidate.mjs';
import { LOAD_ROLES, validateRoleFixtures, assertRoleAllocations } from './roles.mjs';
import { createStartupBarrier } from './startup-barrier.mjs';
import { mergeRoleMetrics, assertHttpThresholds } from './merge-metrics.mjs';
const root = resolve(import.meta.dirname, '../..'), directory = join(root, '.local/load'), activeUsers = Number(process.argv[2]), mode = process.argv[3] || 'baseline';
if (![50, 100, 250, 500, 1000].includes(activeUsers) || !['baseline', 'peak2x'].includes(mode) || mode === 'peak2x' && activeUsers !== 1000 || process.env.LOCAL_LOAD_EXCLUSIVE_DATABASE !== 'true') throw new Error('Requires a declared load step/1000-user peak and exclusive disposable audit database clearance.');
const label = mode === 'peak2x' ? '1000-peak2x' : String(activeUsers);
const manifestPath = join(directory, `profile-${label}.json`), profile = validateLoadManifest(JSON.parse(readFileSync(manifestPath, 'utf8'))), current = candidateIdentity(root);
if (assertLoadTarget(profile.target) !== 'http://127.0.0.1:55449/api' || current.sourceDigest !== profile.candidate.sourceDigest || current.commit !== profile.candidate.commit) throw new Error('Local load candidate changed since server startup; rebuild/restart rather than mix results.');
const fixturesPath = join(directory, 'fixtures.json'), fixtureText = readFileSync(fixturesPath, 'utf8'), fixtures = JSON.parse(fixtureText), plan = validateRoleFixtures(fixtures, profile), fixtureDigest = createHash('sha256').update(fixtureText).digest('hex');
const settings = Object.fromEntries(readFileSync(join(root, '.local/database.env'), 'utf8').trim().split(/\r?\n/).map(line => { const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)]; }));
assertTestDatabase(settings.TEST_DATABASE_URL, { NODE_ENV: 'development', TEST_DATABASE_RESET: 'true' });
const parsed = new URL(settings.TEST_DATABASE_URL); if (parsed.port !== '55448' || parsed.pathname !== '/taxi_security_test') throw new Error('Only the new audit database is permitted for local load.');
const requireServer = createRequire(join(root, 'server/package.json')), { PrismaClient } = requireServer('@prisma/client'), db = new PrismaClient({ datasourceUrl: settings.TEST_DATABASE_URL });
const driverIds = fixtures.drivers.map(driver => driver.userId), clients = fixtures.clients.slice(0, Math.floor(activeUsers * .8)).map(user => user.userId);
await db.driverProfile.updateMany({ where: { userId: { in: driverIds } }, data: { online: false } });
await db.driverProfile.updateMany({ where: { userId: { in: driverIds.slice(0, plan.drivers) } }, data: { online: true, locationLatitude: fixtures.pickup.latitude, locationLongitude: fixtures.pickup.longitude, locationAccuracyM: 8, locationMeasuredAt: new Date() } });
const preparedAt = new Date().toISOString(), attempt = `${label}-${preparedAt.replace(/[^0-9TZ]/g, '')}`;
const httpPath = join(directory, `${attempt}-http-summary.json`), socketPath = join(directory, `${attempt}-socket-summary.json`), combinedRawPath = join(directory, `${attempt}-http-raw.ndjson`);
const children = new Set(), jobs = []; let socketJob = null, startAt = null, environment;
function run(name, executable, args, resultPath, overrides = {}) {
  const output = createWriteStream(join(directory, `${attempt}-${name}.log`), { flags: 'wx' });
  return new Promise(resolveResult => {
    const child = spawn(executable, args, { cwd: root, env: { ...environment, ...overrides, LOAD_RESULT: resultPath }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); children.add(child);
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    const failPeers = () => { barrier.fail(name + ' generator failed'); for (const peer of children) if (peer !== child) peer.kill(); };
    child.on('error', error => { children.delete(child); failPeers(); output.end(); resolveResult({ name, code: 1, error: error.message }); });
    child.on('close', code => { children.delete(child); if (code !== 0) failPeers(); output.end(() => resolveResult({ name, code: code ?? 1 })); });
  });
}
const barrier = await createStartupBarrier({ plan, fixtureDigest, candidate: current, onReady(at) {
  startAt = new Date(at).toISOString();
  socketJob = run('socket', process.execPath, ['scripts/load/socket-io.mjs'], socketPath, { LOAD_START_AT: String(at), K6_OUT: '' });
} });
environment = { ...process.env, LOAD_MANIFEST: manifestPath, LOAD_FIXTURES: fixturesPath, LOAD_FIXTURE_DIGEST: fixtureDigest, LOAD_STARTUP_URL: barrier.url, LOAD_STARTUP_KEY: barrier.key, K6_NO_USAGE_REPORT: 'true' };
const inputs = LOAD_ROLES.map(role => ({ role, summaryPath: join(directory, `${attempt}-${role}-summary.json`), rawPath: join(directory, `${attempt}-${role}-raw.ndjson`) }));
console.log(`Preparing local ${label}: four scoped HTTP role processes, common readiness barrier, HTTP + Socket.IO, unchanged 120s profile/60s drain.`);
for (const input of inputs) jobs.push(run(input.role, process.env.K6_BIN || (process.platform === 'win32' ? 'C:/Program Files/k6/k6.exe' : 'k6'), ['run', '--address', '127.0.0.1:0', '--quiet', '--log-format', 'raw', 'scripts/load/http.k6.js'], input.summaryPath, { LOAD_ROLE: input.role, K6_OUT: `json=${input.rawPath}` }));
let results, startupFailure;
try { results = await Promise.all(jobs); if (socketJob) results.push(await socketJob); barrier.assertReady(); }
catch (error) { startupFailure = error.message; }
finally { for (const child of children) child.kill(); await Promise.allSettled(jobs); if (socketJob) await socketJob; await barrier.close(); }
const finishedAt = new Date().toISOString(); let http, blocked = startupFailure, actors = {};
try { if (!startAt) throw new Error('No measured profile start was authorized.'); http = await mergeRoleMetrics({ inputs, profile, startAt, finishedAt, combinedRawPath }); assertHttpThresholds(http); }
catch (error) { blocked = [blocked, error.message].filter(Boolean).join('; '); }
writeFileSync(httpPath, JSON.stringify(http || { profile, metrics: {}, thresholdsPassed: false, blocked, productionReady: false }, null, 2), { flag: 'wx' });
if (!socketJob) writeFileSync(socketPath, JSON.stringify({ profile, passed: false, blocked: 'Startup role gate did not release Socket.IO', metrics: {}, accounts: [], productionReady: false }, null, 2), { flag: 'wx' });
const records = inputs.flatMap(input => readFileSync(join(directory, `${attempt}-${input.role}.log`), 'utf8').split(/\r?\n/).filter(line => /^\{"kind":"(?:critical|actor|booking-actor|http-failure)"/.test(line)).map(line => JSON.parse(line)));
if (records.length > 20000) throw new Error('Bounded diagnostics exceeded declared profile limit.');
try { actors = assertRoleAllocations(records, fixtures, profile); } catch (error) { blocked = [blocked, error.message].filter(Boolean).join('; '); }
const where = { clientId: { in: fixtures.clients.map(user => user.userId) }, createdAt: { gte: new Date(startAt || preparedAt) } };
const outcomes = await db.order.findMany({ where, select: { id: true, clientId: true, driverId: true, status: true, history: { orderBy: { createdAt: 'asc' }, select: { status: true, actorId: true } } } });
const food = await db.foodOrder.findMany({ where, select: { id: true, clientId: true, restaurantId: true, status: true, history: { orderBy: { createdAt: 'asc' }, select: { status: true, actorId: true } } } });
const commissions = await db.ledgerEntry.findMany({ where: { orderId: { in: outcomes.map(order => order.id) }, kind: 'COMMISSION' }, select: { orderId: true, driverId: true, idempotencyKey: true } });
await db.$disconnect();
const database = { taxi: outcomes, food, commissions, declaredClientIds: clients, declaredDriverIds: driverIds.slice(0, plan.drivers), restaurantActors: fixtures.restaurants.slice(0, plan.restaurants).map(merchant => ({ accountId: merchant.accountId, restaurantId: merchant.restaurantId })), actors, criticalOperations: records.filter(x => x.kind === 'critical') };
let acceptance;
try { acceptance = assertLoadResults(JSON.parse(readFileSync(httpPath, 'utf8')), JSON.parse(readFileSync(socketPath, 'utf8')), database); } catch (error) { blocked = [blocked, error.message].filter(Boolean).join('; '); }
if (results?.some(result => result.code !== 0)) blocked = [blocked, 'one or more load generators failed'].filter(Boolean).join('; ');
const evidence = { profile, attempt, preparedAt, startedAt: startAt, finishedAt, httpPath, socketPath, rawPath: combinedRawPath, generators: results, database, harness: { actorAllocation: 'immutable role-local VU slot in four independent k6 processes; no per-VU HTTP registration', fixtureDigest, startup: barrier.stats, roleRawStreams: inputs, startupRecordedSeparately: true, errors: records.filter(x => x.kind === 'http-failure'), bookingActors: records.filter(x => x.kind === 'booking-actor') }, acceptance, blocked, productionReady: false };
writeFileSync(join(directory, `${attempt}-run-evidence.json`), JSON.stringify(evidence, null, 2), { flag: 'wx' });
writeFileSync(join(directory, `${label}-run-evidence.json`), JSON.stringify(evidence, null, 2));
console.log(`Local ${label} run ${blocked ? 'blocked: ' + blocked : 'passed'}; evidence .local/load/${attempt}-run-evidence.json`);
if (blocked) process.exitCode = 1;
