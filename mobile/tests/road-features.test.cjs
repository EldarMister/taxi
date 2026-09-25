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

test('queries only a bounded route section ahead, including an exact final point', () => {
  const prepared = { route: { geometry: [{ latitude: 42.87, longitude: 74.59 }, { latitude: 42.88, longitude: 74.59 }] },
    cumulative: [0, 1112], total: 1112 };
  const window = roadFeatureWindow(prepared, 300);
  assert.equal(window.startAlong, 160);
  assert.equal(window.endAlong, 1112);
  assert.ok(window.points.length >= 2 && window.points.length <= 80);
  assert.equal(window.points.at(-1).latitude, 42.88);
});

test('shows several approaching warnings and retires each 140 metres after passing', () => {
  const signs = [
    { id: 'a', kind: 'stop', along: 600 }, { id: 'b', kind: 'traffic_light', along: 650 },
    { id: 'c', kind: 'speed_camera', along: 700 }, { id: 'd', kind: 'stop', along: 610 },
    { id: 'e', kind: 'give_way', along: 950 },
  ];
  assert.deepEqual(visibleRoadFeatures(signs, 250).map(sign => sign.id), ['a', 'b']);
  assert.deepEqual(visibleRoadFeatures(signs, 640).map(sign => sign.id), ['b', 'd', 'c']);
  assert.ok(visibleRoadFeatures(signs, 801).every(sign => sign.id !== 'b'));
  assert.equal(visibleRoadFeatures([...signs, { id: 'f', kind: 'stop', along: 880 }], 640).filter(sign => sign.kind === 'stop').length, 1);
  assert.equal(roadFeatureDistanceLabel(signs[0], 250), '350 м');
  assert.equal(roadFeatureDistanceLabel(signs[0], 360), '240 м');
  assert.equal(roadFeatureDistanceLabel(signs[0], 620), 'позади');
  assert.match(roadFeatureAnnouncement([signs[0], signs[1]], 250, 'ru'), /триста пятьдесят метров знак Стоп.*четыреста метров светофор/);
});
