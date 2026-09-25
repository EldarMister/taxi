const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/navigation.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports: exportsObject, Date });
const { prepareRoute, routeProgress, guidanceCue, maneuverText, normalizeManeuver, bearingDelta, usableNavigationFix, stableNavigationFix, bestRussianVoice, bestVoiceForLanguage, navigationDestination, distanceBetween } = exportsObject;
test('bearing interpolation takes the short path across north in both directions', () => {
  assert.equal(exportsObject.interpolateBearing(350, 10, .5), 0);
  assert.equal(exportsObject.interpolateBearing(10, 350, .5), 0);
  assert.equal(exportsObject.shortestAngleDelta(350, 10), 20);
  assert.equal(exportsObject.shortestAngleDelta(10, 350), -20);
});
test('route options fall back only for a legacy server DTO', () => {
  assert.equal(exportsObject.unsupportedRouteOptions({ status: 400, message: 'property fast should not exist' }), true);
  assert.equal(exportsObject.unsupportedRouteOptions({ status: 400, message: 'property bearing should not exist' }), true);
  assert.equal(exportsObject.unsupportedRouteOptions({ status: 400, message: 'NoRoute' }), false);
  assert.equal(exportsObject.unsupportedRouteOptions({ status: 500, message: 'property fast should not exist' }), false);
});
test('client map omits the driver-to-pickup path while driver navigation keeps it', () => {
  const routes = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/tripMapRoutes.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: routes });
  const order = { status: 'ASSIGNED', routeProvider: 'osrm', geometry: [a, b] };
  const navigationRoute = { geometry: [c, a] };
  assert.equal(routes.tripMapRoutes({ driver: false, order, navigationRoute, approachRoute: navigationRoute }).approachGeometry, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(routes.tripMapRoutes({ driver: true, order, navigationRoute }).approachGeometry)), [c, a]);
});
const point = (latitude, longitude) => ({ latitude, longitude });
const a = point(42.87, 74.59), b = point(42.875, 74.59), c = point(42.875, 74.595);
function step(type, location, geometry, modifier) { return { name: 'Улица', distanceMeters: 500, durationSeconds: 60, geometry, maneuver: { type, location, modifier, bearingBefore: 0, bearingAfter: 90 } }; }
const route = { provider: 'osrm', distanceMeters: 1000, durationSeconds: 120, geometry: [a, b, c], steps: [step('depart', a, [a, b]), step('turn', b, [b, c], 'right'), step('arrive', c, [c])] };
const fix = (p, timestamp = Date.now()) => ({ ...p, accuracy: 5, timestamp });

test('assigned trip guides to passenger, started trip to destination, other stages stop guidance', () => {
  assert.equal(navigationDestination({ status: 'ASSIGNED', pickup: a, dropoff: c }), a);
  assert.equal(navigationDestination({ status: 'IN_PROGRESS', pickup: a, dropoff: c }), c);
  for (const status of ['SEARCHING', 'ARRIVED', 'COMPLETED', 'CANCELLED', 'NO_DRIVER']) assert.equal(navigationDestination({ status, pickup: a, dropoff: c }), null);
});
test('rejects inaccurate, stale, future, invalid and absent GPS fixes', () => {
  assert.ok(usableNavigationFix(fix(a)));
  assert.ok(usableNavigationFix({ ...fix(a), accuracy: 70, timestamp: Date.now() - 20000 }));
  for (const item of [null, { ...fix(a), accuracy: 100 }, { ...fix(a), accuracy: -1 }, fix(a, Date.now() - 31000), fix(a, Date.now() + 6000), { ...fix(a), longitude: 999 }]) assert.equal(usableNavigationFix(item), false);
});
test('holds a recent reliable coordinate through weak fixes and one impossible jump, then reacquires after a gap', () => {
  const first = fix(a), weak = { ...fix(a, first.timestamp + 1000), accuracy: 150 };
  const jump = fix(point(a.latitude + .01, a.longitude), first.timestamp + 2000);
  const nearby = fix(point(a.latitude + .0003, a.longitude), first.timestamp + 1000);
  assert.equal(stableNavigationFix(first, weak, first.timestamp + 1000), first);
  assert.equal(stableNavigationFix(first, nearby, first.timestamp + 1000), nearby);
  assert.equal(stableNavigationFix(first, jump, first.timestamp + 2000), first);
  assert.equal(stableNavigationFix(first, jump, first.timestamp + 31000), jump);
});

