const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const output = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/native/carRouteAnimation.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: output });
const { carMetresBetween, trustedCarRoutePath, trustedCarDirectPath, sampleCarRoutePath } = output;
const origin = { latitude: 42, longitude: 74 };
const shifted = (north, east) => ({ latitude: origin.latitude + north / 111320,
  longitude: origin.longitude + east / (111320 * Math.cos(origin.latitude * Math.PI / 180)) });
const fix = (point, measuredAtMs) => ({ ...point, accuracyM: 5, measuredAtMs });

test('a confident right-angle route animation follows the corner and ends at the raw GPS fix', () => {
  const corner = shifted(20, 0), route = [origin, corner, shifted(20, 20)];
  const previous = fix(shifted(8, 0), 1000), current = fix(shifted(20, 12), 2000);
  const path = trustedCarRoutePath(previous, current, previous, route, 1000);
  assert.ok(path, 'both precise fixes identify one forward route piece');
  assert.equal(path.points.length, 3);
  assert.ok(carMetresBetween(sampleCarRoutePath(path, .5), corner) < .5, 'the midpoint must reach the corner, not cut diagonally');
  assert.ok(carMetresBetween(sampleCarRoutePath(path, 1), current) < .001, 'animation ends on the original measured coordinate');
  assert.ok(carMetresBetween(sampleCarRoutePath(path, .5), shifted(14, 6)) > 7, 'the diagonal midpoint would be in the wrong place');
});

test('off-road, inaccurate, stale, and backward fixes do not get matched to the route', () => {
  const route = [origin, shifted(20, 0), shifted(20, 20)];
  const previous = fix(shifted(8, 0), 1000);
  assert.equal(trustedCarRoutePath(previous, fix(shifted(30, 12), 2000), previous, route, 1000), null);
  assert.equal(trustedCarRoutePath(previous, { ...fix(shifted(20, 12), 2000), accuracyM: 20 }, previous, route, 1000), null);
  assert.equal(trustedCarRoutePath(previous, fix(shifted(20, 12), 1000), previous, route, 1000), null);
  assert.equal(trustedCarRoutePath(fix(shifted(20, 12), 1000), fix(shifted(8, 0), 2000), shifted(20, 12), route, 1000), null);
  assert.equal(trustedCarRoutePath(previous, fix(shifted(20, 12), 2000), previous, route, 5000), null);
});

test('nearby parallel return roads are ambiguous even if the first segment is marginally closer', () => {
  const route = [origin, shifted(0, 30), shifted(8, 30), shifted(8, 0)];
  const previous = fix(shifted(.5, 10), 1000), current = fix(shifted(.5, 20), 2000);
  assert.equal(trustedCarRoutePath(previous, current, previous, route, 1000), null);
});

test('reliable GPS fixes animate directly when a road match is unavailable, ending at the measured point', () => {
  const previous = fix(shifted(2, 0), 1000), current = fix(shifted(2, 12), 2000);
  const path = trustedCarDirectPath(previous, current, previous, 1000);
  assert.ok(path);
  assert.ok(carMetresBetween(sampleCarRoutePath(path, .5), shifted(2, 6)) < .01);
  assert.ok(carMetresBetween(sampleCarRoutePath(path, 1), current) < .001);
  assert.equal(trustedCarDirectPath(previous, { ...current, accuracyM: 35 }, previous, 1000), null);
  assert.equal(trustedCarDirectPath(previous, { ...current, measuredAtMs: 500 }, previous, 1000), null);
  assert.equal(trustedCarDirectPath(previous, shifted(2, 80), previous, 1000), null);
});
