import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const source = resolve(root, 'mobile/builds');
const destination = resolve(root, 'web/public/downloads');
await mkdir(destination, { recursive: true });

let files = [];
try {
  files = await readdir(source);
} catch {
  // A fresh checkout may not include ignored APK files.
}

const entries = await Promise.all(['client', 'driver'].map(async (variant) => {
  const releaseFiles = files
    .map((name) => ({ name, match: name.match(new RegExp(`^Atlas-${variant}-(\\d+)\\.(\\d+)\\.(\\d+)\\.apk$`)) }))
    .filter(({ match }) => match)
    .sort((a, b) => {
      for (let i = 1; i <= 3; i += 1) {
        const difference = Number(b.match[i]) - Number(a.match[i]);
        if (difference) return difference;
      }
      return 0;
    });
  const release = releaseFiles[0];
  if (!release) {
    await rm(resolve(destination, `atlas-${variant}.apk`), { force: true });
    return [variant, { available: false }];
  }
  const from = resolve(source, release.name);
  const outputName = `atlas-${variant}.apk`;
  const to = resolve(destination, outputName);
  await copyFile(from, to);
  const bytes = (await stat(to)).size;
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(to)) hash.update(chunk);
  const sha256 = hash.digest('hex');
  return [variant, { available: true, version: release.match.slice(1).join('.'), bytes, sha256, path: `/downloads/${outputName}` }];
}));

await writeFile(resolve(destination, 'manifest.json'), `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`);
for (const [variant, info] of entries) console.log(`${variant}: ${info.available ? `APK ${info.version} (${(info.bytes / 1048576).toFixed(1)} MiB)` : 'APK missing'}`);
