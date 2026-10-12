import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { VARIANTS, physicalPath, sameRelease, stagedRelease, stageAndActivate, validateInfo, validatePin } from './release-downloads.mjs';

export async function hydrateReleaseDownloads({ base, destination, pin, version, replace = false, fetcher = fetch, activation }) {
  const existing = await stagedRelease(destination);
  const expected = pin ? validatePin(pin) : null;
  if (existing.kind === 'verified' && !replace) {
    if (expected && !sameRelease(existing.manifest, expected)) throw new Error('Pinned release differs; replacement must be explicit.');
    if (version && existing.manifest.client.version !== version) throw new Error('Pinned release version differs.');
    return existing.manifest;
  }
  if (!expected || (version && version !== pin.version)) throw new Error('Require an independent immutable release pin, not only a version.');
  const origin = new URL(base);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('Release source must be HTTPS');
  const response = await fetcher(new URL('/downloads/manifest.json', origin), { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Release manifest unavailable');
  const remote = await response.json();
  for (const variant of VARIANTS) validateInfo(remote[variant], variant, pin.version);
  if (!sameRelease(remote, expected)) throw new Error('Remote release differs from independent immutable pin.');
  return stageAndActivate(destination, existing, async stage => {
    for (const variant of VARIANTS) {
      const info = expected[variant], apk = await fetcher(new URL(info.path, origin), { redirect: 'error', signal: AbortSignal.timeout(300000) });
      if (!apk.ok || !apk.body) throw new Error(`${variant} APK unavailable`);
      let bytes = 0; const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(apk.body), new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > info.bytes) return callback(new Error('APK exceeds declared size'));
        hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(join(stage, `atlas-${variant}.apk`), { flags: 'wx', mode: 0o600 }));
      if (bytes !== info.bytes || hash.digest('hex') !== info.sha256) throw new Error(`${variant} APK integrity mismatch`);
    }
    await writeFile(join(stage, 'manifest.json'), JSON.stringify(expected, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }, activation);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.env.ATLAS_RELEASE_DOWNLOAD_BASE) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => flag !== '--replace')) throw new Error('Unknown release hydration option.');
  let pin;
  if (process.env.ATLAS_RELEASE_PIN_FILE) { await physicalPath(process.env.ATLAS_RELEASE_PIN_FILE, 'file'); pin = JSON.parse(await readFile(process.env.ATLAS_RELEASE_PIN_FILE)); }
  const manifest = await hydrateReleaseDownloads({ base: process.env.ATLAS_RELEASE_DOWNLOAD_BASE,
    destination: resolve(import.meta.dirname, '../public/downloads'), pin, version: process.env.ATLAS_RELEASE_VERSION, replace: flags.includes('--replace') });
  console.log(`Verified release APKs: ${manifest.client.version}`);
}
