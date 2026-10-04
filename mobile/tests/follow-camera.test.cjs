const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/native/followCamera.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: api });
const { followCameraTarget, advanceFollowCamera, shortestBearingDelta } = api;
const origin = { latitude: 42, longitude: 74 };

test('camera looks ahead in each geographical direction, independently of screen orientation', () => {
  for (const bearing of [0, 90, 180, 270]) {
    const result = followCameraTarget({ ...origin, bearingDeg: bearing }, 'course', true, 8, 17, 0);
    assert.equal(result.heading, bearing);
    if (bearing === 0) assert.ok(result.latitude > origin.latitude);
    if (bearing === 90) assert.ok(result.longitude > origin.longitude);
    if (bearing === 180) assert.ok(result.latitude < origin.latitude);
    if (bearing === 270) assert.ok(result.longitude < origin.longitude);
    assert.equal(followCameraTarget({ ...origin, bearingDeg: bearing }, 'north', true, 8, 17, 100).heading, 0);
  }
});
test('north crossing follows the short arc in both directions, including accumulated SDK bearings', () => {
  assert.equal(shortestBearingDelta(359, 1), 2);
  assert.equal(shortestBearingDelta(1, 359), -2);
  assert.equal(shortestBearingDelta(1079, 1), 2);
  const from = { ...origin, heading: 359, zoom: 16, pitch: 0 };
  const to = { ...origin, heading: 1, zoom: 17, pitch: 40 };
  const result = advanceFollowCamera(from, to, 33, false);
  assert.ok(result.heading > 359 && result.heading < 361);
  assert.ok(result.zoom > 16 && result.zoom < 17);
  assert.ok(result.pitch > 0 && result.pitch < 40);
});
test('unknown direction does not invent north or road-ahead placement; a held course remains steady', () => {
  const target = followCameraTarget({ ...origin, bearingDeg: null }, 'course', true, 0, 17, 215);
  assert.equal(target.heading, 215);
  assert.equal(target.latitude, origin.latitude);
  assert.equal(target.longitude, origin.longitude);
  const held = followCameraTarget({ ...origin, bearingDeg: 215 }, 'course', true, 0, 17, 215);
  let pose = held;
  for (let i = 0; i < 60; i++) pose = advanceFollowCamera(pose, held, 33, false);
  assert.equal(pose.heading, 215);
});
test('return to navigation and interruptions continue from the visible camera pose', () => {
  const from = { ...origin, heading: 270, zoom: 12, pitch: 0 };
  const to = { latitude: 42.01, longitude: 74.01, heading: 90, zoom: 17, pitch: 40 };
  const halfway = advanceFollowCamera(from, to, 33, true);
  assert.ok(halfway.latitude > from.latitude && halfway.latitude < to.latitude);
  const interrupted = advanceFollowCamera(halfway, { ...to, heading: 0 }, 33, true);
  assert.ok(Math.abs(shortestBearingDelta(halfway.heading, interrupted.heading)) < 45);
  assert.ok(interrupted.latitude > halfway.latitude);
});

test('camera damps micro-turns but follows a real corner promptly', () => {
  let pose = { ...origin, heading: 90, zoom: 17, pitch: 40 };
  const nudge = advanceFollowCamera(pose, { ...pose, heading: 93 }, 33, false);
  assert.ok(nudge.heading - 90 < .6, 'a three degree nudge must not swing the map in one frame');
  for (let i = 0; i < 30; i++) pose = advanceFollowCamera(pose, { ...pose, heading: 180 }, 33, false);
  assert.ok(Math.abs(shortestBearingDelta(pose.heading, 180)) < .5, 'a real turn settles within one second');
});
