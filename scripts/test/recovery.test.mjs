import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, mkdir, stat, lstat, symlink, unlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertRecoveryPath, collectFiles, encryptBundle, decryptBundle, removeRecoveryDirectory } from '../lib/recovery-bundle.mjs';
import { postgresRecoveryEnvironment } from '../lib/postgres-recovery-env.mjs';
test('recovery PG environment removes inherited libpq service, host-address and options before setting only the validated target',()=>{
  const inherited={PATH:'synthetic PATH',SystemRoot:'synthetic system',PGSERVICE:'old-service',PGSERVICEFILE:'old-file',PGSYSCONFDIR:'old-directory',PGOPTIONS:'-c timezone=Asia/Almaty',PGHOSTADDR:'203.0.113.9',PGHOST:'old-host',PGPORT:'9999',PGDATABASE:'old-db',PGUSER:'old-user',PGPASSWORD:'old-password',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'999',PGPASSFILE:'old-pass-file',pgservice:'case-insensitive-service',PG_BIN:'selected-by-parent'};
  const target='postgresql://synthetic-role:synthetic%2Bpassword@127.0.0.1:55448/taxi_security_test';
  const env=postgresRecoveryEnvironment(inherited,target);
  assert.deepEqual(env,{PATH:inherited.PATH,SystemRoot:inherited.SystemRoot,PGHOST:'127.0.0.1',PGPORT:'55448',PGDATABASE:'taxi_security_test',PGUSER:'synthetic-role',PGPASSWORD:'synthetic+password',PGSSLMODE:'disable',PGCONNECT_TIMEOUT:'10'});
  assert.equal(inherited.PGSERVICE,'old-service');assert.equal(inherited.PGHOSTADDR,'203.0.113.9');
  for(const name of ['PGSERVICE','PGSERVICEFILE','PGSYSCONFDIR','PGOPTIONS','PGHOSTADDR','PGPASSFILE','pgservice','PG_BIN'])assert.equal(name in env,false);
  assert.equal(postgresRecoveryEnvironment(inherited,new URL(target.replace('taxi_security_test','taxi_security_restore'))).PGDATABASE,'taxi_security_restore');
});
async function temporary(prefix, parent = tmpdir()) {
  await assertRecoveryPath(parent, { allowMissing: true, type: 'directory' });
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, prefix)), identity = await lstat(directory);
  return { directory, cleanup: () => removeRecoveryDirectory(directory, { root: parent, identity }) };
}
test('encrypted synthetic recovery restores database artifact, required files and configuration exactly', async () => {
  const temporaryDirectory = await temporary('atlas-recovery-'), dir = temporaryDirectory.directory;
  try {
    const source = join(dir, 'source'); await mkdir(source);
    await writeFile(join(source, 'database.dump'), 'SYNTHETIC DATABASE ARTIFACT; no live data');
    await writeFile(join(source, 'required.png'), randomBytes(2 * 1024 * 1024));
    await writeFile(join(source, 'configuration.json'), '{"SMS_PROVIDER":"development","fixture":true}');
    const entries = await collectFiles(source, [{ path: 'database.dump', name: 'database.dump', kind: 'database' }, { path: 'required.png', name: 'files/required.png', kind: 'required-file' }, { path: 'configuration.json', name: 'config/configuration.json', kind: 'configuration' }]);
    const key = randomBytes(32), output = join(dir, 'backup.atlas.enc');
    await encryptBundle({ entries, key, output, metadata: { candidate: 'synthetic', applicationDrillPassed: false } });
    assert.ok(!(await readFile(output)).includes(Buffer.from('SYNTHETIC DATABASE')));
    const destination = join(dir, 'restored'), manifest = await decryptBundle({ input: output, key, destination });
    assert.equal(manifest.entries.length, 3);
    assert.deepEqual(await readFile(join(destination, 'files/required.png')), await readFile(join(source, 'required.png')));
    assert.deepEqual(await readFile(join(destination, 'config/configuration.json')), await readFile(join(source, 'configuration.json')));
    const corrupt = await readFile(output); corrupt[Math.floor(corrupt.length / 2)] ^= 1; await writeFile(join(dir, 'tampered.enc'), corrupt);
    await assert.rejects(decryptBundle({ input: join(dir, 'tampered.enc'), key, destination: join(dir, 'tampered') }), /validation failed/);
    await assert.rejects(stat(join(dir, 'tampered')), /ENOENT/);
    await assert.rejects(decryptBundle({ input: output, key: randomBytes(32), destination: join(dir, 'wrong-key') }), /validation failed/);
    await assert.rejects(decryptBundle({ input: output, key, destination }), /EEXIST/);
  } finally { await temporaryDirectory.cleanup(); }
});
test('recovery inputs reject traversal and duplicate archive names', async () => {
  const temporaryDirectory = await temporary('atlas-recovery-safety-'), dir = temporaryDirectory.directory;
  try {
    await writeFile(join(dir, 'fixture'), 'fixture');
    await writeFile(join(dir, 'данные'), 'Unicode recovery path');
    assert.equal((await collectFiles(dir, [{ path: 'данные', name: 'config', kind: 'configuration' }])).length, 1);
    await assert.rejects(collectFiles(dir, [{ path: 'fixture', name: '../escape', kind: 'configuration' }]));
    await assert.rejects(collectFiles(dir, [{ path: '../outside', name: 'outside', kind: 'configuration' }]));
    await assert.rejects(collectFiles(dir, [{ path: 'fixture', name: 'same', kind: 'configuration' }, { path: 'fixture', name: 'same', kind: 'required-file' }]));
  } finally { await temporaryDirectory.cleanup(); }
});
test('redirected roots and parent escapes cannot read, write or clean outside recovery roots', async () => {
  const temporaryDirectory = await temporary('atlas-recovery-junction-'), dir = temporaryDirectory.directory;
  const source = join(dir, 'source'), outside = join(dir, 'outside'), junction = join(dir, 'redirect');
  try {
    await mkdir(source); await mkdir(outside);
    await writeFile(join(source, 'fixture'), 'synthetic recovery data');
    await writeFile(join(outside, 'canary'), 'preserve outside canary');
    await symlink(outside, junction, process.platform === 'win32' ? 'junction' : 'dir');
    const redirected = /reparse points, junctions or symbolic links/;
    await assert.rejects(collectFiles(junction, [{ path: 'canary', name: 'config', kind: 'configuration' }]), redirected);
    await assert.rejects(collectFiles(dir, [{ path: 'redirect/canary', name: 'config', kind: 'configuration' }]), redirected);
    const entries = await collectFiles(source, [{ path: 'fixture', name: 'config/fixture', kind: 'configuration' }]), key = randomBytes(32);
    await assert.rejects(encryptBundle({ entries, key, output: join(junction, 'escape.enc') }), redirected);
    await assert.rejects(stat(join(outside, 'escape.enc.partial')), /ENOENT/);
    const bundle = join(dir, 'backup.enc'); await encryptBundle({ entries, key, output: bundle });
    await writeFile(join(outside, 'backup.enc'), await readFile(bundle));
    await assert.rejects(decryptBundle({ input: join(junction, 'backup.enc'), key, destination: join(dir, 'blocked-input') }), redirected);
    await assert.rejects(stat(join(dir, 'blocked-input')), /ENOENT/);
    const corrupt = await readFile(bundle); corrupt[25] ^= 1; await writeFile(join(dir, 'tampered.enc'), corrupt);
    await assert.rejects(decryptBundle({ input: join(dir, 'tampered.enc'), key, destination: join(junction, 'extract') }), redirected);
    await assert.rejects(stat(join(outside, 'extract')), /ENOENT/);
    assert.equal(await readFile(join(outside, 'canary'), 'utf8'), 'preserve outside canary');
  } finally {
    if ((await lstat(junction).catch(() => undefined))?.isSymbolicLink()) await unlink(junction);
    await temporaryDirectory.cleanup();
  }
});
test('cleanup refuses a replaced directory and preserves its canary', async () => {
  const temporaryDirectory = await temporary('atlas-recovery-cleanup-'), dir = temporaryDirectory.directory;
  try {
    const destination = join(dir, 'created'); await mkdir(destination);
    const identity = await lstat(destination); await rename(destination, join(dir, 'original'));
    await mkdir(destination); await writeFile(join(destination, 'canary'), 'preserve replacement');
    await assert.rejects(removeRecoveryDirectory(destination, { root: dir, identity }), /identity changed/);
    assert.equal(await readFile(join(destination, 'canary'), 'utf8'), 'preserve replacement');
    if (process.platform === 'win32') {
      await rename(destination, join(dir, 'replacement'));
      await symlink(join(dir, 'replacement'), destination, 'junction');
      try {
        await assert.rejects(removeRecoveryDirectory(destination, { root: dir, identity }), /reparse points, junctions or symbolic links/);
        assert.equal(await readFile(join(dir, 'replacement/canary'), 'utf8'), 'preserve replacement');
      } finally { assert.ok((await lstat(destination)).isSymbolicLink()); await unlink(destination); }
    }
  } finally { await temporaryDirectory.cleanup(); }
});
test('CLI key output refuses a redirected parent inside .local before writing outside it', async () => {
  const checkout = resolve(import.meta.dirname, '../..'), local = join(checkout, '.local');
  const ownedLocal = await temporary('recovery-path-test-', local), ownedOutside = await temporary('atlas-recovery-cli-');
  const junction = join(ownedLocal.directory, 'redirect');
  try {
    await writeFile(join(ownedOutside.directory, 'canary'), 'preserve CLI canary');
    await symlink(ownedOutside.directory, junction, process.platform === 'win32' ? 'junction' : 'dir');
    const result = spawnSync(process.execPath, [join(checkout, 'scripts/recovery.mjs'), 'keygen', '--out', join(junction, 'key.bin')], { cwd: checkout, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.error, undefined); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reparse points, junctions or symbolic links/);
    await assert.rejects(stat(join(ownedOutside.directory, 'key.bin')), /ENOENT/);
    assert.equal(await readFile(join(ownedOutside.directory, 'canary'), 'utf8'), 'preserve CLI canary');
  } finally {
    if ((await lstat(junction).catch(() => undefined))?.isSymbolicLink()) await unlink(junction);
    await ownedLocal.cleanup(); await ownedOutside.cleanup();
  }
});
