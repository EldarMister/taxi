const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');

const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/native', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const animation = {};
vm.runInNewContext(compile('carRouteAnimation.ts'), { exports: animation });
const matching = {};
vm.runInNewContext(compile('roadMatch.ts'), { exports: matching, require: id => {
  if (id === './carRouteAnimation') return animation;
  throw Error(id);
} });

const road = [
  { latitude: 42, longitude: 74 },
  { latitude: 42.001, longitude: 74 },
  { latitude: 42.001, longitude: 74.001 },
];

test('tracking window preserves corners and bounds packet size without simplifying roads', () => {
  const window = matching.trackingRoadWindow(road, 120);
  assert.ok(window.some(p => p.latitude === road[1].latitude && p.longitude === road[1].longitude));
  assert.ok(window.length <= 128);
  const dense = Array.from({ length: 600 }, (_, i) => ({ latitude: 42 + i / 111320, longitude: 74 }));
  assert.equal(matching.trackingRoadWindow(dense, 400), undefined, 'too many vertices disable animation rather than cutting corners');
  const long = [{ latitude: 42, longitude: 74 }, { latitude: 42.02, longitude: 74 }];
  const bounded = matching.trackingRoadWindow(long, 1000);
  assert.ok(Math.abs(animation.carMetresBetween(bounded[0], bounded.at(-1)) - 480) < .01);
});

test('accurate car fix beside the route is snapped to the road with travel heading', () => {
  const match = matching.snapCarToRoad({ latitude: 42.0005, longitude: 74.00007, accuracy: 8 }, road);
  assert.ok(match);
  assert.ok(Math.abs(match.longitude - 74) < 0.000001);
  assert.ok(Math.abs(match.heading) < 1);
  assert.ok(match.along > 50 && match.along < 60);
});

test('road matching does not pull a distant or inaccurate GPS fix onto a street', () => {
  assert.equal(matching.snapCarToRoad({ latitude: 42.0005, longitude: 74.001, accuracy: 8 }, road), null);
  assert.equal(matching.snapCarToRoad({ latitude: 42.0005, longitude: 74.00003, accuracy: 70 }, road), null);
});

test('an ordinary urban GPS offset still stays on the road, with a smooth turn bearing', () => {
  const match = matching.snapCarToRoad({ latitude: 42.0005, longitude: 74.00027, accuracy: 30 }, road);
  assert.ok(match, 'a 22 metre offset should not put the car on a building');
  assert.ok(Math.abs(match.longitude - 74) < .000001);
  const corner = animation.carMetresBetween(road[0], road[1]);
  const before = matching.roadHeadingAt(road, corner - 4);
  const turning = matching.roadHeadingAt(road, corner);
  const after = matching.roadHeadingAt(road, corner + 4);
  assert.ok(before < 2 || before > 358);
  assert.ok(turning > 25 && turning < 65);
  assert.ok(after > 88 && after < 92);
  const weakContinuation = matching.snapCarToRoad({ latitude: 42.0006, longitude: 74.00027, accuracy: 70 }, road, match.along);
  assert.ok(weakContinuation, 'an established route can use a weaker fix without jumping onto a building');
});

test('car cannot jump backwards and traveled route disappears around the bend', () => {
  const first = matching.snapCarToRoad({ latitude: 42.0008, longitude: 74.00001, accuracy: 5 }, road);
  assert.ok(first);
  const backwards = matching.snapCarToRoad({ latitude: 42.0007, longitude: 74.00001, accuracy: 5 }, road, first.along);
  assert.ok(backwards);
  assert.equal(backwards.along, first.along);
  assert.ok(backwards.segmentIndex >= first.segmentIndex);
  const remaining = matching.remainingRoad(road, animation.carMetresBetween(road[0], road[1]) + 20);
  assert.equal(remaining.length, 2);
  assert.equal(remaining[0].latitude, road[1].latitude);
  assert.ok(remaining[0].longitude > road[1].longitude);
  assert.deepEqual(remaining[1], road[2]);
});
test('heading chooses the correct carriageway in a close parallel U-turn', () => {
  const loop = [
    { latitude: 42, longitude: 74 },
    { latitude: 42.001, longitude: 74 },
    { latitude: 42.001, longitude: 74.00012 },
    { latitude: 42, longitude: 74.00012 },
  ];
  const raw = { latitude: 42.0005, longitude: 74.00006, accuracy: 10, speed: 5 };
  const south = matching.snapCarToRoad({ ...raw, heading: 180 }, loop);
  assert.ok(south);
  assert.equal(south.segmentIndex, 2);
  assert.ok(Math.abs(south.heading - 180) < 1);
  const north = matching.snapCarToRoad({ ...raw, heading: 0 }, loop);
  assert.ok(north);
  assert.equal(north.segmentIndex, 0);
  assert.ok(south.along > north.along);
});

test('a moving car turning onto another street is not pinned to the old route', () => {
  const first = matching.snapCarToRoad({ latitude: 42.0005, longitude: 74, accuracy: 8, heading: 0, speed: 5 }, road);
  assert.ok(first);
  const turned = matching.snapCarToRoad({ latitude: 42.0005, longitude: 73.99982, accuracy: 20, heading: 270, speed: 5 }, road, first.along);
  assert.equal(turned, null, 'a perpendicular moving course must not hold the car beside the old road');
});
