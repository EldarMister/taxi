const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const output = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/native/mapRoadFeatures.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: output });
const { crossingMarkings, validMapRoadFeature, alignCrossingsToRoads, sameRenderedRoadGeometry } = output;
const crossing = { id: 'ordinary', kind: 'pedestrian_crossing', latitude: 41.196, longitude: 72.179, bearing: 0, roadClass: 'secondary' };
const road = (coordinates, kind = 'secondary') => ({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { kind } });

test('identical rendered roads do not trigger another crossing geometry update', () => {
  const first = { type: 'FeatureCollection', features: [road([[72.17903, 41.195], [72.17903, 41.197]])] };
  const same = { type: 'FeatureCollection', features: [road([[72.17903, 41.195], [72.17903, 41.197]])] };
  const moved = { type: 'FeatureCollection', features: [road([[72.17904, 41.195], [72.17904, 41.197]])] };
  assert.equal(sameRenderedRoadGeometry(first, same), true);
  assert.equal(sameRenderedRoadGeometry(first, moved), false);
});

test('aligns an offset and skewed crossing with the visible road, without selecting the perpendicular junction road', () => {
  const feature = { ...crossing, bearing: 12 };
  const roads = { type: 'FeatureCollection', features: [
    road([[72.17903, 41.195], [72.17903, 41.197]]),
    road([[72.178, 41.196], [72.18, 41.196]]),
  ] };
  const fitted = alignCrossingsToRoads([feature], roads)[0];
  assert.equal(fitted.longitude, 72.17903);
  assert.ok(Math.abs(fitted.latitude - feature.latitude) < 1e-10);
  assert.equal(fitted.bearing, 0);
  assert.equal(feature.longitude, crossing.longitude, 'the API feature remains unchanged');
  const ring = crossingMarkings([fitted], 19).features[0].geometry.coordinates[0];
  assert.ok(Math.abs((ring[0][0] + ring[1][0]) / 2 - 72.17903) < 1e-10);
});

test('uses the local tangent of a bent road and preserves marks when no reliable visible match exists', () => {
  const roads = { type: 'FeatureCollection', features: [road([[72.178, 41.195], [72.179, 41.196], [72.179, 41.197]])] };
  const bend = { ...crossing, latitude: 41.1965, longitude: 72.17902, bearing: 8 };
  assert.equal(alignCrossingsToRoads([bend], roads)[0].bearing, 0);
  const distant = { ...crossing, longitude: 72.18 };
  assert.equal(alignCrossingsToRoads([distant], roads)[0], distant);
  const camera = { ...crossing, kind: 'speed_camera' };
  assert.equal(alignCrossingsToRoads([camera], roads)[0], camera);
  assert.equal(alignCrossingsToRoads([bend], { type: 'FeatureCollection', features: [] })[0], bend);
});
const dimensions = shape => {
  const points = shape.features.find(feature => feature.properties.role === 'surface').geometry.coordinates[0];
  const x = points.map(point => point[0]), y = points.map(point => point[1]);
  return { width: (Math.max(...x) - Math.min(...x)) * Math.cos(crossing.latitude * Math.PI / 180), height: Math.max(...y) - Math.min(...y) };
};
test('zebra spans across the road and its individual bars run along traffic, in both orientations', () => {
  for (const bearing of [0, 90, 180, 270, 360]) {
    const shape = crossingMarkings([{ ...crossing, bearing }], 18);
    assert.ok(shape.features.filter(feature => feature.properties.role === 'stripe').length >= 4);
    const { width, height } = dimensions(shape);
    assert.ok(bearing % 180 === 0 ? width > height * 2 : height > width * 2);
    for (const feature of shape.features) {
      const ring = feature.geometry.coordinates[0];
      assert.deepEqual(Array.from(ring[0]), Array.from(ring.at(-1)));
      assert.ok(ring.flat().every(Number.isFinite));
    }
  }
});
test('crossings stay fitted to cartographic road widths on zoom, while unknown bearings are never fabricated', () => {
  const at16 = dimensions(crossingMarkings([crossing], 16));
  const at19 = dimensions(crossingMarkings([crossing], 19));
  assert.ok(at19.width * 8 > at16.width, 'visible size increases with the road');
  assert.ok(at19.width < at16.width / 2, 'geographic width shrinks while close-zoom stripes remain readable');
  assert.equal(crossingMarkings([{ ...crossing, bearing: undefined }], 18).features.length, 0);
  assert.equal(crossingMarkings([{ ...crossing, latitude: NaN }], 18).features.length, 0);
});
test('map accepts only crossings and traffic lights, even if an older API sends signs', () => {
  assert.equal(validMapRoadFeature(crossing), true);
  assert.equal(validMapRoadFeature({ ...crossing, kind: 'traffic_light' }), true);
  assert.equal(validMapRoadFeature({ ...crossing, kind: 'speed_camera' }), false);
  assert.equal(validMapRoadFeature({ ...crossing, kind: 'speed_limit', speedLimit: 40 }), false);
  assert.equal(validMapRoadFeature({ ...crossing, kind: 'speed_limit', speedLimit: NaN }), false);
  assert.equal(validMapRoadFeature({ ...crossing, kind: 'speed_limit', speedLimit: 0 }), false);
});
