import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

// Bootstrap files from the live release when code-upload limits prevent bundling APKs.
// The resulting image contains the APKs and needs no runtime download or credentials.
export async function hydrateReleaseDownloads({ base, destination, version, fetcher = fetch }) {
  const origin = new URL(base);
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('Release source must be HTTPS');
  await mkdir(destination, { recursive: true });
  let expected = {};
  try {
    expected = JSON.parse(await readFile(resolve(destination, 'manifest.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Generated APK metadata is deliberately excluded from Git. A fresh
    // checkout must pin the release version before trusting the live manifest.
    if (!version) throw new Error('Pin the release version for a fresh checkout');
  }
  const response = await fetcher(new URL('/downloads/manifest.json', origin), { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Release manifest unavailable');
  const remote = await response.json();
  const prepared = [];
  const manifest = {};
  try {
    for (const variant of ['client', 'driver']) {
      const info = remote[variant];
      const path = `/downloads/atlas-${variant}.apk`;
      if (!info?.available || info.path !== path || !/^\d+\.\d+\.\d+$/.test(info.version) ||
          info.architecture !== 'arm64-v8a' || !/^[a-f0-9]{64}$/.test(info.sha256) ||
          !Number.isSafeInteger(info.bytes) || info.bytes <= 0 || info.bytes > 150 * 1048576 ||
          (version && info.version !== version)) throw new Error(`Invalid ${variant} release`);
      if (expected[variant]?.available && ['version', 'sha256', 'bytes'].some(key => info[key] !== expected[variant][key])) {
        throw new Error(`Unexpected ${variant} release`);
      }
      const target = resolve(destination, `atlas-${variant}.apk`);
      const temporary = `${target}.download`;
      prepared.push({ target, temporary });
      const apk = await fetcher(new URL(path, origin), { signal: AbortSignal.timeout(300000) });
      if (!apk.ok || !apk.body) throw new Error(`${variant} APK unavailable`);
      let bytes = 0;
      const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(apk.body), new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > info.bytes) return callback(new Error('APK exceeds declared size'));
        hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(temporary));
      if (bytes !== info.bytes || hash.digest('hex') !== info.sha256) throw new Error(`${variant} APK integrity mismatch`);
      manifest[variant] = { available: true, version: info.version, architecture: info.architecture, bytes, sha256: info.sha256, path };
    }
    for (const file of prepared) await rename(file.temporary, file.target);
    await writeFile(resolve(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await Promise.all(prepared.map(file => rm(file.temporary, { force: true })));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.env.ATLAS_RELEASE_DOWNLOAD_BASE) {
  const manifest = await hydrateReleaseDownloads({ base: process.env.ATLAS_RELEASE_DOWNLOAD_BASE,
    destination: resolve(import.meta.dirname, '../public/downloads'), version: process.env.ATLAS_RELEASE_VERSION });
  console.log(`Verified release APKs: ${manifest.client.version}`);
}
