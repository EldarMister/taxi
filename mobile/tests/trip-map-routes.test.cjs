const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/tripMapRoutes.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exported = {};
vm.runInNewContext(js, { exports: exported });
const { tripMapRoutes } = exported;

const driverStart = { latitude: 41.198, longitude: 72.18 };
const pickup = { latitude: 41.2, longitude: 72.185 };
const dropoff = { latitude: 41.24, longitude: 72.22 };
const approach = { geometry: [driverStart, pickup] };
const drive = { geometry: [pickup, dropoff] };
const order = status => ({ status, pickup, dropoff, geometry: drive.geometry, routeProvider: 'osrm' });

test('accepted order shows the approach and the complete fare route to both roles', () => {
  const forDriver = tripMapRoutes({ driver: true, order: order('ASSIGNED'), navigationRoute: approach });
  assert.equal(forDriver.approachGeometry, approach.geometry);
  assert.equal(forDriver.geometry, drive.geometry);
  assert.equal(forDriver.routeOverview, true);
  const forClient = tripMapRoutes({ driver: false, order: order('ASSIGNED'), approachRoute: approach });
  assert.equal(forClient.approachGeometry, approach.geometry);
  assert.equal(forClient.geometry, drive.geometry);
  assert.equal(forClient.routeOverview, true);
});

test('active trip uses blue navigation; completed trip returns the full booked road for both roles', () => {
  const current = { geometry: [driverStart, dropoff] };
  const active = tripMapRoutes({ driver: true, order: order('IN_PROGRESS'), navigationRoute: current });
  assert.equal(active.geometry, current.geometry);
  assert.equal(active.approachGeometry, undefined);
  assert.equal(active.routeOverview, false);
  for (const driver of [true, false]) {
    const completed = tripMapRoutes({ driver, order: order('COMPLETED'), navigationRoute: current, approachRoute: approach });
    assert.equal(completed.geometry, drive.geometry);
    assert.equal(completed.approachGeometry, undefined);
    assert.equal(completed.routeOverview, true);
  }
});

test('unverified straight-line data cannot masquerade as the booked blue road', () => {
  const preview = tripMapRoutes({ driver: false, order: null, quote: { routeProvider: 'development', geometry: drive.geometry } });
  assert.equal(preview.geometry, undefined);
  const assigned = tripMapRoutes({ driver: true, order: { ...order('ASSIGNED'), routeProvider: 'development' }, navigationRoute: approach });
  assert.equal(assigned.geometry, undefined);
  assert.equal(assigned.approachGeometry, approach.geometry);
});
