const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const { test } = require('node:test'), assert = require('node:assert/strict');
const moduleObject = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/registration/workCities.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleObject.exports });
const { workCities, workCityOptions, withWorkCity } = moduleObject.exports;
test('only Shamaldy-Say is selectable; Kochkor-Ata and Kerben are coming soon', () => {
  assert.equal(Array.from(workCities).join('|'), 'Шамалды-Сай');
  const pending = workCityOptions.find(x => x.value === 'Кербен');
  assert.equal(pending.disabled, true); assert.equal(pending.caption, 'Скоро');
});
test('choosing a working city updates obsolete hidden draft cities without resetting other data', () => {
  const data = { personal: { firstName: 'Асан', city: 'Бишкек' }, work: { city: 'Бишкек', districts: ['Ленинский'], notifications: true }, courier: { city: 'Ош', districts: ['Анар'], hasThermalBag: true }, location: { choice: 'MANUAL', city: 'Бишкек', latitude: 42 }, taxiVehicle: { brand: 'Toyota', model: 'Camry' } };
  const selected = withWorkCity(data, 'Шамалды-Сай');
  for (const section of ['personal', 'work', 'courier', 'location']) assert.equal(selected[section].city, 'Шамалды-Сай');
  assert.equal(selected.work.districts.length, 0); assert.equal(selected.courier.districts.length, 0);
  assert.equal(selected.personal.firstName, 'Асан'); assert.equal(selected.work.notifications, true);
  assert.equal(selected.location.latitude, 42); assert.equal(selected.taxiVehicle, data.taxiVehicle);
  assert.equal(data.work.city, 'Бишкек', 'saved draft is not mutated before selection is committed');
  assert.equal(withWorkCity(data, 'Кербен'), data, 'coming-soon city cannot change the draft');
});
