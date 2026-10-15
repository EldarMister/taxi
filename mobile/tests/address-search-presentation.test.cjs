const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

function load(file) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file + '.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: id => load(id.replace('./', '')) });
  return exports;
}
const { addressResultDistance, addressDistanceOrigin, addressMatches, addressResultIcon } = load('addressSearchPresentation');
const point = (latitude, longitude = 74.57) => ({ latitude, longitude });

test('search distances handle zero, metres, kilometres, unknown and invalid coordinates', () => {
  assert.equal(addressResultDistance(point(42.87), point(42.87), 'ru'), '0 м');
  assert.equal(addressResultDistance(point(42.87), point(42.875), 'ru'), '556 м');
  assert.equal(addressResultDistance(point(42.87), point(42.88), 'en'), '1.1 km');
  assert.equal(addressResultDistance(point(42.87), point(42.88), 'ky'), '1,1 км');
  assert.equal(addressResultDistance(undefined, point(42.87), 'ru'), undefined);
  assert.equal(addressResultDistance(point(NaN), point(42.87), 'ru'), undefined);
  assert.equal(addressResultDistance(point(42.87), point(91), 'ru'), undefined);
});

test('only pickup uses GPS, destinations use pickup, and saved places use GPS', () => {
  const gps = point(42.87), pickup = point(42.89);
  assert.equal(addressDistanceOrigin('pickup', gps, pickup), gps);
  assert.equal(addressDistanceOrigin('dropoff', gps, pickup), pickup);
  assert.equal(addressDistanceOrigin('dropoff', gps, pickup, true), gps);
  assert.equal(addressDistanceOrigin('pickup', null, pickup), null);
  assert.equal(addressDistanceOrigin('dropoff', gps, undefined), undefined);
});

test('highlighting preserves text, punctuation, repeated matches and Cyrillic spelling', () => {
  const parts = addressMatches('улица Ленина, 39А, Ленина', 'ленина 39');
  assert.equal(parts.map(part => part.text).join(''), 'улица Ленина, 39А, Ленина');
  assert.deepEqual(Array.from(parts.filter(part => part.matched), part => part.text), ['Ленина', '39', 'Ленина']);
  assert.equal(addressMatches('Орёл', 'орел')[0].matched, true);
  assert.equal(addressMatches('Rixon Hotel', 'rixon')[0].text, 'Rixon');
  assert.equal(addressMatches('улица Киевская', 'ленина').some(part => part.matched), false);
  assert.equal(addressMatches('улица Киевская', '').some(part => part.matched), false);
});

test('all supported categories have icons while ordinary streets keep their pin', () => {
  for (const category of ['building', 'supermarket', 'shop', 'office', 'school', 'kindergarten', 'hospital', 'stadium', 'home', 'pharmacy', 'hotel', 'restaurant', 'cafe', 'bank', 'park', 'transport']) {
    assert.notEqual(addressResultIcon({ address: 'Место', category }), 'location', category);
  }
  assert.equal(addressResultIcon({ address: 'Глобус · улица Ленина, 12' }), 'supermarket');
  assert.equal(addressResultIcon({ address: 'Детский сад №15' }), 'kindergarten');
  assert.equal(addressResultIcon({ address: 'улица Фрунзе, 12' }), 'location');
  assert.equal(addressResultIcon({ address: 'Фрунзе, 12' }), 'location');
  assert.equal(addressResultIcon({ address: 'улица Школьная, 4' }), 'location');
  assert.equal(addressResultIcon({ address: 'Неизвестный адрес', category: 'unknown' }), 'location');
});
