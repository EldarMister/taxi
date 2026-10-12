const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { patchSource } = require('../scripts/patch-metro-image-size.cjs');
const assetsFile = path.join(path.dirname(require.resolve('metro/package.json')), 'src', 'Assets.js');
const { getAssetData } = require(assetsFile);

test('Metro compatibility patch is idempotent and refuses unreviewed versions/source', () => {
  const source = fs.readFileSync(assetsFile, 'utf8');
  assert.equal(patchSource(source, '0.83.3'), source);
  assert.throws(() => patchSource(source, '0.83.4'), /Unknown Metro version/);
  assert.throws(() => patchSource(source + '\n// changed', '0.83.3'), /Unknown Metro asset source/);
});
test('actual Metro computes packaged PNG dimensions with the secure byte-only parser', async () => {
  const file = path.resolve(__dirname, '../assets/home/truck-white.png');
  const asset = await getAssetData(file, 'assets/home/truck-white.png', [], 'android', '/assets');
  assert.equal(asset.width, 1247); assert.equal(asset.height, 1261); assert.equal(asset.type, 'png');
});
