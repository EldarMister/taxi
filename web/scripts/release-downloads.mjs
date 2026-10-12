import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, parse, resolve } from 'node:path';

export const VARIANTS = ['client', 'driver'];
const names = ['atlas-client.apk', 'atlas-driver.apk', 'manifest.json'];
const MAX_BYTES = 150 * 1048576;
export async function physicalPath(input, kind, missing = false) {
  const absolute = resolve(input), root = parse(absolute).root;
  const parts = absolute.slice(root.length).split(/[\\/]/).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let info;
    try { info = await lstat(current); } catch (error) { if (missing && error.code === 'ENOENT') return absolute; throw error; }
    if (info.isSymbolicLink()) throw new Error('Release paths cannot contain symlinks or junctions.');
    const last = index === parts.length - 1;
    if ((!last || kind === 'directory') && !info.isDirectory()) throw new Error('Release parent is not a directory.');
    if (last && kind === 'file' && !info.isFile()) throw new Error('Release input is not a regular file.');
  }
  return absolute;
}
async function exists(file) {
  try { await physicalPath(file, 'file'); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function digest(file) {
  await physicalPath(file, 'file');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function validateInfo(info, variant, version) {
  if (!info || info.available !== true || typeof info.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(info.version)
      || (version && info.version !== version) || !['arm64-v8a', 'universal'].includes(info.architecture)
      || info.path !== `/downloads/atlas-${variant}.apk` || typeof info.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(info.sha256)
      || !Number.isSafeInteger(info.bytes) || info.bytes <= 0 || info.bytes > MAX_BYTES) throw new Error(`Invalid ${variant} release metadata.`);
  return info;
}
export function validatePin(pin, localFiles = false) {
  if (!pin || typeof pin.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(pin.version)) throw new Error('Require an independent immutable release pin.');
  const result = {};
  for (const variant of VARIANTS) {
    const entry = pin[variant], publicPath = `/downloads/atlas-${variant}.apk`;
    if (!entry || (entry.available !== undefined && entry.available !== true) || (entry.version !== undefined && entry.version !== pin.version) || (entry.path !== undefined && entry.path !== publicPath)) throw new Error('Contradictory immutable pin metadata.');
    const info = { ...entry, available: true, version: pin.version, path: publicPath };
    validateInfo(info, variant, pin.version);
    if (localFiles) {
      const file = pin[variant]?.file;
      const expected = `Atlas-${variant}-${pin.version}${info.architecture === 'arm64-v8a' ? '-arm64' : ''}.apk`;
      if (file !== expected) throw new Error('Pinned source must name its exact version/variant/architecture APK.');
    }
    result[variant] = { available: true, version: pin.version, architecture: info.architecture, bytes: info.bytes, sha256: info.sha256, path: info.path };
  }
  return result;
}
export function sameRelease(left, right) {
  return VARIANTS.every(variant => ['version', 'architecture', 'bytes', 'sha256', 'path', 'available'].every(key => left[variant]?.[key] === right[variant]?.[key]));
}
export async function verifyFile(file, info) {
  await physicalPath(file, 'file');
  if ((await stat(file)).size !== info.bytes || await digest(file) !== info.sha256) throw new Error('APK integrity mismatch.');
}
export async function stagedRelease(destination) {
  await physicalPath(destination, 'directory', true);
  const present = await Promise.all(names.map(name => exists(join(destination, name))));
  if (!present.some(Boolean)) return { kind: 'absent' };
  if (!present[2]) throw new Error('Partial staged release: APK without manifest.');
  const raw = await readFile(join(destination, 'manifest.json'));
  let manifest; try { manifest = JSON.parse(raw); } catch { throw new Error('Invalid staged release manifest.'); }
  if (VARIANTS.every(variant => manifest[variant]?.available === false) && !present[0] && !present[1]) return { kind: 'unavailable', raw, manifest };
  if (!present.every(Boolean)) throw new Error('Partial staged release: require both APKs.');
  for (const variant of VARIANTS) {
    validateInfo(manifest[variant], variant);
    await verifyFile(join(destination, `atlas-${variant}.apk`), manifest[variant]);
  }
  if (manifest.client.version !== manifest.driver.version) throw new Error('Staged APK versions must match.');
  return { kind: 'verified', raw, manifest };
}

// Build-time private workspace, not an atomic publication to a live web server.
// Cooperating callers take an exclusive lock. Static path checks do not defend
// adversarial same-user path swaps; the build workspace must remain private.
export async function stageAndActivate(destination, previous, build, { renameFile = rename, cleanupStage } = {}) {
  destination = resolve(destination);
  const parent = dirname(destination), workParent = dirname(parent), nonce = randomUUID();
  const identity = createHash('sha256').update(destination).digest('hex').slice(0, 16);
  const lock = join(workParent, `.atlas-release-${identity}.lock`);
  await physicalPath(parent, 'directory', true); await mkdir(parent, { recursive: true });
  await physicalPath(workParent, 'directory');
  await physicalPath(lock, 'directory', true);
  await mkdir(lock, { mode: 0o700 });
  let stage, keepStage = false, activated = false;
  try {
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ nonce }), { flag: 'wx', mode: 0o600 });
    // Stage/backup outside public/downloads' parent, so a preserved failed
    // workspace cannot be copied from the website's public directory.
    stage = await mkdtemp(join(workParent, '.atlas-release-'));
    await build(stage);
    const prepared = await stagedRelease(stage);
    if (!['verified', 'unavailable'].includes(prepared.kind)) throw new Error('Staged release is incomplete.');
    const current = await stagedRelease(destination);
    if (current.kind !== previous.kind || current.raw?.toString('base64') !== previous.raw?.toString('base64')) throw new Error('Staged release changed while preparing.');
    await physicalPath(destination, 'directory', true); await mkdir(destination, { recursive: true });
    const backups = [], active = [];
    try {
      for (const name of names) {
        const target = join(destination, name), backup = join(stage, 'backup-' + name);
        if (await exists(target)) { await physicalPath(stage, 'directory'); await renameFile(target, backup); backups.push({ target, backup }); }
      }
      // Activate the manifest last, after both files have been verified.
      for (const name of names) {
        const from = join(stage, name), target = join(destination, name);
        if (await exists(from)) { await physicalPath(destination, 'directory'); await renameFile(from, target); active.push(target); }
      }
    } catch (error) {
      try {
        for (const file of active.reverse()) { await physicalPath(file, 'file'); await unlink(file); }
        for (const { target, backup } of backups.reverse()) { await physicalPath(backup, 'file'); await physicalPath(dirname(target), 'directory'); await rename(backup, target); }
      } catch (rollback) { keepStage = true; throw new AggregateError([error, rollback], `Release rollback failed; preserve private workspace ${stage}`); }
      throw error;
    }
    activated = true;
    return prepared.manifest;
  } finally {
    try {
      if (stage && !keepStage) { await physicalPath(stage, 'directory'); if (cleanupStage) await cleanupStage(stage); else await rm(stage, { recursive: true }); }
      await physicalPath(lock, 'directory');
      await physicalPath(join(lock, 'owner.json'), 'file');
      if (JSON.parse(await readFile(join(lock, 'owner.json'))).nonce !== nonce) throw new Error('Release lock ownership changed; preserve it.');
      await rm(lock, { recursive: true });
    } catch (cause) {
      const error = new Error(activated ? 'Release activation completed, but private cleanup failed; verify the active release before retry.' : 'Private release cleanup failed; preserve the work area.', { cause });
      error.releaseActivated = activated; error.workArea = stage; error.lockPath = lock;
      throw error;
    }
  }
}
