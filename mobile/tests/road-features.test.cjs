const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/roadFeatures.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: exportsObject });
const { roadFeatureWindow, visibleRoadFeatures, roadFeatureAnnouncement, roadFeatureDistanceLabel } = exportsObject;

test('uses actual speed values in speech and clears a section limit without resurrecting an older sign', () => {
  const signs = [{ id: 'a', kind: 'speed_limit_60', along: 0 },
    { id: 'b', kind: 'speed_limit', along: 100, endAlong: 300, speedLimit: 40 }];
  assert.equal(exportsObject.currentRoadSpeedLimit(signs, 150), 40);
  assert.equal(exportsObject.currentRoadSpeedLimit(signs, 300), null);
  assert.match(roadFeatureAnnouncement([signs[1]], 0, 'ru'), /ограничение скорости сорок/);
  assert.match(roadFeatureAnnouncement([{ kind: 'speed_camera', along: 500 }], 0, 'ru'), /Через пятьсот метров/);
  assert.match(roadFeatureAnnouncement([{ kind: 'speed_limit', speedLimit: 15, along: 50 }], 0, 'ru'), /пятнадцать/);
  assert.equal(exportsObject.currentRoadSpeedLimit([{ id: 'point', kind: 'speed_limit', speedLimit: 30, along: 0 }], 500), null);
  const pointInside = [...signs, { id: 'point', kind: 'speed_limit', speedLimit: 30, along: 200 }];
  assert.equal(exportsObject.currentRoadSpeedLimit(pointInside, 250), 40, 'a point sign cannot replace the mapped current section');
  assert.equal(exportsObject.currentRoadSpeedLimit(pointInside, 350), null, 'a point sign inside a section cannot outlive its road boundary');
});

test('feature refresh preserves speed section identity and treats unknown refreshed road as authoritative', () => {
  const previous = [{ id: 'way/10:speed_limit:100', kind: 'speed_limit', speedLimit: 40, along: 100, endAlong: 1200 }];
  const continued = exportsObject.mergeRoadFeatureWindow(previous,
    [{ id: 'way/10:speed_limit:685', kind: 'speed_limit', speedLimit: 40, along: 685, endAlong: 1885 }],
    { startAlong: 685, endAlong: 1885 });
  assert.equal(continued.length, 1);
  assert.equal(continued[0].id, previous[0].id, 'same section keeps its announcement deduplication ID');
  assert.equal(continued[0].along, 100);
  assert.equal(exportsObject.currentRoadSpeedLimit(continued, 1300), 40);
  const unknown = exportsObject.mergeRoadFeatureWindow(previous, [], { startAlong: 685, endAlong: 1885 });
  assert.equal(exportsObject.currentRoadSpeedLimit(unknown, 700), null, 'a preceding section does not bleed into the refreshed unknown road');
  const future = [{ ...previous[0], along: 900 }];
  const shifted = exportsObject.mergeRoadFeatureWindow(future,
    [{ ...future[0], id: 'way/10:speed_limit:904', along: 904, endAlong: 1885 }], { startAlong: 685, endAlong: 1885 });
  assert.equal(shifted[0].id, future[0].id, 'resampling does not repeat an already announced future speed change');
  const resumed = exportsObject.mergeRoadFeatureWindow(previous,
    [{ id: 'resumed', kind: 'speed_limit', speedLimit: 40, along: 900, endAlong: 1885 }], { startAlong: 685, endAlong: 1885 });
  assert.equal(exportsObject.currentRoadSpeedLimit(resumed, 800), null, 'an unknown gap is not joined to the same later speed value');
  assert.equal(exportsObject.currentRoadSpeedLimit(resumed, 950), 40);
});

test('queries only a bounded route section ahead, including an exact final point', () => {
  const prepared = { route: { geometry: [{ latitude: 42.87, longitude: 74.59 }, { latitude: 42.88, longitude: 74.59 }] },
    cumulative: [0, 1112], total: 1112 };
  const window = roadFeatureWindow(prepared, 300);
  assert.equal(window.startAlong, 285);
  assert.equal(window.endAlong, 1112);
  assert.ok(window.points.length >= 2 && window.points.length <= 80);
  assert.equal(window.points.at(-1).latitude, 42.88);
});

test('road feature windows preserve the actual corner instead of a diagonal across the junction', () => {
  const geometry = [{ latitude: 42.87, longitude: 74.59 }, { latitude: 42.8701, longitude: 74.59 }, { latitude: 42.8701, longitude: 74.5902 }];
  const window = roadFeatureWindow({ route: { geometry }, cumulative: [0, 11.12, 27.4], total: 27.4 }, 0);
  assert.equal(window.points.length, 3);
  assert.equal(window.points[1].latitude, geometry[1].latitude);
  assert.equal(window.points[1].longitude, geometry[1].longitude);
  const dense = Array.from({ length: 200 }, (_, index) => ({ latitude: 42.87 + index * .00001, longitude: 74.59 + (index % 2) * .00003 }));
  const bounded = roadFeatureWindow({ route: { geometry: dense }, cumulative: dense.map((_, index) => index * 3), total: 597 }, 0);
  assert.equal(bounded.points.length, 80);
  assert.ok(bounded.endAlong < 597, 'a dense route stops at its last supplied point');
});

test('shows several approaching warnings and retires each 10 metres after passing', () => {
  const signs = [
    { id: 'a', kind: 'stop', along: 600 }, { id: 'b', kind: 'traffic_light', along: 650 },
    { id: 'c', kind: 'speed_camera', along: 700 }, { id: 'd', kind: 'stop', along: 610 },
    { id: 'e', kind: 'give_way', along: 950 },
  ];
  assert.deepEqual(visibleRoadFeatures(signs, 250).map(sign => sign.id), ['c'], 'camera is announced with enough time to slow down');
  assert.deepEqual(visibleRoadFeatures(signs, 600).map(sign => sign.id), ['a', 'b', 'c']);
  assert.ok(visibleRoadFeatures([signs[0]], 610).some(sign => sign.id === 'a'));
  assert.ok(visibleRoadFeatures([signs[0]], 611).every(sign => sign.id !== 'a'));
  assert.ok(visibleRoadFeatures(signs, 801).every(sign => sign.id !== 'b'));
  assert.equal(visibleRoadFeatures([...signs, { id: 'f', kind: 'stop', along: 680 }], 640).filter(sign => sign.kind === 'stop').length, 1);
  assert.equal(roadFeatureDistanceLabel(signs[0], 250), '350 м');
  assert.equal(roadFeatureDistanceLabel(signs[0], 360), '240 м');
  assert.equal(roadFeatureDistanceLabel(signs[0], 620), 'позади');
  assert.match(roadFeatureAnnouncement([signs[0], signs[1]], 250, 'ru'), /триста пятьдесят метров знак Стоп.*четыреста метров светофор/);
});

test('announces signs at the same rounded distance in one phrase', () => {
  const signs = [
    { id: 'crossing', kind: 'pedestrian_crossing', along: 160 },
    { id: 'light', kind: 'traffic_light', along: 163 },
    { id: 'camera', kind: 'speed_camera', along: 210 },
  ];
  assert.equal(roadFeatureAnnouncement(signs, 0, 'ru'),
    'Через сто шестьдесят метров пешеходный переход и светофор. Через двести десять метров камера контроля скорости.');
  assert.equal(roadFeatureAnnouncement(signs.slice(0, 2), 0, 'ky'),
    '160 метрден кийин жөө жүргүнчүлөр өтмөгү жана светофор.');
});
