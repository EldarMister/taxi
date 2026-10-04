const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function compile(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve(file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => dependencies[id] });
  return exports;
}
const navigation = compile('../src/navigation.ts');
const { DriverGpsFilter } = compile('../src/driverGps.ts', { './navigation': navigation });
const start = 1_800_000_000_000;
const coordinate = (north = 0, east = 0) => ({ latitude: 42 + north / 111195, longitude: 74 + east / (111195 * Math.cos(42 * Math.PI / 180)) });
const fix = (seconds, north = 0, east = 0, options = {}) => ({ ...coordinate(north, east), timestamp: start + seconds * 1000, accuracy: 3, ...options });
const ingest = (filter, value) => filter.ingest(value, value.timestamp);
const closeAngle = (actual, expected, tolerance = .1) => assert.ok(Math.abs(navigation.shortestAngleDelta(expected, actual)) < tolerance, `${actual} expected ${expected}`);

test('GPS and displacement courses use true-north clockwise cardinal bearings', () => {
  for (const [north, east, expected] of [[20, 0, 0], [0, 20, 90], [-20, 0, 180], [0, -20, 270]]) {
    const gps = new DriverGpsFilter();
    closeAngle(ingest(gps, fix(0, 0, 0, { speed: 5, heading: expected })).heading, expected);
    const fallback = new DriverGpsFilter();
    assert.equal(ingest(fallback, fix(0)).heading, undefined);
    const moved = ingest(fallback, fix(4, north, east));
    closeAngle(moved.heading, expected);
    assert.equal(moved.courseSource, 'displacement');
    assert.ok(moved.courseAccuracyDeg > 0 && moved.courseAccuracyDeg < 40);
  }
});

test('clear turns and U-turns pass immediately while north-crossing noise stays stable', () => {
  const filter = new DriverGpsFilter();
  for (const [index, bearing] of [0, 90, 0, 180, 359].entries()) {
    const output = ingest(filter, fix(index, index * 4, 0, { speed: 4, heading: bearing }));
    closeAngle(output.heading, bearing);
    assert.equal(output.courseSource, 'gps');
  }
  closeAngle(ingest(filter, fix(5, 20, 0, { speed: 4, heading: 1 })).heading, 359);
  closeAngle(navigation.interpolateBearing(359, 1, .5), 0);
});

test('recorded straight-road course noise does not swing the published vehicle course', () => {
  // First 45 seconds of the supplied 1.1.65 recording: GPS courses alternate
  // left/right despite steady eastbound movement and 1.1–1.2 m accuracy.
  const headings = [92, 87, 90, 94, 92, 91, 92, 88, 90, 91, 90, 89, 89, 91, 87];
  const filter = new DriverGpsFilter();
  for (const [index, heading] of headings.entries()) {
    const output = ingest(filter, fix(index * 3, 0, index * 9, { speed: 3, heading, accuracy: 1.2 }));
    closeAngle(output.heading, 92);
    assert.equal(output.courseSource, 'gps');
  }
});

test('recorded eastbound and northbound straight sections suppress alternating course spikes', () => {
  for (const [seed, headings] of [
    [91, [86, 83, 86, 91, 88, 89, 84, 86, 94, 87, 85, 90, 87]],
    [359, [359, 358, 0, 0, 5, 356, 0, 3, 355, 348, 356, 359, 1]],
  ]) {
    const filter = new DriverGpsFilter();
    ingest(filter, fix(0, 0, 0, { speed: 6, heading: seed }));
    for (const [index, heading] of headings.entries()) {
      const output = ingest(filter, fix(index + 1, seed === 359 ? index * 6 : 0,
        seed === 91 ? index * 6 : 0, { speed: 6, heading }));
      closeAngle(output.heading, seed);
    }
  }
});

test('isolated modest course spikes are rejected but a persistent bend is accepted on the next fix', () => {
  const filter = new DriverGpsFilter();
  for (const [index, heading] of [0, 7, 0, 10, 357, 4, 353, 1].entries()) {
    closeAngle(ingest(filter, fix(index, index * 6, 0, { speed: 6, heading })).heading, 0);
  }
  closeAngle(ingest(filter, fix(8, 48, 0, { speed: 6, heading: 8 })).heading, 0);
  closeAngle(ingest(filter, fix(9, 54, 0, { speed: 6, heading: 10 })).heading, 10);
  closeAngle(ingest(filter, fix(10, 60, 0, { speed: 6, heading: 30 })).heading, 30);
});

test('a gradual curve accumulates outside the deadband and sparse measurements do not wait again', () => {
  const filter = new DriverGpsFilter();
  let output;
  for (const [index, heading] of [0, 2, 4, 6, 8, 10, 12, 14, 16].entries()) {
    output = ingest(filter, fix(index, index * 6, 0, { speed: 6, heading }));
    assert.ok(Math.abs(navigation.shortestAngleDelta(heading, output.heading)) <= 6);
  }
  closeAngle(output.heading, 16);
  closeAngle(ingest(filter, fix(11, 66, 0, { speed: 6, heading: 22 })).heading, 22);
});