test('stationary GPS noise refreshes the fix without moving the car', () => {
  const first = { ...fix(a), accuracy: 20, speed: 0, heading: 90 };
  const noise = { ...fix(point(a.latitude + .00005, a.longitude), first.timestamp + 1000), accuracy: 20, speed: 0, heading: 240 };
  const held = stableNavigationFix(first, noise, noise.timestamp);
  assert.equal(held.latitude, first.latitude);
  assert.equal(held.longitude, first.longitude);
  assert.equal(held.heading, first.heading);
  assert.equal(held.timestamp, noise.timestamp);
  const moving = { ...noise, speed: 8 };
  assert.equal(stableNavigationFix(first, moving, moving.timestamp), moving);
});

test('two nearby new fixes reacquire real position without accepting one GPS spike', () => {
  const first = { ...fix(a), accuracy: 8, speed: 0 };
  const spike = { ...fix(point(a.latitude + .01, a.longitude), first.timestamp + 1000), accuracy: 8, speed: 0 };
  const confirmed = { ...fix(point(a.latitude + .01002, a.longitude), first.timestamp + 2000), accuracy: 7, speed: 0 };
  const unrelated = { ...fix(point(a.latitude + .02, a.longitude), first.timestamp + 2000), accuracy: 7, speed: 0 };
  const late = { ...confirmed, timestamp: spike.timestamp + 11_000 };
  assert.equal(stableNavigationFix(first, spike, spike.timestamp), first);
  assert.equal(stableNavigationFix(first, unrelated, unrelated.timestamp, spike), first);
  assert.equal(stableNavigationFix(first, confirmed, confirmed.timestamp, spike), confirmed);
  assert.equal(stableNavigationFix(first, late, late.timestamp, spike), first);
});
test('prefers an enhanced Russian voice that works offline', () => {
  assert.equal(bestRussianVoice([
    { identifier: 'en', language: 'en-US', quality: 'Enhanced' },
    { identifier: 'ru-network', language: 'ru-RU', quality: 'Enhanced' },
    { identifier: 'ru-offline', language: 'ru-RU', quality: 'Enhanced' },
  ]), 'ru-offline');
});
test('measures distance along road instead of diagonal to maneuver', () => {
  const prepared = prepareRoute(route);
  const result = routeProgress(prepared, fix(a));
  assert.equal(result.stepIndex, 1); assert.match(result.instruction, /направо/);
  assert.ok(Math.abs(result.maneuverDistance - distanceBetween(a, b)) < 1);
  assert.ok(Math.abs(result.remainingMeters - 1000) < 1);
  assert.equal(result.arrived, false);
});
test('a contradictory provider turn is rejected instead of silently changing spoken direction', () => {
  const west = point(b.latitude, b.longitude - .005);
  const wrongTurn = { ...step('turn', b, [b, west], 'right'), name: 'улица Ленина', maneuver: { ...step('turn', b, [b, west], 'right').maneuver, bearingAfter: 270 } };
  const mislabeled = { ...route, geometry: [a, b, west], steps: [step('depart', a, [a, b]), wrongTurn, step('arrive', west, [west])] };
  assert.throws(() => prepareRoute(mislabeled), /противоречивый поворот/);
  assert.equal(mislabeled.steps[1].maneuver.modifier, 'right');
});
test('structured bearings and geometry agree for north-east right, north-west left, east-south right independent of camera rotation', () => {
  const cases = [
    { start: a, via: b, end: c, before: 0, after: 90, modifier: 'right' },
    { start: a, via: b, end: point(b.latitude, b.longitude - .005), before: 0, after: 270, modifier: 'left' },
    { start: a, via: point(a.latitude, a.longitude + .005), end: point(a.latitude - .005, a.longitude + .005), before: 90, after: 180, modifier: 'right' },
  ];
  for (const { start, via, end, before, after, modifier } of cases) {
    const turn = { ...step('turn', via, [via, end], modifier), maneuver: { type: 'turn', location: via, modifier, bearingBefore: before, bearingAfter: after } };
    const candidate = { ...route, geometry: [start, via, end], steps: [step('depart', start, [start, via]), turn, step('arrive', end, [end])] };
    const instruction = maneuverText(prepareRoute(candidate).route.steps[1]);
    assert.match(instruction, modifier === 'right' ? /направо/ : /налево/);
    assert.equal(maneuverText(prepareRoute({ ...candidate, cameraBearing: 180 }).route.steps[1]), instruction);
  }
});
test('OSRM bearing sides remain correct across north and independent of map rotation', () => {
  for (const [before, after, expected] of [[0,90,'right'],[0,270,'left'],[90,0,'left'],[270,0,'right'],[359,1,'right'],[1,359,'left']]) {
    const turn = { ...step('turn', b, [b,c]), maneuver: { type: 'turn', location: b, bearingBefore: before, bearingAfter: after } };
    assert.equal(normalizeManeuver(turn).side, expected);
    assert.equal(normalizeManeuver({ ...turn, cameraBearing: 137 }).side, expected);
    assert.match(maneuverText(turn), expected === 'right' ? /направо/ : /налево/);
  }
  assert.equal(bearingDelta(359,1), 2);
  assert.equal(bearingDelta(1,359), -2);
});
test('a right turn that matches the line stays right, and a nearly straight road keeps the provider instruction', () => {
  assert.equal(prepareRoute(route).route.steps[1].maneuver.modifier, 'right');
  const nearlyStraight = point(b.latitude + .005, b.longitude + .0003);
  const ambiguous = { ...route, geometry: [a, b, nearlyStraight], steps: [step('depart', a, [a, b]), step('turn', b, [b, nearlyStraight], 'slight left'), step('arrive', nearlyStraight, [nearlyStraight])] };
  assert.equal(prepareRoute(ambiguous).route.steps[1].maneuver.modifier, 'slight left');
});
test('advances beyond a passed turn and reaches arrival without completing order state', () => {
  const prepared = prepareRoute(route);
  const afterTurn = routeProgress(prepared, fix(point(b.latitude, b.longitude + .001)), { along: 555, timestamp: Date.now() - 3000 });
  assert.equal(afterTurn.stepIndex, 2);
  assert.equal(routeProgress(prepared, fix(c), { along: prepared.total - 50, timestamp: Date.now() - 3000 }).arrived, true);
});
test('off-route position cannot advance route progress', () => {
  const result = routeProgress(prepareRoute(route), fix(point(42.88, 74.6)), { along: 100, timestamp: Date.now() - 2000 });
  assert.ok(result.offRouteMeters > 60); assert.equal(result.along, 100); assert.equal(result.arrived, false);
});
test('GPS jitter cannot rewind completed progress', () => {
  const result = routeProgress(prepareRoute(route), fix(point(42.8708, a.longitude)), { along: 100, timestamp: Date.now() - 2000 });
  assert.equal(result.along, 100);
});
test('one near-junction fix cannot switch the active maneuver', () => {
  const prepared = prepareRoute(route);
  const timestamp = Date.now();
  const before = { along: prepared.offsets[1] - 4, timestamp: timestamp - 1000, stepIndex: 1 };
  const nearby = fix(point(b.latitude, b.longitude + .00022), timestamp);
  const first = routeProgress(prepared, nearby, before);
  assert.equal(first.stepIndex, 1);
  assert.equal(first.pendingStepIndex, 2);
  assert.equal(guidanceCue(first), null, 'a turn already behind this GPS fix must not be spoken');
  const second = routeProgress(prepared, { ...nearby, timestamp: timestamp + 1000 }, { along: first.along, timestamp, stepIndex: first.stepIndex, pendingStepIndex: first.pendingStepIndex, pendingStepCount: first.pendingStepCount });
  assert.equal(second.stepIndex, 2);
});
test('loop returning to departure does not announce arrival at its start', () => {
  const loop = { ...route, geometry: [a, b, c, a], steps: [step('depart', a, [a,b]), step('turn', b, [b,c], 'right'), step('turn', c, [c,a], 'right'), step('arrive', a, [a])] };
  const prepared = prepareRoute(loop);
  assert.ok(prepared.offsets[3] > 1000);
  assert.equal(routeProgress(prepared, fix(a)).arrived, false);
});
test('initial GPS cannot jump to a later road which passes closer than the snapped departure', () => {
  const rawStart = point(a.latitude, a.longitude + .0001);
  const crossing = { ...route, geometry: [a,b,c,rawStart], steps: [step('depart', a, [a,b]), step('turn', b, [b,c], 'right'), step('turn', c, [c,rawStart], 'right'), step('arrive', rawStart, [rawStart])] };
  const result = routeProgress(prepareRoute(crossing), fix(rawStart));
  assert.ok(result.along <= 100); assert.equal(result.arrived, false); assert.equal(result.stepIndex, 1);
});
test('the approach to the final destination never claims arrival prematurely', () => {
  const prepared = prepareRoute(route);
  const result = routeProgress(prepared, fix(point(c.latitude, c.longitude - .001)), { along: 800, timestamp: Date.now() - 3000 });
  assert.equal(result.arrived, false); assert.match(result.instruction, /впереди/);
  assert.doesNotMatch(guidanceCue(result)?.text || '', /вы прибыли/);
});
test('Russian voice prompts cover turns, fork, roundabout, ramps, uturn and arrival', () => {
  assert.match(maneuverText(step('turn', b, [b,c], 'uturn')), /Развернитесь/);
  assert.match(maneuverText(step('fork', b, [b,c], 'slight left')), /левее/);
  assert.match(maneuverText({ ...step('roundabout', b, [b,c]), maneuver: { type: 'roundabout', exit: 3 } }), /съезд 3/);
  assert.match(maneuverText(step('off ramp', b, [b,c], 'right')), /направо/);
  assert.match(maneuverText(step('arrive', c, [c])), /назначения впереди/);
});
test('route, leg, maneuver and stage produce stable deduplication keys', () => {
  const progress = { stepIndex: 1, instruction: 'Поверните направо', arrived: false };
  assert.equal(guidanceCue({ ...progress, maneuverDistance: 600 }), null);
  assert.equal(guidanceCue({ ...progress, maneuverDistance: 501 }, 'ru', 7, 1).key, '7:1:1:500');
  assert.equal(guidanceCue({ ...progress, maneuverDistance: 200 }).text, 'Через 200 метров поверните направо.');
  assert.equal(guidanceCue({ ...progress, maneuverDistance: 95 }, 'ru', 7, 1).key, '7:1:1:200');
  assert.equal(guidanceCue({ ...progress, maneuverDistance: 25 }, 'ru', 7, 1).key, '7:1:1:0');
  assert.deepEqual(Array.from(guidanceCue({ ...progress, maneuverDistance: 25 }, 'ru', 7, 1).supersedes), ['7:1:1:500', '7:1:1:200']);
  assert.notEqual(guidanceCue({ ...progress, maneuverDistance: 95 }, 'ru', 8, 1).key, guidanceCue({ ...progress, maneuverDistance: 95 }, 'ru', 7, 1).key);
});

