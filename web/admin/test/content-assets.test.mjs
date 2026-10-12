import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { contentAssets, resolveContentAsset } from '../dist/content-assets.js';
import { syncAdminContent, validateStagedContent } from '../../scripts/sync-admin-content.mjs';

const webRoot = resolve(import.meta.dirname, '../..');
const adminRoot = resolve(webRoot, 'admin/dist');

test('admin image snapshot matches the current mobile photographs and bundled banner', async () => {
  const result = await syncAdminContent({ webRoot, check: true });
  assert.equal(result.staged, false);
  assert.match(contentAssets['sushi-roll'].src, /\/real\/sushi-roll\.jpg$/);
  assert.match(contentAssets['philadelphia'].src, /\/real\/philadelphia\.jpg$/);
  const promo=contentAssets['nearby-promo']??contentAssets['home-promo'];
  assert.ok(promo,'the reconciled main client retains its existing bundled promotion');
  assert.match(promo.src, /\/legacy\//);
  assert.deepEqual(contentAssets['chicken-wrap'].crop, [0, 550, 1400, 1500]);
  assert.equal(contentAssets['shrimp-nigiri'].fit, 'contain');
});

test('admin aliases and fallback selection follow the mobile image priority', () => {
  assert.deepEqual(resolveContentAsset('ali-combo'), contentAssets['burger-combo']);
  assert.deepEqual(resolveContentAsset('restaurant-sushi'), contentAssets['sushi-roll']);
  assert.equal(resolveContentAsset('unknown', 'philadelphia'), contentAssets['philadelphia']);
  assert.equal(resolveContentAsset('soy', 'philadelphia'), contentAssets['philadelphia'], 'fallback photography precedes legacy images in mobile');
  assert.equal(resolveContentAsset('soy'), contentAssets['soy']);
  assert.equal(resolveContentAsset('removed-image'), undefined);
});

test('standalone website builds verify their staged images without a mobile checkout', async t => {
  const stagedRoot = await mkdtemp(resolve(tmpdir(), 'atlas-admin-content-'));
  t.after(() => {
    assert.equal(dirname(stagedRoot), resolve(tmpdir()));
    assert.match(basename(stagedRoot), /^atlas-admin-content-/);
    return rm(stagedRoot, { recursive: true, force: true });
  });
  const stagedAdmin = resolve(stagedRoot, 'admin/dist');
  await mkdir(stagedAdmin, { recursive: true });
  await copyFile(resolve(adminRoot, 'content-assets.js'), resolve(stagedAdmin, 'content-assets.js'));
  for (const src of new Set(Object.values(contentAssets).map(asset => asset.src))) {
    const destination = resolve(stagedAdmin, src);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(adminRoot, src), destination);
  }
  const result = await syncAdminContent({ webRoot: stagedRoot });
  assert.equal(result.staged, true);
  assert.equal(result.keys, Object.keys(contentAssets).length);
  await writeFile(resolve(stagedAdmin, (contentAssets['nearby-promo']??contentAssets['home-promo']).src), 'broken image');
  await assert.rejects(validateStagedContent(stagedAdmin), /missing or changed/);
});
