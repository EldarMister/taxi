const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('application requests foreground location only', () => {
  const config = read('app.config.ts');
  assert.match(config, /ACCESS_FINE_LOCATION/);
  assert.match(config, /blockedPermissions:[\s\S]*ACCESS_BACKGROUND_LOCATION/);
  assert.match(config, /blockedPermissions:[\s\S]*FOREGROUND_SERVICE_LOCATION/);
  assert.match(config, /isIosBackgroundLocationEnabled: false/);
  assert.match(config, /isAndroidBackgroundLocationEnabled: false/);
  assert.match(config, /isAndroidForegroundServiceEnabled: false/);
});

test('driver tracking and realtime vehicle markers stay disabled', () => {
  const app = read('App.tsx');
  const entry = read('index.ts');
  const map = read('src/native/TaxiMap.tsx');
  assert.doesNotMatch(app, /startDriverTracking|stopDriverTracking|socket\.on\('driver:location'/);
  assert.doesNotMatch(entry, /backgroundLocation/);
  assert.doesNotMatch(map, /<Marker[^>]+driverLocation|Местоположение водителя обновляется/);
  assert.equal(fs.existsSync(path.join(root, 'src/native/backgroundLocation.ts')), false);
});

test('MapKit remains limited to address selection and route A to B', () => {
  const app = read('App.tsx');
  const map = read('src/native/TaxiMap.tsx');
  assert.match(map, /findDrivingRoutes\(\[toNative\(pickup\), toNative\(dropoff\)\]/);
  assert.match(map, /<Polyline points=\{route\.map\(toNative\)\}/);
  assert.match(map, /onMapPress=/);
  assert.match(app, /routeProvider \|\| quote\?\.routeProvider\) === "yandex"/);
});