test('a turn announces distance and the destination street without losing its name', () => {
  const instruction = maneuverText({ ...step('turn', b, [b,c], 'right'), name: 'улица Ленина' });
  assert.equal(guidanceCue({ stepIndex: 1, instruction, arrived: false, maneuverDistance: 105 }).text, 'Через 100 метров поверните направо на улицу Ленина.');
});
test('road names are spoken in the selected language and no stale Kyrgyz default leaks into Russian speech', () => {
  assert.equal(maneuverText({ ...step('turn', b, [b,c], 'right'), name: 'Ленин көч' }, 'ru'), 'Поверните направо');
  assert.equal(maneuverText({ ...step('turn', b, [b,c], 'right'), name: 'проспект Манаса' }, 'ru'), 'Поверните направо на проспект Манаса');
  assert.equal(maneuverText({ ...step('turn', b, [b,c], 'right'), name: 'улица Ленина' }, 'ru'), 'Поверните направо на улицу Ленина');
  assert.equal(maneuverText({ ...step('turn', b, [b,c], 'right'), name: 'улица Ленина' }, 'ky'), 'Оңго бурулуңуз');
});

test('Kyrgyz navigation chooses a Kyrgyz voice and speaks turns and distances in the selected language', () => {
  const voices = [{ identifier: 'ru', language: 'ru-RU' }, { identifier: 'ky', language: 'ky-KG' }];
  assert.equal(bestVoiceForLanguage(voices, 'ky'), 'ky');
  assert.equal(bestVoiceForLanguage(voices, 'ru'), 'ru');
  const instruction = maneuverText({ ...step('turn', b, [b, c], 'right'), name: 'Чүй проспекти' }, 'ky');
  assert.equal(instruction, 'Оңго бурулуңуз: Чүй проспекти');
  assert.equal(guidanceCue({ stepIndex: 1, instruction, arrived: false, maneuverDistance: 105 }, 'ky').text, '100 метрден кийин оңго бурулуңуз: Чүй проспекти.');
  assert.equal(guidanceCue({ stepIndex: 2, instruction, arrived: true, maneuverDistance: 0 }, 'ky').text, 'Бара турган жериңизге жеттиңиз.');
});
