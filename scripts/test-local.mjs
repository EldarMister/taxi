import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const config = Object.fromEntries(readFileSync(resolve(root, '.local/database.env'), 'utf8').trim().split(/\r?\n/).map(line => {
  const index = line.indexOf('='); return [line.slice(0, index), line.slice(index + 1)];
}));
const parsed = new URL(config.TEST_DATABASE_URL);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || parsed.pathname !== '/taxi_test') {
  throw new Error('This helper only resets the local taxi_test database.');
}
const npmCli = process.env.npm_execpath || resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
if (!existsSync(npmCli)) throw new Error('Run this helper through npm run test:local.');
const env = { ...process.env, DATABASE_URL: config.TEST_DATABASE_URL, TEST_DATABASE_RESET: 'true', NODE_ENV: 'development' };
async function run(script) {
  await new Promise((done, fail) => {
    const child = spawn(process.execPath, [npmCli, 'run', script], { cwd: resolve(root, 'server'), env, stdio: 'inherit', windowsHide: true });
    child.once('error', fail);
    child.once('exit', code => code === 0 ? done() : fail(new Error(`${script} failed (${code})`)));
  });
}
await run('db:migrate');
await run('build');
await run('test');
await run('test:integration');
