import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rmdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { hydrateReleaseDownloads } from './fetch-release-downloads.mjs';

async function fixture(t, corruptDriver = false) {
  const destination = await mkdtemp(join(tmpdir(), 'atlas-release-download-test-'));
  t.after(async () => { for (const name of await readdir(destination)) await rm(join(destination, name)); await rmdir(destination); });
  const data = Object.fromEntries(['client', 'driver'].map(variant => [variant, Buffer.from(`${variant}:new`)]));
  const manifest = Object.fromEntries(Object.entries(data).map(([variant, bytes]) => [variant, {
    available: true, version: '1.2.08', architecture: 'arm64-v8a', bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'), path: `/downloads/atlas-${variant}.apk`,
  }]));
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest));
  for (const variant of ['client', 'driver']) await writeFile(join(destination, `atlas-${variant}.apk`), 'previous');
  const fetcher = async url => url.pathname.endsWith('manifest.json') ? Response.json(manifest)
    : new Response(url.pathname.includes('client') ? data.client : corruptDriver ? Buffer.from('driver:bad') : data.driver);
  return { destination, data, manifest, fetcher };
}

test('build embeds both APKs only after their sizes and hashes match', async t => {
  const context = await fixture(t);
  const result = await hydrateReleaseDownloads({ ...context, base: 'https://atlas.example', version: '1.2.08' });
  assert.deepEqual(result, context.manifest);
  for (const variant of ['client', 'driver']) assert.deepEqual(await readFile(join(context.destination, `atlas-${variant}.apk`)), context.data[variant]);
});

test('a corrupt second APK leaves previous files intact and removes temporary files', async t => {
  const context = await fixture(t, true);
  await assert.rejects(hydrateReleaseDownloads({ ...context, base: 'https://atlas.example', version: '1.2.08' }), /integrity mismatch/);
  for (const variant of ['client', 'driver']) assert.equal(await readFile(join(context.destination, `atlas-${variant}.apk`), 'utf8'), 'previous');
  assert.equal((await readdir(context.destination)).some(name => name.endsWith('.download')), false);
});
