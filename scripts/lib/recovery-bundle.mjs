import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, stat, lstat, readdir, realpath, rename, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip, createGunzip } from 'node:zlib';
const MAGIC = Buffer.from('ATLASBK1');
const MAX_MANIFEST = 16 * 1024 * 1024;
const safeName = name => typeof name === 'string' && name.length > 0 && name.length < 1024
  && !name.includes('\\') && !name.includes(':') && !name.startsWith('/')
  && name.split('/').every(part => part && part !== '.' && part !== '..');
const outside = path => path === '..' || path.startsWith('../') || path.startsWith('..\\') || isAbsolute(path);
// The work area must have private ACLs and no concurrent writers. These checks
// reject existing redirects; they do not defeat adversarial same-user path swaps.
async function rejectWindowsReparsePoints(paths) {
  if (process.platform !== 'win32') return;
  const script = "$ErrorActionPreference='Stop'; [Console]::InputEncoding=[Text.Encoding]::UTF8; try { $paths=ConvertFrom-Json ([Console]::In.ReadToEnd()); foreach($p in $paths) { if ((Get-Item -LiteralPath $p -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 11 } }; exit 0 } catch { exit 12 }";
  await new Promise((done, fail) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); fail(new Error('Windows recovery path inspection timed out.')); }, 10000);
    child.on('error', () => { clearTimeout(timer); fail(new Error('Cannot inspect Windows recovery path attributes.')); });
    child.stdin.on('error', () => { clearTimeout(timer); fail(new Error('Cannot inspect Windows recovery path attributes.')); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error(code === 11 ? 'Recovery paths must not contain reparse points, junctions or symbolic links.' : 'Cannot inspect Windows recovery path attributes.')); });
    child.stdin.end(JSON.stringify(paths));
  });
}
export async function assertRecoveryPaths(paths, { root, allowMissing = false, type } = {}) {
  const resolved = paths.map(path => resolve(path)), boundary = root === undefined ? undefined : resolve(root);
  if (boundary && resolved.some(path => outside(relative(boundary, path)))) throw new Error('Recovery path lies outside its selected root.');
  const details = new Map();
  for (const path of [...resolved, ...(boundary ? [boundary] : [])]) {
    for (let current = path;; current = dirname(current)) {
      if (!details.has(current)) {
        try {
          const entry = await lstat(current);
          if (entry.isSymbolicLink()) throw new Error('Recovery paths must not contain reparse points, junctions or symbolic links.');
          details.set(current, entry);
        } catch (error) { if (error.code !== 'ENOENT') throw error; details.set(current, undefined); }
      }
      if (dirname(current) === current) break;
    }
  }
  await rejectWindowsReparsePoints([...details].filter(([, entry]) => entry).map(([path]) => path));
  if (boundary && !details.get(boundary)?.isDirectory()) throw new Error('Recovery root must be an existing regular directory.');
  const physicalRoot = boundary && await realpath(boundary);
  for (const path of resolved) {
    const entry = details.get(path);
    if (!entry && !allowMissing) throw new Error('Recovery path does not exist.');
    if (entry && (type === 'file' ? !entry.isFile() : type === 'directory' && !entry.isDirectory())) throw new Error(`Recovery path must be a regular ${type}.`);
    if (boundary) {
      let existing = path; while (!details.get(existing)) existing = dirname(existing);
      if (outside(relative(physicalRoot, await realpath(existing)))) throw new Error('Recovery path escapes its physical root.');
    }
  }
  return resolved;
}
export async function assertRecoveryPath(path, options) { return (await assertRecoveryPaths([path], options))[0]; }
export async function removeRecoveryDirectory(path, { root, identity } = {}) {
  const resolved = await assertRecoveryPath(path, { root, type: 'directory' });
  const current = await lstat(resolved);
  if (!identity || current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Recovery cleanup refused: directory identity changed.');
  await rm(resolved, { recursive: true, force: true });
}
export async function hashFile(path) {
  const hash = createHash('sha256'); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest('hex');
}
export async function collectFiles(root, requests) {
  root = await assertRecoveryPath(root, { type: 'directory' });
  const entries = [], names = new Set();
  let pending = [];
  for (const input of requests) {
    if (!['configuration', 'required-file', 'database'].includes(input.kind) || !safeName(input.name)) throw new Error('Recovery inputs need an explicit kind and safe archive name.');
    const path = resolve(root, input.path), rel = relative(resolve(root), path);
    if (outside(rel)) throw new Error('Recovery input lies outside the explicitly selected source root.');
    pending.push({ source: path, name: input.name, kind: input.kind });
  }
  // Inspect each depth together, before listing directories or reading files.
  // This also rejects Windows reparse types that lstat does not call symlinks.
  while (pending.length) {
    await assertRecoveryPaths(pending.map(entry => entry.source), { root });
    const next = [];
    for (const { source, name, kind } of pending) {
      const details = await lstat(source);
      if (details.isSymbolicLink()) throw new Error('Recovery inputs must not contain symbolic links.');
      if (details.isDirectory()) {
        for (const child of (await readdir(source)).sort()) next.push({ source: join(source, child), name: `${name}/${child}`, kind });
      } else if (details.isFile()) {
        if (!safeName(name) || names.has(name)) throw new Error('Invalid or duplicate recovery entry name.');
        names.add(name); entries.push({ source, name, kind, size: details.size, sha256: await hashFile(source) });
      } else throw new Error('Recovery inputs must be regular files or directories.');
    }
    pending = next;
  }
  return entries;
}
export async function encryptBundle({ entries, key, output, metadata = {} }) {
  if (key.length !== 32) throw new Error('Recovery key must contain exactly 32 random bytes.');
  const names = new Set();
  for (const entry of entries) {
    if (!safeName(entry.name) || names.has(entry.name) || !Number.isSafeInteger(entry.size) || entry.size < 0) throw new Error('Invalid or duplicate recovery entry.');
    names.add(entry.name);
  }
  const manifest = { ...metadata, version: 1, entries: entries.map(({ source, ...entry }) => entry) };
  const json = Buffer.from(JSON.stringify(manifest));
  if (json.length > MAX_MANIFEST) throw new Error('Recovery manifest is too large.');
  const size = Buffer.alloc(4); size.writeUInt32BE(json.length);
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const partial = `${output}.partial`;
  await assertRecoveryPaths(entries.map(entry => entry.source), { type: 'file' });
  await assertRecoveryPaths([output, partial], { allowMissing: true, type: 'file' });
  const file = await open(partial, 'wx', 0o600); await file.write(Buffer.concat([MAGIC, iv])); await file.close();
  try {
    async function* content() {
      yield size; yield json;
      for (const entry of entries) for await (const chunk of createReadStream(entry.source)) yield chunk;
    }
    await pipeline(Readable.from(content()), createGzip(), cipher, createWriteStream(partial, { flags: 'a', mode: 0o600 }));
    const append = await open(partial, 'a'); await append.write(cipher.getAuthTag()); await append.sync(); await append.close();
    // Refuse overwrite, including a raced existing destination.
    const destination = await open(output, 'wx', 0o600); await destination.close();
    await rename(partial, output);
    return manifest;
  } catch (error) { await assertRecoveryPath(partial, { allowMissing: true, type: 'file' }); await rm(partial, { force: true }); throw error; }
}
export async function decryptBundle({ input, key, destination }) {
  if (key.length !== 32) throw new Error('Recovery key must contain exactly 32 random bytes.');
  input = await assertRecoveryPath(input, { type: 'file' });
  destination = await assertRecoveryPath(destination, { allowMissing: true, type: 'directory' });
  await mkdir(destination, { recursive: false, mode: 0o700 });
  const identity = await lstat(destination);
  const authenticated = join(destination, '.authenticated.gz');
  try {
    const length = (await stat(input)).size;
    if (length < 36) throw new Error('Truncated recovery bundle.');
    const file = await open(input, 'r'), header = Buffer.alloc(20), tag = Buffer.alloc(16);
    await file.read(header, 0, 20, 0); await file.read(tag, 0, 16, length - 16); await file.close();
    if (!header.subarray(0, 8).equals(MAGIC)) throw new Error('Unsupported recovery bundle format.');
    const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8)); decipher.setAuthTag(tag);
    // No files are extracted or restored until AES-GCM authenticates the entire archive.
    await pipeline(createReadStream(input, { start: 20, end: length - 17 }), decipher, createWriteStream(authenticated, { flags: 'wx', mode: 0o600 }));
    const stream = createReadStream(authenticated).pipe(createGunzip());
    const iterator = stream[Symbol.asyncIterator](); let pending = Buffer.alloc(0);
    async function take(length) {
      const chunks = []; let remaining = length;
      while (remaining) {
        if (!pending.length) { const next = await iterator.next(); if (next.done) throw new Error('Truncated recovery contents.'); pending = next.value; }
        const part = pending.subarray(0, Math.min(remaining, pending.length)); chunks.push(part); pending = pending.subarray(part.length); remaining -= part.length;
      }
      return Buffer.concat(chunks);
    }
    const size = (await take(4)).readUInt32BE(); if (size > MAX_MANIFEST) throw new Error('Invalid recovery manifest size.');
    const manifest = JSON.parse((await take(size)).toString('utf8'));
    if (manifest.version !== 1 || !Array.isArray(manifest.entries)) throw new Error('Invalid recovery manifest.');
    const names = new Set();
    for (const entry of manifest.entries) {
      if (!safeName(entry.name) || names.has(entry.name) || !Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid recovery entry.');
      names.add(entry.name);
    }
    await assertRecoveryPaths(manifest.entries.map(entry => resolve(destination, entry.name)), { root: destination, allowMissing: true, type: 'file' });
    for (const entry of manifest.entries) {
      const output = resolve(destination, entry.name); await mkdir(dirname(output), { recursive: true, mode: 0o700 });
      const target = await open(output, 'wx', 0o600), hash = createHash('sha256');
      try {
        for (let remaining = entry.size; remaining > 0;) { const chunk = await take(Math.min(remaining, 64 * 1024)); hash.update(chunk); await target.write(chunk); remaining -= chunk.length; }
        await target.sync();
      } finally { await target.close(); }
      if (hash.digest('hex') !== entry.sha256) throw new Error('Recovery entry failed its integrity check.');
    }
    if (pending.length || !(await iterator.next()).done) throw new Error('Unexpected trailing recovery contents.');
    await rm(authenticated);
    return manifest;
  } catch (error) {
    try { await removeRecoveryDirectory(destination, { root: dirname(destination), identity }); }
    catch (cleanupError) { throw new Error(`Recovery validation failed: ${error.message}; unsafe cleanup refused: ${cleanupError.message}`); }
    throw new Error(`Recovery validation failed: ${error.message}`);
  }
}
