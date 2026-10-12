import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VARIANTS, physicalPath, sameRelease, stagedRelease, stageAndActivate, validatePin, verifyFile } from './release-downloads.mjs';

export async function prepareDownloads({ source, destination, pin, replace = false, allowUnavailable = false, runtime = process.env.NODE_ENV, activation } = {}) {
  const existing = await stagedRelease(destination);
  const expected = pin ? validatePin(pin) : null;
  if (existing.kind === 'verified' && !replace) {
    if (expected && !sameRelease(existing.manifest, expected)) throw new Error('Pinned release differs; replacement must be explicit.');
    return existing.manifest;
  }
  if (replace && !pin) throw new Error('Replacement requires an independent immutable release pin.');
  if (pin) {
    const manifest = validatePin(pin, true);
    await physicalPath(source, 'directory');
    for (const variant of VARIANTS) await verifyFile(join(source, pin[variant].file), manifest[variant]);
    return stageAndActivate(destination, existing, async stage => {
      for (const variant of VARIANTS) await copyFile(join(source, pin[variant].file), join(stage, `atlas-${variant}.apk`));
      await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    }, activation);
  }
  if (!allowUnavailable || runtime === 'production') throw new Error('Release build requires verified staged APKs or an immutable pin.');
  const unavailable = { client: { available: false }, driver: { available: false } };
  if (existing.kind === 'unavailable') return existing.manifest;
  return stageAndActivate(destination, existing, stage => writeFile(join(stage, 'manifest.json'), JSON.stringify(unavailable, null, 2) + '\n', { flag: 'wx', mode: 0o600 }), activation);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flags = process.argv.slice(2);
  if (flags.some(flag => !['--replace', '--allow-unavailable'].includes(flag))) throw new Error('Unknown download preparation option.');
  const root = resolve(import.meta.dirname, '../..');
  let pin;
  if (process.env.ATLAS_RELEASE_PIN_FILE) { await physicalPath(process.env.ATLAS_RELEASE_PIN_FILE, 'file'); pin = JSON.parse(await readFile(process.env.ATLAS_RELEASE_PIN_FILE)); }
  const manifest = await prepareDownloads({ source: resolve(root, 'mobile/builds'), destination: resolve(root, 'web/public/downloads'), pin, replace: flags.includes('--replace'), allowUnavailable: flags.includes('--allow-unavailable') });
  for (const variant of VARIANTS) console.log(`${variant}: ${manifest[variant].available ? 'verified APK ' + manifest[variant].version : 'explicit development: APK unavailable'}`);
}
