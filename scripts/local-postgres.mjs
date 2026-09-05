import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

// Optional local development database. Never use this helper for production.
const localDir = resolve(import.meta.dirname, '..', '.local');
mkdirSync(localDir, { recursive: true });
const credentialsPath = resolve(localDir, 'postgres.json');
let credentials;
if (existsSync(credentialsPath)) {
  credentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
} else {
  credentials = { user: 'taxi', password: randomBytes(24).toString('hex'), port: 55432 };
  writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
}
const pg = new EmbeddedPostgres({
  ...credentials,
  databaseDir: resolve(localDir, 'postgres'),
  persistent: true,
  authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
  onLog: () => {},
  onError: message => process.stderr.write(String(message)),
});
if (!existsSync(resolve(localDir, 'postgres', 'PG_VERSION'))) await pg.initialise();
// Some Windows builds localize stderr; don't rely only on an English log line.
await Promise.race([
  pg.start(),
  (async () => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const probe = pg.getPgClient('postgres', '127.0.0.1');
      try { await probe.connect(); await probe.end(); return; }
      catch { await probe.end().catch(() => {}); await delay(500); }
    }
    throw new Error('Local PostgreSQL did not become ready within 30 seconds');
  })(),
]);
const client = pg.getPgClient('postgres', '127.0.0.1');
await client.connect();
for (const name of ['taxi', 'taxi_test']) {
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (!found.rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();
const connection = name => `postgresql://${credentials.user}:${credentials.password}@127.0.0.1:${credentials.port}/${name}?schema=public`;
writeFileSync(resolve(localDir, 'database.env'), `DATABASE_URL=${connection('taxi')}\nTEST_DATABASE_URL=${connection('taxi_test')}\n`, { mode: 0o600 });
console.log(`PostgreSQL is ready on 127.0.0.1:${credentials.port}. Connection strings: .local/database.env (ignored by Git).`);
console.log('Keep this terminal running; Ctrl+C stops this local database and preserves its data.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await pg.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60_000);
