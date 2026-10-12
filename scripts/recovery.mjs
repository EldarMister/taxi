// Local only. Production backup configuration requires separate authorization.
import { readFile, writeFile, mkdir, mkdtemp, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { assertTestDatabase } from './lib/database-target.mjs';
import { assertRecoveryPath, collectFiles, encryptBundle, decryptBundle, removeRecoveryDirectory } from './lib/recovery-bundle.mjs';
import { postgresRecoveryEnvironment } from './lib/postgres-recovery-env.mjs';
const root = resolve(import.meta.dirname, '..'), local = join(root, '.local');
const args = process.argv.slice(2), command = args.shift();
function option(name) { const index = args.indexOf(`--${name}`); if (index < 0 || !args[index + 1]) throw new Error(`Missing --${name}.`); return args[index + 1]; }
async function localPath(path, options = {}) {
  const resolved = resolve(path), rel = relative(local, resolved);
  if (!rel || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('Recovery paths must stay inside this checkout .local directory.');
  return assertRecoveryPath(resolved, { root: local, ...options });
}
function databaseEnv(value, restore = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Missing local database URL.'); }
  if (restore) {
    const target = `${url.hostname}:${url.port}${url.pathname}`;
    if (!['127.0.0.1:55448/taxi_security_restore', '127.0.0.1:5432/taxi_restore'].includes(target)
      || process.env.RESTORE_DATABASE_RESET !== 'true') throw new Error('Refusing restore: requires an exact disposable recovery database and RESTORE_DATABASE_RESET=true.');
    assertTestDatabase(value.replace(/\/taxi_security_restore(?=\?|$)/, '/taxi_security_test').replace(/\/taxi_restore(?=\?|$)/, '/taxi_test'), process.env);
  } else assertTestDatabase(value, process.env);
  return postgresRecoveryEnvironment(process.env, url);
}
async function pgTool(name, args, env) {
  const executable = process.env.PG_BIN ? join(process.env.PG_BIN, `${name}${process.platform === 'win32' ? '.exe' : ''}`) : name;
  const version = await new Promise((done, fail) => {
    const child = spawn(executable, ['--version'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => fail(new Error('Set PG_BIN to the PostgreSQL 18 bin directory.')));
    child.on('exit', code => code === 0 ? done(output) : fail(new Error(`Cannot identify ${name} version.`)));
  });
  if (!/\(PostgreSQL\) 18(?:\.|\s)/.test(version)) throw new Error('Recovery drills require PostgreSQL 18 tools.');
  await new Promise((done, fail) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let errorText = ''; child.stderr.on('data', chunk => { if (errorText.length < 1024) errorText += chunk; });
    child.on('error', () => fail(new Error(`Cannot start ${name}; set PG_BIN to your PostgreSQL 18 bin directory.`)));
    child.on('exit', code => code === 0 ? done() : fail(new Error(`${name} failed (${code}); inspect the local database independently. Tool stderr omitted to avoid leaking credentials.`)));
  });
}
await assertRecoveryPath(local, { allowMissing: true, type: 'directory' });
await mkdir(local, { recursive: true });
if (command === 'keygen') {
  const output = await localPath(option('out'), { allowMissing: true, type: 'file' }); await mkdir(dirname(output), { recursive: true });
  await localPath(output, { allowMissing: true, type: 'file' });
  await writeFile(output, randomBytes(32), { flag: 'wx', mode: 0o600 });
  console.log('Generated a separate random recovery key. Store an independent copy outside the backup location before relying on backups.');
} else if (command === 'backup') {
  const spec = JSON.parse(await readFile(await localPath(option('manifest'), { type: 'file' }), 'utf8'));
  if (!spec.sourceRoot || !Array.isArray(spec.files) || !spec.files.some(item => item.kind === 'configuration')) throw new Error('Explicit source root, configuration and required-files manifest are mandatory.');
  const sourceRoot = await localPath(spec.sourceRoot, { type: 'directory' });
  const output = await localPath(option('out'), { allowMissing: true, type: 'file' }), key = await readFile(await localPath(option('key-file'), { type: 'file' })), env = databaseEnv(process.env.DATABASE_URL);
  await mkdir(dirname(output), { recursive: true }); await assertRecoveryPath(local, { type: 'directory' });
  const stage = await mkdtemp(join(local, 'backup-stage-')), stageIdentity = await lstat(stage);
  try {
    const startedAt = new Date().toISOString(); await pgTool('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', join(stage, 'database.dump')], env);
    const entries = [...await collectFiles(stage, [{ path: 'database.dump', name: 'database.dump', kind: 'database' }]), ...await collectFiles(sourceRoot, spec.files)];
    const manifest = await encryptBundle({ entries, key, output, metadata: { startedAt, completedAt: new Date().toISOString(), candidate: spec.candidate || 'unverified-local', postgresMajor: 18, sourceDatabase: env.PGDATABASE, recoveryScope: spec.recoveryScope || 'database + explicit required files + configuration' } });
    console.log(`Encrypted local backup created (${manifest.entries.length} entries). RPO/RTO are not established by this operation.`);
  } finally { await removeRecoveryDirectory(stage, { root: local, identity: stageIdentity }); }
} else if (command === 'verify' || command === 'restore') {
  const destination = await localPath(option('destination'), { allowMissing: true, type: 'directory' });
  // Validate the target BEFORE decrypting or writing when a DB restore is requested.
  const env = command === 'restore' ? databaseEnv(process.env.RESTORE_DATABASE_URL, true) : undefined;
  const input = await localPath(option('bundle'), { type: 'file' }), key = await readFile(await localPath(option('key-file'), { type: 'file' }));
  await mkdir(dirname(destination), { recursive: true });
  await localPath(destination, { allowMissing: true, type: 'directory' });
  const manifest = await decryptBundle({ input, key, destination });
  if (!manifest.entries.some(entry => entry.kind === 'database' && entry.name === 'database.dump') || !manifest.entries.some(entry => entry.kind === 'configuration')) throw new Error('Incomplete recovery scope.');
  if (env) await pgTool('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '--exit-on-error', '--dbname', env.PGDATABASE, join(destination, 'database.dump')], env);
  console.log(`${command === 'restore' ? 'Local database restored' : 'Bundle authentication and file hashes verified'}; ${manifest.entries.length} entries. Application acceptance and measured RPO/RTO still require a drill.`);
} else throw new Error('Use keygen, backup, verify or restore; see docs/SECURITY-OPERATIONS.md.');
