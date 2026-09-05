import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const root = resolve(import.meta.dirname, '..');
const credentials = JSON.parse(readFileSync(resolve(root, '.local/postgres.json'), 'utf8'));
const client = new pg.Client({ ...credentials, host: '127.0.0.1', database: 'postgres', connectionTimeoutMillis: 5000 });
await client.connect();
for (const name of ['taxi', 'taxi_test']) {
  const found = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (!found.rowCount) await client.query(`CREATE DATABASE ${name}`);
}
await client.end();
const connection = name => `postgresql://${credentials.user}:${credentials.password}@127.0.0.1:${credentials.port}/${name}?schema=public`;
writeFileSync(resolve(root, '.local/database.env'), `DATABASE_URL=${connection('taxi')}\nTEST_DATABASE_URL=${connection('taxi_test')}\n`, { mode: 0o600 });
const serverEnv = resolve(root, 'server/.env');
if (!existsSync(serverEnv)) {
  let contents = readFileSync(resolve(root, 'server/.env.example'), 'utf8');
  contents = contents.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${connection('taxi')}`)
    .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${randomBytes(32).toString('hex')}`)
    .replace(/^OTP_SECRET=.*$/m, `OTP_SECRET=${randomBytes(32).toString('hex')}`);
  writeFileSync(serverEnv, contents, { mode: 0o600 });
}
if (!existsSync(resolve(root, 'mobile/.env'))) {
  writeFileSync(resolve(root, 'mobile/.env'), readFileSync(resolve(root, 'mobile/.env.example'), 'utf8'), { mode: 0o600 });
}
if (!existsSync(resolve(root, '.env'))) {
  writeFileSync(resolve(root, '.env'), readFileSync(resolve(root, '.env.example'), 'utf8').replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}`), { mode: 0o600 });
}
console.log('Local databases and development environment files are ready. Existing .env files were preserved.');
