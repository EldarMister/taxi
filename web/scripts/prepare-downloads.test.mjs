import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { prepareDownloads } from './prepare-downloads.mjs';
import { physicalPath, validatePin } from './release-downloads.mjs';

async function fixture(t, version = '1.2.08', architecture = 'arm64-v8a') {
  const root = await mkdtemp(join(tmpdir(), 'atlas-release-test-')), destination = join(root, 'downloads'), source = join(root, 'builds');
  t.after(async () => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('atlas-release-test-')); await physicalPath(root, 'directory'); await rm(root, { recursive: true }); });
  await mkdir(destination); const data = {}, pin = { version };
  for (const variant of ['client', 'driver']) {
    data[variant] = Buffer.from(variant + ':' + version);
    pin[variant] = { architecture, bytes: data[variant].length, sha256: createHash('sha256').update(data[variant]).digest('hex'), file: `Atlas-${variant}-${version}${architecture === 'arm64-v8a' ? '-arm64' : ''}.apk` };
  }
  const manifest = validatePin(pin), raw = JSON.stringify(manifest, null, 3) + '\n';
  for (const variant of ['client', 'driver']) await writeFile(join(destination, `atlas-${variant}.apk`), data[variant]);
  await writeFile(join(destination, 'manifest.json'), raw); await writeFile(join(destination, 'unrelated-canary.txt'), 'keep');
  return { root, source, destination, pin, manifest, raw, data };
}
async function tree(root) {
  const result = {};
  for (const name of (await readdir(root)).sort()) result[name] = (await readFile(join(root, name))).toString('base64');
  return result;
}
async function newInputs(h, version = '1.2.09', architecture = 'arm64-v8a') {
  await mkdir(h.source, { recursive: true }); const pin = { version };
  for (const variant of ['client', 'driver']) {
    const data = Buffer.from(variant + ':' + version + ':replacement');
    const file = `Atlas-${variant}-${version}${architecture === 'arm64-v8a' ? '-arm64' : ''}.apk`;
    await writeFile(join(h.source, file), data);
    pin[variant] = { file, architecture, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  }
  return pin;
}

for (const mode of ['missing', 'empty', 'nonmatching', 'newer-WIP']) test(`verified staged pair stays byte-identical with ${mode} mobile/builds`, async t => {
  const h = await fixture(t), before = await tree(h.destination);
  if (mode !== 'missing') await mkdir(h.source);
  if (mode === 'nonmatching') await writeFile(join(h.source, 'notes.txt'), 'not an APK');
  if (mode === 'newer-WIP') await newInputs(h, '9.9.99');
  assert.deepEqual(await prepareDownloads({ ...h, pin: undefined }), h.manifest); assert.deepEqual(await tree(h.destination), before);
  assert.deepEqual((await readdir(h.root)).sort(), mode === 'missing' ? ['downloads'] : ['builds', 'downloads']);
});
for (const corrupt of ['missing-driver', 'APK-without-manifest', 'bad-hash', 'wrong-path', 'mixed-version', 'false-with-APK']) test(`invalid ${corrupt} staged release fails without mutation even with development or replacement`, async t => {
  const h = await fixture(t), pin = await newInputs(h);
  if (corrupt === 'missing-driver') await rm(join(h.destination, 'atlas-driver.apk'));
  if (corrupt === 'APK-without-manifest') await rm(join(h.destination, 'manifest.json'));
  if (corrupt === 'bad-hash') await writeFile(join(h.destination, 'atlas-client.apk'), 'corrupt');
  if (['wrong-path', 'mixed-version', 'false-with-APK'].includes(corrupt)) {
    const manifest = structuredClone(h.manifest);
    if (corrupt === 'wrong-path') manifest.client.path = '/downloads/other.apk';
    if (corrupt === 'mixed-version') manifest.driver.version = '1.2.09';
    if (corrupt === 'false-with-APK') { manifest.client = { available: false }; manifest.driver = { available: false }; }
    await writeFile(join(h.destination, 'manifest.json'), JSON.stringify(manifest));
  }
  const before = await tree(h.destination);
  for (const options of [{ allowUnavailable: true, runtime: 'development' }, { pin, replace: true }]) {
    await assert.rejects(prepareDownloads({ ...h, ...options })); assert.deepEqual(await tree(h.destination), before);
  }
});
test('fresh missing release fails; unavailable requires explicit development and never enables production', async t => {
  const h = await fixture(t); for (const name of ['atlas-client.apk', 'atlas-driver.apk', 'manifest.json']) await rm(join(h.destination, name));
  const before = await tree(h.destination);
  await assert.rejects(prepareDownloads({ ...h, pin: undefined }), /requires verified/);
  await assert.rejects(prepareDownloads({ ...h, pin: undefined, allowUnavailable: true, runtime: 'production' }), /requires verified/);
  assert.deepEqual(await tree(h.destination), before);
  const result = await prepareDownloads({ ...h, pin: undefined, allowUnavailable: true, runtime: 'development' });
  assert.deepEqual(result, { client: { available: false }, driver: { available: false } });
  assert.equal(await readFile(join(h.destination, 'unrelated-canary.txt'), 'utf8'), 'keep');
  await assert.rejects(prepareDownloads({ ...h, pin: undefined }), /requires verified/);
});
test('replacement uses both exact independent hashes/bytes and filenames, never latest WIP', async t => {
  const h = await fixture(t), pin = await newInputs(h); await newInputs(h, '9.9.99');
  const before = await tree(h.destination);
  await assert.rejects(prepareDownloads({ ...h, pin }), /replacement must be explicit/);
  await assert.rejects(prepareDownloads({ ...h, pin: undefined, replace: true }), /immutable/);
  const wrong = structuredClone(pin); wrong.driver.sha256 = '0'.repeat(64);
  await assert.rejects(prepareDownloads({ ...h, pin: wrong, replace: true }), /integrity/);
  const escaped = structuredClone(pin); escaped.client.file = '../canary.apk';
  await assert.rejects(prepareDownloads({ ...h, pin: escaped, replace: true }), /exact/);
  assert.deepEqual(await tree(h.destination), before);
  assert.deepEqual(await prepareDownloads({ ...h, pin, replace: true }), validatePin(pin));
  assert.equal(await readFile(join(h.destination, 'unrelated-canary.txt'), 'utf8'), 'keep');
});
test('explicit pinned universal APK scenario remains supported without automatic selection', async t => {
  const h = await fixture(t), pin = await newInputs(h, '1.2.09', 'universal');
  const result = await prepareDownloads({ ...h, pin, replace: true });
  assert.equal(result.client.architecture, 'universal');
});
for (const failName of ['atlas-driver.apk', 'manifest.json']) test(`activation failure on ${failName} restores the entire original pair/manifest and canary`, async t => {
  const h = await fixture(t), pin = await newInputs(h), before = await tree(h.destination);
  const renameFile = async (from, to) => { if (basename(from) === failName && dirname(to) === h.destination) throw new Error('injected activation failure'); await rename(from, to); };
  await assert.rejects(prepareDownloads({ ...h, pin, replace: true, activation: { renameFile } }), /injected/);
  assert.deepEqual(await tree(h.destination), before);
  assert.deepEqual((await readdir(h.root)).sort(), ['builds', 'downloads']);
});
test('source and destination junction ancestors are rejected without changing outside canaries', async t => {
  const h = await fixture(t), pin = await newInputs(h), outside = join(h.root, 'outside'); await mkdir(outside); await writeFile(join(outside, 'canary'), 'outside');
  const link = join(h.root, 'redirect'); await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    await assert.rejects(prepareDownloads({ ...h, source: link, pin, replace: true }), /symlinks|junctions/);
    await assert.rejects(prepareDownloads({ ...h, destination: join(link, 'downloads') }), /symlinks|junctions/);
    assert.deepEqual(await tree(outside), { canary: Buffer.from('outside').toString('base64') });
  } finally { await rm(link); }
});
test('a cleanup failure after successful activation reports committed state and preserves private work for inspection', async t => {
  const h = await fixture(t), pin = await newInputs(h); let failure, ownedStage;
  try { await prepareDownloads({ ...h, pin, replace: true, activation: { cleanupStage: async stage => { ownedStage = stage; throw new Error('injected cleanup failure'); } } }); }
  catch (error) { failure = error; }
  assert.equal(failure?.releaseActivated, true); assert.match(failure.message, /activation completed/);
  assert.deepEqual(JSON.parse(await readFile(join(h.destination, 'manifest.json'))), validatePin(pin));
  assert.equal(await readFile(join(h.destination, 'unrelated-canary.txt'), 'utf8'), 'keep');
  assert.notEqual(dirname(failure.workArea), dirname(h.destination), 'private backups stay outside the public input parent');
  assert.equal(failure.workArea, ownedStage);
  assert.equal(dirname(resolve(ownedStage)), resolve(tmpdir())); assert.ok(basename(ownedStage).startsWith('.atlas-release-'));
  const identity = createHash('sha256').update(resolve(h.destination)).digest('hex').slice(0, 16);
  assert.equal(resolve(failure.lockPath), join(resolve(tmpdir()), `.atlas-release-${identity}.lock`));
  await physicalPath(failure.workArea, 'directory'); await rm(failure.workArea, { recursive: true });
  await physicalPath(failure.lockPath, 'directory'); await rm(failure.lockPath, { recursive: true });
});
