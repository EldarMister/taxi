const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const load = (file, dependency) => {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:dependency});
  return exports;
};

test('search and reverse retain provider categories while booking payloads strip display metadata', async () => {
  const point = {id:'osm-way-1',latitude:42.87,longitude:74.6,address:'Глобус · улица Киевская, 1, Бишкек',category:'supermarket'};
  const map = load('native/mapkit.ts', id => {
    assert.equal(id,'../api');
    return {ApiError:class extends Error {},api:{request:async url => url.includes('/search?') ? [point] : point}};
  });
  const found = (await map.searchAddresses('Глобус'))[0];
  assert.equal(found.category,'supermarket');
  assert.equal((await map.reverseGeocode(point)).category,'supermarket');
  const {normalizePoint} = load('types.ts');
  assert.deepEqual(JSON.parse(JSON.stringify(normalizePoint(found))),{latitude:point.latitude,longitude:point.longitude,address:point.address});
  assert.equal(normalizePoint(found).category,undefined);
  assert.equal(normalizePoint(found).id,undefined);
});

test('legacy place responses without category remain valid search results', async () => {
  const point = {latitude:42.87,longitude:74.6,address:'улица Киевская, 1, Бишкек'};
  const map = load('native/mapkit.ts', () => ({ApiError:class extends Error {},api:{request:async () => [point]}}));
  const result = (await map.searchAddresses('Киевская'))[0];
  assert.equal(result.address,point.address);
  assert.equal(result.category,undefined);
});
