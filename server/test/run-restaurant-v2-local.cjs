// Isolated integration runner. Start npm run db:local and build the server first.
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const config = Object.fromEntries(fs.readFileSync(path.join(root, '.local/database.env'), 'utf8').trim().split(/\r?\n/).map(line => {
  const split = line.indexOf('='); return [line.slice(0, split), line.slice(split + 1)];
}));
const url = new URL(config.TEST_DATABASE_URL);
if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/taxi_test') throw new Error('Only disposable 127.0.0.1:55432/taxi_test is allowed.');
const server = path.join(root, 'server');
const env = {
  ...process.env, DATABASE_URL: config.TEST_DATABASE_URL, NODE_ENV: 'development', TEST_DATABASE_RESET: 'true',
  JWT_SECRET: randomBytes(32).toString('hex'), OTP_SECRET: randomBytes(32).toString('hex'),
  SMS_PROVIDER: 'development', PUSH_PROVIDER: 'development', DEV_AUTH_ENABLED: 'true', ROUTING_PROVIDER: 'osrm',
};
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: server, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run([path.join(server, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
run([path.join(server, 'node_modules/tsx/dist/cli.mjs'), '--test', '--test-concurrency=1', 'test/restaurant-v2.integration.test.ts']);
