import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'mobile/builds');
const destination = resolve(root, 'web/public/downloads');
await mkdir(destination, { recursive: true });

let files = [];
let sourceAvailable = true;
try {
  files = await readdir(source);
} catch {
  // A fresh checkout may not include ignored APK files.
  sourceAvailable = false;
}

let stagedManifest = {};
if (!sourceAvailable) {
  try { stagedManifest = JSON.parse(await readFile(resolve(destination, 'manifest.json'), 'utf8')); } catch {}
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

const entries = await Promise.all(['client', 'driver'].map(async (variant) => {
  const releaseFiles = files
    .map((name) => ({ name, match: name.match(new RegExp(`^Atlas-${variant}-(\\d+)\\.(\\d+)\\.(\\d+)(?:-arm64)?\\.apk$`)) }))
    .filter(({ match }) => match)
    .sort((a, b) => {
      for (let i = 1; i <= 3; i += 1) {
        const difference = Number(b.match[i]) - Number(a.match[i]);
        if (difference) return difference;
      }
      return Number(b.name.endsWith('-arm64.apk')) - Number(a.name.endsWith('-arm64.apk'));
    });
  const release = releaseFiles[0];
  if (!release) {
    // A deployment can contain a verified, pre-staged release without mobile sources.
    const staged = stagedManifest[variant];
    const stagedFile = resolve(destination, `atlas-${variant}.apk`);
    if (staged?.available && staged.path === `/downloads/atlas-${variant}.apk`) {
      try {
        if ((await stat(stagedFile)).size === staged.bytes && await digest(stagedFile) === staged.sha256) return [variant, staged];
      } catch {}
    }
    await rm(resolve(destination, `atlas-${variant}.apk`), { force: true });
    return [variant, { available: false }];
  }
  const from = resolve(source, release.name);
  const outputName = `atlas-${variant}.apk`;
  const to = resolve(destination, outputName);
  await copyFile(from, to);
  const bytes = (await stat(to)).size;
  const sha256 = await digest(to);
  return [variant, { available: true, version: release.match.slice(1).join('.'), architecture: release.name.endsWith('-arm64.apk') ? 'arm64-v8a' : 'universal', bytes, sha256, path: `/downloads/${outputName}` }];
}));

await writeFile(resolve(destination, 'manifest.json'), `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
for (const [variant, info] of entries) console.log(`${variant}: ${info.available ? `APK ${info.version} (${(info.bytes / 1048576).toFixed(1)} MiB)` : 'APK missing'}`);