test('stop jitter and unrelated phone orientation never turn the vehicle; restart uses hysteresis', () => {
  const filter = new DriverGpsFilter();
  ingest(filter, fix(0, 0, 0, { speed: 4, heading: 90 }));
  for (let second = 1; second <= 8; second++) {
    const output = ingest(filter, fix(second, second % 2, (second + 1) % 2, {
      speed: 0, heading: (second * 93) % 360, deviceHeading: second * 35, screenOrientation: second % 2 ? 90 : 0,
    }));
    closeAngle(output.heading, 90);
    assert.equal(output.courseSource, null);
    assert.equal(output.latitude, 42);
    assert.equal(output.longitude, 74);
    assert.equal(output.timestamp, start + second * 1000);
  }
  assert.equal(ingest(filter, fix(9, 1, 0, { speed: 1.6, heading: 180 })).courseSource, null);
  closeAngle(ingest(filter, fix(10, 2, 0, { speed: 2.2, heading: 180 })).heading, 180);
  assert.equal(ingest(filter, fix(11, 3, 0, { speed: 1.4, heading: 181 })).courseSource, 'gps');
});

test('an initially stopped car has no invented north course and slow unknown-speed movement uses a baseline', () => {
  const filter = new DriverGpsFilter();
  assert.equal(ingest(filter, fix(0, 0, 0, { speed: 0, heading: 0 })).heading, undefined);
  for (let second = 1; second < 8; second++) assert.equal(ingest(filter, fix(second, 0, second)).heading, undefined);
  const east = ingest(filter, fix(9, 0, 9));
  closeAngle(east.heading, 90);
  assert.equal(east.speed, undefined);
  assert.equal(east.courseSource, 'displacement');
});

test('uncertainty and stale baselines cannot turn GPS jitter into a movement course', () => {
  const filter = new DriverGpsFilter();
  ingest(filter, fix(0, 0, 0, { accuracy: 20 }));
  for (let second = 1; second <= 50; second++) {
    const output = ingest(filter, fix(second, second % 7 - 3, second % 9 - 4, { accuracy: 20, heading: second * 7 % 360 }));
    assert.equal(output.heading, undefined);
    assert.equal(output.courseSource, null);
  }
});

test('bad optional sensor values keep coordinates usable; unreliable courses remain unknown', () => {
  const filter = new DriverGpsFilter();
  const output = ingest(filter, fix(0, 0, 0, { speed: NaN, heading: -1 }));
  assert.ok(output);
  assert.equal(output.speed, undefined);
  assert.equal(output.heading, undefined);
  assert.equal(ingest(filter, fix(1, 0, 1, { speed: 5, heading: 90, courseAccuracyDeg: 80 })).heading, undefined);
  assert.equal(ingest(filter, fix(2, 0, 2, { speed: 5, heading: 90, accuracy: 60 })).heading, undefined);
});

test('duplicates and reordered GPS are ignored, spike requires confirmation and gap allows reacquisition', () => {
  const filter = new DriverGpsFilter();
  ingest(filter, fix(0, 0, 0, { speed: 5, heading: 0 }));
  assert.equal(ingest(filter, fix(0, 0, 20)), null);
  assert.equal(ingest(filter, fix(-1)), null);
  assert.equal(ingest(filter, fix(1, 1000)), null);
  assert.equal(filter.lastDropReason, 'implausible-jump');
  const recovered = ingest(filter, fix(2, 1002));
  assert.equal(recovered.latitude, fix(2, 1002).latitude);
  const relocated = ingest(filter, fix(40, 5000));
  assert.equal(relocated.latitude, fix(40, 5000).latitude);
  assert.equal(relocated.courseSource, null, 'reacquisition never infers a course across the jump');
  assert.equal(filter.ingest(fix(41), start + 80_000), null, 'stale fixes are rejected');
  assert.equal(filter.ingest(fix(90), start + 80_000), null, 'future fixes are rejected');
});

test('1, 3 and 5 second moving updates keep filtering latency small and never snap to route fields', () => {
  for (const interval of [1, 3, 5]) {
    const filter = new DriverGpsFilter();
    ingest(filter, fix(0, 0, 0, { speed: 10, heading: 0 }));
    const raw = fix(interval, interval * 10, 0, { speed: 10, heading: 0,
      snappedLatitude: 0, snappedLongitude: 0, matched: true, matchedPath: [coordinate(0), coordinate(20)] });
    const output = ingest(filter, raw);
    assert.ok(navigation.distanceBetween(raw, output) < 1.1, 'position filter must not add seconds of lag');
    assert.equal(output.snappedLatitude, undefined);
    assert.equal(output.matchedPath, undefined);
  }
});

test('a changed trip resets course and ordering without retaining the previous driver orientation', () => {
  const filter = new DriverGpsFilter();
  ingest(filter, fix(10, 0, 0, { speed: 5, heading: 270 }));
  filter.reset();
  const output = ingest(filter, fix(0, 0, 0, { speed: 0, heading: 270 }));
  assert.ok(output);
  assert.equal(output.heading, undefined);
});
