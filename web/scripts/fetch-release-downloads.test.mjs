import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { hydrateReleaseDownloads } from './fetch-release-downloads.mjs';
import { prepareDownloads } from './prepare-downloads.mjs';
import { physicalPath, validatePin } from './release-downloads.mjs';

async function fixture(t, previous = false) {
  const root = await mkdtemp(join(tmpdir(), 'atlas-fetch-release-test-')), destination = join(root, 'downloads'); await mkdir(destination);
  t.after(async () => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); assert.ok(basename(root).startsWith('atlas-fetch-release-test-')); await physicalPath(root, 'directory'); await rm(root, { recursive: true }); });
  const data = { client: Buffer.from('client:pinned-new'), driver: Buffer.from('driver:pinned-new') }, pin = { version: '1.2.08' };
  for (const variant of ['client', 'driver']) pin[variant] = { architecture: 'arm64-v8a', bytes: data[variant].length, sha256: createHash('sha256').update(data[variant]).digest('hex') };
  const manifest = validatePin(pin); await writeFile(join(destination, 'canary.txt'), 'preserve');
  if (previous) {
    const oldPin = { version: '1.2.07' };
    for (const variant of ['client', 'driver']) { const bytes = Buffer.from(variant + ':old'); await writeFile(join(destination, `atlas-${variant}.apk`), bytes); oldPin[variant] = { architecture: 'arm64-v8a', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }; }
    await writeFile(join(destination, 'manifest.json'), JSON.stringify(validatePin(oldPin), null, 3));
  }
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url.pathname); assert.equal(options.redirect, 'error');
    return url.pathname.endsWith('manifest.json') ? Response.json(manifest) : new Response(data[url.pathname.includes('client') ? 'client' : 'driver']);
  };
  return { root, destination, data, manifest, pin, fetcher, calls };
}
async function tree(root) { const result = {}; for (const name of (await readdir(root)).sort()) result[name] = (await readFile(join(root, name))).toString('base64'); return result; }

test('fresh hydration requires independently supplied hashes/bytes; version alone cannot trust live metadata', async t => {
  const h = await fixture(t), before = await tree(h.destination);
  await assert.rejects(hydrateReleaseDownloads({ ...h, pin: undefined, base: 'https://atlas.example', version: '1.2.08' }), /independent immutable/);
  assert.deepEqual(h.calls, []); assert.deepEqual(await tree(h.destination), before);
});
test('exact pinned hydration followed by build preparation preserves both downloads and manifest bytes', async t => {
  const h = await fixture(t);
  assert.deepEqual(await hydrateReleaseDownloads({ ...h, base: 'https://atlas.example' }), h.manifest);
  const before = await tree(h.destination); await mkdir(join(h.root, 'empty-builds'));
  assert.deepEqual(await prepareDownloads({ source: join(h.root, 'empty-builds'), destination: h.destination }), h.manifest);
  assert.deepEqual(await tree(h.destination), before);
  assert.deepEqual(h.calls, ['/downloads/manifest.json', '/downloads/atlas-client.apk', '/downloads/atlas-driver.apk']);
});
test('remote same-version SHA substitution is rejected before APK downloads without changing existing files', async t => {
  const h = await fixture(t, true), before = await tree(h.destination), remote = structuredClone(h.manifest); remote.driver.sha256 = '0'.repeat(64);
  const fetcher = async url => { assert.equal(url.pathname, '/downloads/manifest.json'); return Response.json(remote); };
  await assert.rejects(hydrateReleaseDownloads({ ...h, fetcher, replace: true, base: 'https://atlas.example' }), /independent immutable pin/);
  assert.deepEqual(await tree(h.destination), before);
});
test('corrupt second APK cannot replace either old APK or manifest and removes owned staging', async t => {
  const h = await fixture(t, true), before = await tree(h.destination);
  const fetcher = async (url, options) => url.pathname.includes('driver.apk') ? new Response(Buffer.from('bad')) : h.fetcher(url, options);
  await assert.rejects(hydrateReleaseDownloads({ ...h, fetcher, replace: true, base: 'https://atlas.example' }), /integrity mismatch/);
  assert.deepEqual(await tree(h.destination), before); assert.deepEqual(await readdir(h.root), ['downloads']);
});
test('verified staged release hydration defaults to preservation without any provider request', async t => {
  const h = await fixture(t); await hydrateReleaseDownloads({ ...h, base: 'https://atlas.example' }); const before = await tree(h.destination);
  const fetcher = () => { throw new Error('provider must not be called'); };
  assert.deepEqual(await hydrateReleaseDownloads({ ...h, fetcher, base: 'https://atlas.example' }), h.manifest);
  assert.deepEqual(await tree(h.destination), before);
});
test('explicit hydration replacement rollback restores the whole prior tree on manifest activation failure', async t => {
  const h = await fixture(t, true), before = await tree(h.destination);
  const renameFile = async (from, to) => { if (basename(from) === 'manifest.json' && dirname(to) === h.destination) throw new Error('injected manifest activation failure'); await rename(from, to); };
  await assert.rejects(hydrateReleaseDownloads({ ...h, replace: true, base: 'https://atlas.example', activation: { renameFile } }), /injected/);
  assert.deepEqual(await tree(h.destination), before); assert.deepEqual(await readdir(h.root), ['downloads']);
});
test('partial staged metadata is not silently repaired or bypassed by fresh hydration', async t => {
  const h = await fixture(t); await writeFile(join(h.destination, 'manifest.json'), JSON.stringify(h.manifest)); const before = await tree(h.destination);
  await assert.rejects(hydrateReleaseDownloads({ ...h, base: 'https://atlas.example' }), /Partial staged/);
  assert.deepEqual(h.calls, []); assert.deepEqual(await tree(h.destination), before);
});
