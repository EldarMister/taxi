// Run in CI after lockfile installations. No deploy or cloud mutation occurs.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { candidateIdentity, assertCandidateGate, MANDATORY_CHECKS, testReportCounts } from './lib/candidate.mjs';
import { assertTestDatabase } from './lib/database-target.mjs';
const root = resolve(import.meta.dirname, '..');
assertTestDatabase(process.env.DATABASE_URL);
const initial = candidateIdentity(root), directory = join(root, 'artifacts/candidate-checks'); mkdirSync(directory, { recursive: true });
const evidence = { ...initial, startedAt: new Date().toISOString(), checks: MANDATORY_CHECKS.map(name => ({ name, ...initial, status: 'not_run', exitCode: null, skipped: null, cancelled: null, todo: null })) };
const output = join(directory, 'evidence.json');
const save = () => writeFileSync(output, JSON.stringify(evidence, null, 2)); save();
const npm = process.env.npm_execpath || resolve(dirname(process.execPath), process.platform === 'win32' ? 'node_modules/npm/bin/npm-cli.js' : '../lib/node_modules/npm/bin/npm-cli.js');
const tsx = join(root, 'server/node_modules/tsx/dist/cli.mjs');
const tests = readdirSync(join(root, 'server/test')).filter(name => name.endsWith('.test.ts')).sort();
const isIntegration = name => name === 'integration.test.ts' || name.endsWith('.integration.test.ts');
const mobileScripts = Object.keys(JSON.parse(readFileSync(join(root, 'mobile/package.json'), 'utf8')).scripts).filter(name => name.startsWith('test:')).sort();
const adminTests = readdirSync(join(root, 'web/admin/test')).filter(name => /\.test\.(cjs|mjs|js)$/.test(name));
if (!tests.some(isIntegration) || !tests.some(name => !isIntegration(name)) || !mobileScripts.length || !adminTests.length) throw new Error('Mandatory suite discovery is empty; refusing implicit Node test discovery.');
const checks = [
  ['server-build', 'server', [npm, 'run', 'build']],
  ['server-unit', 'server', [tsx, '--test', '--test-reporter=tap', ...tests.filter(name => !isIntegration(name)).map(name => `test/${name}`)]],
  ['server-integration', 'server', [tsx, '--test', '--test-reporter=tap', '--test-concurrency=1', ...tests.filter(name => isIntegration(name)).map(name => `test/${name}`)]],
  ['mobile-typecheck', 'mobile', [npm, 'run', 'typecheck']],
  ['mobile-tests', 'mobile', mobileScripts.map(name => [npm, 'run', name])],
  ['website-build', 'web', [npm, 'run', 'build']],
  ['website-admin-tests', '.', ['--test', '--test-reporter=tap', ...adminTests.map(name => `web/admin/test/${name}`)]],
  ['operations-tests', '.', ['--test', '--test-reporter=tap', ...readdirSync(join(root, 'scripts/test')).filter(name => name.endsWith('.test.mjs')).map(name => `scripts/test/${name}`)]],
  ['dependency-audit', '.', ['server', 'mobile', 'web'].map(folder => [npm, '--prefix', folder, 'audit', '--include=dev', '--audit-level=high'])],
];
for (const [name, cwd, raw] of checks) {
  const check = evidence.checks.find(item => item.name === name); check.status = 'running'; check.startedAt = new Date().toISOString(); save();
  let capture = '', code = 0;
  for (const args of Array.isArray(raw[0]) ? raw : [raw]) {
    code = await new Promise(resolveCode => {
      const child = spawn(process.execPath, args, { cwd: resolve(root, cwd), env: { ...process.env, RATE_LIMIT_TEST_DATABASE_URL: process.env.DATABASE_URL }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { process.stdout.write(chunk); capture += chunk; });
      child.on('error', error => { capture += String(error); resolveCode(1); });
      child.on('exit', result => resolveCode(result ?? 1));
    });
    if (code !== 0) break;
  }
  Object.assign(check, { exitCode: code, ...testReportCounts(capture), finishedAt: new Date().toISOString() });
  check.status = code === 0 && !check.skipped && !check.cancelled && !check.todo && (!/(?:unit|integration|tests)$/.test(name) || check.testCount > 0) ? 'passed' : 'failed';
  writeFileSync(join(directory, `${name}.log`), capture); save();
  if (check.status !== 'passed') throw new Error(`Mandatory check failed: ${name}. Evidence includes unrun checks as release blockers.`);
}
const final = candidateIdentity(root);
assertCandidateGate(evidence, final);
evidence.finishedAt = new Date().toISOString(); evidence.localChecksPassed = true;
// Cloud rollout, live provenance, recovery and staging acceptance remain separate gates.
evidence.productionReady = false; save();
console.log(`All mandatory checks passed for ${final.commit} ${final.sourceDigest}. Production readiness is not asserted.`);
