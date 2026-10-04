const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/native/trackingPlayback.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exported });
const { TrackingPlayback, interpolatePlaybackBearing } = exported;
const epoch = 1_800_000_000_000;
const point = (time, north = 0, east = 0, extra = {}) => ({
  latitude: 42 + north / 111195, longitude: 74 + east / (111195 * Math.cos(42 * Math.PI / 180)),
  measuredAtMs: epoch + time, speedMps: 10, accuracyM: 2, courseDeg: 0,
  driverId: 'driver', assignmentId: 'assignment', trackingSessionId: 'session', sequence: time + 1, ...extra,
});
const north = frame => (frame.latitude - 42) * 111195;
const near = (actual, expected, tolerance = .001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≈ ${expected}`);
const create = mode => new TrackingPlayback({ mode, wallNow: () => epoch });

test('bearings cross north by the shortest arc and preserve absent values', () => {
  near(interpolatePlaybackBearing(359, 1, .5), 0);
  near(interpolatePlaybackBearing(1, 359, .5), 0);
  near(interpolatePlaybackBearing(90, 270, .5), 0);
  assert.equal(interpolatePlaybackBearing(null, null, .5), null);
  assert.equal(interpolatePlaybackBearing(null, 0, .5), 0);
});

for (const interval of [1000, 3000, 5000]) test(`measurement-time playback remains continuous for ${interval / 1000}s packets`, () => {
  const player = create('client');
  player.ingest(point(0), 0, 0);
  let before = player.sample(0), movingFrames = 0;
  for (let time = 50; time <= interval * 8; time += 50) {
    if (time % interval === 0) {
      const visible = player.sample(time);
      assert.equal(player.ingest(point(time, time / 100), time, 0), true);
      near(north(player.sample(time)), north(visible));
    }
    const frame = player.sample(time), delta = north(frame) - north(before);
    assert.ok(delta >= -.001, 'the measurement cursor never runs backwards');
    assert.ok(delta < 1.1, 'no teleport at the packet boundary');
    if (delta > .01) movingFrames++;
    before = frame;
  }
  assert.ok(movingFrames > interval * 6 / 50, 'motion continues between packets');
  assert.ok(before.bufferMs >= interval && before.bufferMs <= 6000);
  assert.ok(north(before) > interval * 5 / 100, 'buffer delay does not accumulate');
});

test('irregular delivery, duplicate and reversed packets do not restart the visible segment', () => {
  const player = create('client');
  player.ingest(point(0), 0, 0);
  player.ingest(point(1000, 10), 1300, 300);
  const visible = player.sample(1800);
  assert.equal(player.ingest(point(1000, 10), 1800, 800), false);
  assert.equal(player.ingest(point(500, 5), 1800, 1300), false);
  near(north(player.sample(1800)), north(visible));
  assert.equal(player.ingest(point(2000, 20), 2350, 350), true);
  const atArrival = player.sample(2350);
  assert.ok(north(atArrival) < 20);
  assert.ok(north(player.sample(2600)) > north(atArrival));
});

test('all geographic courses and displacement fallback use north=0, east=90', () => {
  for (const [n, e, expected] of [[20, 0, 0], [0, 20, 90], [-20, 0, 180], [0, -20, 270]]) {
    const player = create('local');
    player.ingest(point(0, 0, 0, { courseDeg: null }), 0, 0);
    player.ingest(point(1000, n, e, { courseDeg: null }), 1000, 0);
    near(player.sample(1400).bearingDeg, expected);
  }
});

test('stop jitter cannot turn the car; restart and shortest-arc turns remain smooth', () => {
  const player = create('local');
  player.ingest(point(0, 0, 0, { courseDeg: 359 }), 0, 0);
  player.ingest(point(1000, .5, 0, { speedMps: 0, courseDeg: 180 }), 1000, 0);
  assert.equal(player.sample(1400).bearingDeg, 359);
  player.ingest(point(2000, 10, 0, { speedMps: 4, courseDeg: 1 }), 2000, 0);
  const turn = player.sample(2125).bearingDeg;
  assert.ok(turn > 359 || turn < 1);
  near(player.sample(2400).bearingDeg, 1);
});

test('an explicit absent course never falls back to a compass or to fabricated north', () => {
  const player = create('local');
  player.ingest(point(0, 0, 0, { courseDeg: null, heading: 123 }), 0, 0);
  assert.equal(player.sample(0).bearingDeg, null);
  player.ingest(point(1000, .1, 0, { courseDeg: null, heading: 222, speedMps: 0 }), 1000, 0);
  assert.equal(player.sample(1500).bearingDeg, null);
});

test('validated slow displacement and held courses survive playback without a second motion gate', () => {
  for (const mode of ['client', 'local']) {
    const player = create(mode);
    player.ingest(point(0, 0, 0, { courseDeg: 90, courseSource: null, speedMps: 0 }), 0, 0);
    near(player.sample(0).bearingDeg, 90);
    player.ingest(point(1000, 0, 1, { courseDeg: 100, courseSource: 'displacement', speedMps: null }), 1000, 0);
    near(player.sample(5000).bearingDeg, 100);
  }
});

test('local retargeting starts at the rendered frame and has bounded latency', () => {
  const player = create('local');
  player.ingest(point(0), 0, 0);
  player.ingest(point(1000, 10), 1000, 0);
  const midway = player.sample(1100);
  player.ingest(point(1200, 12), 1100, 0);
  near(north(player.sample(1100)), north(midway));
  near(north(player.sample(1300)), 14);
  assert.equal(player.sample(1300).bufferMs, 0);
});

test('lost connection freezes on the last measured point and recovery begins there', () => {
  const player = create('client');
  player.ingest(point(0), 0, 0);
  player.ingest(point(1000, 10), 1000, 0);
  near(north(player.sample(20000)), 10);
  assert.equal(player.sample(20000).stale, true);
  near(north(player.sample(40000)), 10);
  player.ingest(point(41000, 120), 41000, 0);
  near(north(player.sample(41000)), 10);
  assert.equal(player.sample(41000).stale, false);
  assert.ok(north(player.sample(41400)) > 10);
  near(north(player.sample(41800)), 120);
});

test('age uses the supplied server age plus monotonic elapsed time under wall-clock skew', () => {
  const player = new TrackingPlayback({ wallNow: () => epoch + 3_600_000 });
  player.ingest(point(0), 100, 1000);
  assert.equal(player.sample(1000).stale, false);
  assert.equal(player.sample(15100).stale, true);
});

test('retired sessions stay retired even when their late timestamp is newer', () => {
  const player = create('client');
  player.ingest(point(0, 0, 0, { trackingSessionId: 'A', sequence: 10 }), 0, 0);
  assert.equal(player.ingest(point(1000, 10, 0, { trackingSessionId: 'B', sequence: 1 }), 1000, 0), true);
  assert.equal(player.ingest(point(2000, 20, 0, { trackingSessionId: 'A', sequence: 11 }), 2000, 0), false);
  assert.equal(player.ingest(point(2000, 20, 0, { trackingSessionId: 'B', sequence: 1 }), 2000, 0), false);
  assert.equal(player.ingest(point(2000, 20, 0, { trackingSessionId: 'B', sequence: 2 }), 2000, 0), true);
});

test('rejects impossible GPS jumps and follows genuine departures without any route coercion', () => {
  const client = create('client');
  client.ingest(point(0), 0, 0);
  assert.equal(client.ingest(point(1000, 5000), 1000, 0), false);
  const player = create('local');
  player.ingest(point(0), 0, 0);
  assert.equal(player.ingest(point(1000, 0, 10, { courseDeg: 90,
    matched: true, matchedPath: [point(0), point(1000, 10)] }), 1000, 0), true);
  const frame = player.sample(1400);
  near(north(frame), 0);
  near(frame.longitude, point(1400, 0, 14).longitude);
  assert.ok(frame.bearingDeg > 45 && frame.bearingDeg < 90, 'a real turn animates beyond the short position correction');
  near(player.sample(1700).bearingDeg, 90);
  player.reset();
  assert.equal(player.sample(1500), null);
});

test('local turns and U-turns animate smoothly without delaying the measured position', () => {
  for (const [bearing, duration] of [[90, 630], [180, 1050]]) {
    const player = create('local');
    player.ingest(point(0, 0, 0, { courseDeg: 0 }), 0, 0);
    player.ingest(point(1000, 10, 0, { courseDeg: bearing, speedMps: 0, courseSource: 'gps' }), 1000, 0);
    near(player.sample(1000).bearingDeg, 0);
    const correctedPosition = player.sample(1350);
    near(north(correctedPosition), 10, .001);
    const rotated = Math.abs(((correctedPosition.bearingDeg + 540) % 360) - 180);
    assert.ok(rotated > 0 && rotated < bearing, 'heading is still animating after the position is corrected');
    near(player.sample(1000 + duration).bearingDeg, bearing);
  }
});

test('an arriving course update continues from the visible bearing during an unfinished turn', () => {
  const player = create('local');
  player.ingest(point(0, 0, 0, { courseDeg: 359 }), 0, 0);
  player.ingest(point(1000, 10, 0, { courseDeg: 89 }), 1000, 0);
  const visible = player.sample(1250);
  player.ingest(point(1250, 12.5, 0, { courseDeg: 109 }), 1250, 0);
  near(player.sample(1250).bearingDeg, visible.bearingDeg);
  near(player.sample(2000).bearingDeg, 109);
});

test('local one-second GPS continues between events with bounded prediction on dropout', () => {
  const player = create('local');
  player.ingest(point(0), 0, 0);
  let before = player.sample(0), movingFrames = 0;
  for (let time = 50; time <= 5000; time += 50) {
    if (time % 1000 === 0) {
      const visible = player.sample(time);
      player.ingest(point(time, time / 100), time, 0);
      near(north(player.sample(time)), north(visible));
    }
    const current = player.sample(time);
    if (north(current) - north(before) > .01) movingFrames++;
    before = current;
  }
  assert.ok(movingFrames >= 70, 'local motion must not stall for most of every interval');
  near(north(player.sample(5750)), 57.5);
  near(north(player.sample(10000)), 57.5, .005);
  const stale = player.sample(20500);
  assert.equal(stale.stale, true);
  near(north(stale), 50);
});

test('local prediction requires accuracy, movement and reliable course, and never exceeds 15m', () => {
  for (const overrides of [{ accuracyM: 25 }, { accuracyM: null }, { speedMps: 0 }, { courseDeg: null }, { courseAccuracyDeg: 60 }, { courseSource: null }]) {
    const player = create('local');
    player.ingest(point(0, 0, 0, overrides), 0, 0);
    near(north(player.sample(750)), 0);
  }
  const fast = create('local');
  fast.ingest(point(0, 0, 0, { speedMps: 40 }), 0, 0);
  near(north(fast.sample(10000)), 15);
});

test('confirmed GPS reacquisition is not rejected again by the local renderer or client hook consumer', () => {
  for (const mode of ['local', 'client']) {
    const player = create(mode);
    player.ingest(point(0), 0, 0);
    assert.equal(player.ingest(point(2000, 1000, 0, { playbackPositionValidated: true, speedMps: 0 }), 2000, 0), true);
    near(north(player.sample(3000)), 1000);
  }
  const standalone = create('client');
  standalone.ingest(point(0), 0, 0);
  assert.equal(standalone.ingest(point(1000, 1000), 1000, 0), false);
  assert.equal(standalone.ingest(point(2000, 1002), 2000, 0), true);
  near(north(standalone.sample(3000)), 1002);
});
