// Expo SDK 54 / Metro 0.83.3 calls image-size with a filename. image-size 2
// requires bytes. This reproducible build-only patch retains the secure parser.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const METRO_VERSION = '0.83.3', PARSER_VERSION = '2.0.4';
const ORIGINAL_HASH = 'bb3f83881e8f3d765c8b9c1bf1de0e4f6ae5143e7eebf6f58a1df52fa6e793ec';
const PATCHED_HASH = 'a9d1e032315fcc92ae86c76973bc2674d75d08aaf0af281aa169385b8630c63b';
const BEFORE = '  const isImageInput = assetInfo.files[0].includes(".zip/")\n    ? _fs.default.readFileSync(assetInfo.files[0])\n    : assetInfo.files[0];\n  const dimensions = isImage ? (0, _imageSize.default)(isImageInput) : null;';
const AFTER = '  // image-size 2 accepts bytes, not paths; keep non-image assets unread here.\n  const dimensions = isImage\n    ? (0, _imageSize.default)(_fs.default.readFileSync(assetInfo.files[0]))\n    : null;';
const hash = value => createHash('sha256').update(value).digest('hex');
function patchSource(source, version) {
  if (version !== METRO_VERSION) throw new Error('Unknown Metro version. Review image-size compatibility before installing.');
  const normalized = source.replace(/\r\n/g, '\n'), digest = hash(normalized);
  if (digest === PATCHED_HASH) return source;
  if (digest !== ORIGINAL_HASH || normalized.split(BEFORE).length !== 2) throw new Error('Unknown Metro asset source. Refusing an unreviewed patch.');
  const patched = normalized.replace(BEFORE, AFTER);
  if (hash(patched) !== PATCHED_HASH) throw new Error('Metro patch verification failed.');
  return patched;
}
function packageMetadata(entry, name) {
  let directory = path.dirname(entry);
  while (directory !== path.dirname(directory)) {
    const candidate = path.join(directory, 'package.json');
    if (fs.existsSync(candidate)) {
      const metadata = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (metadata.name === name) return { directory, metadata };
    }
    directory = path.dirname(directory);
  }
  throw new Error('Cannot locate package metadata for ' + name);
}
function patchInstalledMetro() {
  const project = path.resolve(__dirname, '..'), modules = path.join(project, 'node_modules');
  const compare = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (compare(fs.realpathSync(modules)) !== compare(modules)) throw new Error('Refusing to modify shared/symlinked dependencies. Install local node_modules first.');
  const metroFile = require.resolve('metro/package.json', { paths: [project] });
  const metroRoot = path.dirname(metroFile), assetFile = path.join(metroRoot, 'src', 'Assets.js');
  if (!compare(fs.realpathSync(assetFile)).startsWith(compare(modules + path.sep))) throw new Error('Metro resolved outside this application.');
  const parser = packageMetadata(require.resolve('image-size', { paths: [metroRoot] }), 'image-size');
  if (parser.metadata.version !== PARSER_VERSION) throw new Error('The reviewed secure image-size 2.0.4 override is required.');
  const source = fs.readFileSync(assetFile, 'utf8');
  const patched = patchSource(source, JSON.parse(fs.readFileSync(metroFile, 'utf8')).version);
  if (patched !== source) fs.writeFileSync(assetFile, patched, 'utf8');
  console.log('Metro 0.83.3 / image-size 2.0.4 compatibility verified.');
}
module.exports = { patchSource, patchInstalledMetro };
if (require.main === module) patchInstalledMetro();
