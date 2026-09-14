const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/address.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsFromModule = {};
vm.runInNewContext(compiled, { exports: exportsFromModule });
const { shortAddress } = exportsFromModule;

test('removes Kyrgyzstan, region and district prefixes while keeping the useful address', () => {
  assert.equal(
    shortAddress('Кыргызстан, Чуйская область, Аламудунский район, село Лебединовка, улица Ленина, 25'),
    'село Лебединовка, улица Ленина, 25',
  );
  assert.equal(
    shortAddress('Кыргызская Республика, Ошская обл., Кара-Суйский р-н, город Ош, ул. Курманжан Датки, 18'),
    'город Ош, ул. Курманжан Датки, 18',
  );
  assert.equal(
    shortAddress('Кыргыз Республикасы, Чуйская область, Аламүдүн району, Лебединовка, Манас көчөсү, 7'),
    'Лебединовка, Манас көчөсү, 7',
  );
});

test('keeps the established compact Bishkek presentation', () => {
  assert.equal(shortAddress('Кыргызстан, Бишкек, Первомайский район, улица Киевская, 77'), 'улица Киевская, 77');
  assert.equal(shortAddress('Кыргызстан, город республиканского значения Бишкек, Ленинский район, проспект Чингиза Айтматова, 12'), 'проспект Чингиза Айтматова, 12');
});

test('does not mistake a microdistrict, coordinates or an ordinary address for administrative data', () => {
  assert.equal(shortAddress('Кыргызстан, Бишкек, 8-й микрорайон, дом 12'), '8-й микрорайон, дом 12');
  assert.equal(shortAddress('GPS: 42.87000, 74.59000'), 'GPS: 42.87000, 74.59000');
  assert.equal(shortAddress('Площадь Ала-Тоо, Бишкек'), 'Площадь Ала-Тоо, Бишкек');
  assert.equal(shortAddress('  улица   Токтогула,   125  '), 'улица Токтогула, 125');
});

test('keeps a useful fallback for empty and administrative-only values', () => {
  assert.equal(shortAddress(undefined), '');
  assert.equal(shortAddress('   '), '');
  assert.equal(shortAddress('Кыргызстан, Чуйская область'), 'Кыргызстан, Чуйская область');
});

test('keeps a named-place heading compact', () => {
  assert.equal(shortAddress('Asia Mall · торговый центр, Кыргызстан, Бишкек, проспект Чингиза Айтматова, 3'), 'Asia Mall · торговый центр');
});
