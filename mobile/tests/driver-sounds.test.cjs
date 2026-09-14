const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', name + '.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Date, Set, require: id => load(id.replace('./', '')) });
  cache.set(name, exports); return exports;
}
const { DriverSoundEvents } = load('driverSoundEvents');
const now = Date.now();
const driver = { id: 'driver', role: 'DRIVER', notifications: true, driverProfile: { online: true } };
const offer = { id: 'order', status: 'SEARCHING', searchExpiresAt: new Date(now + 60000).toISOString() };
const assigned = { ...offer, status: 'ASSIGNED', driver, client: { id: 'passenger' } };
function setup() {
  const played = [], cancelled = []; let stopped = 0;
  const events = new DriverSoundEvents({ play: (...x) => played.push(x), cancel: x => cancelled.push(x), stop: () => stopped++ }, () => now);
  events.setUser(driver);
  return { events, played, cancelled, stopped: () => stopped };
}
test('offer sounds once across socket, polling and reconnection; removal cancels it', () => {
  const { events, played, cancelled } = setup();
  events.offers([offer], null); events.offers([{ ...offer }], null);
  assert.equal(played.length, 1); assert.equal(played[0][0], 'new-order');
  assert.equal(played[0][2], Date.parse(offer.searchExpiresAt));
  events.offers([], null); assert.ok(cancelled.includes('offer:order'));
  events.offers([offer], null); assert.equal(played.length, 1);
});
test('expired offers, offline drivers and drivers already on a trip do not ring', () => {
  const { events, played } = setup();
  events.offers([{ ...offer, searchExpiresAt: new Date(now - 1).toISOString() }], null);
  events.offers([offer], assigned);
  events.setUser({ ...driver, driverProfile: { online: false } }); events.offers([offer], null);
  assert.equal(played.length, 0);
});
test('only a fresh passenger message for the current trip speaks, once', () => {
  const { events, played } = setup();
  const message = { id: 'm', orderId: 'order', senderId: 'passenger', createdAt: new Date(now).toISOString() };
  events.message({ ...message, senderId: 'driver' }, assigned);
  events.message({ ...message, orderId: 'other' }, assigned);
  events.message({ ...message, createdAt: new Date(now - 31000).toISOString() }, assigned);
  events.message(message, { ...assigned, status: 'COMPLETED' });
  assert.equal(played.length, 0);
  events.message(message, assigned); events.message({ ...message }, assigned);
  assert.deepEqual(played.map(x => x[0]), ['passenger-message']);
});
test('completion speaks after a confirmed transition, never replaying a restored completed order', () => {
  const { events, played } = setup();
  const completed = { ...assigned, status: 'COMPLETED' };
  events.order(completed, null); assert.equal(played.length, 0);
  events.order(completed, { ...assigned, status: 'IN_PROGRESS' });
  events.order(completed, completed); events.order(completed, assigned);
  assert.deepEqual(played.map(x => x[0]), ['trip-completed']);
});
test('background, notification opt-out and account changes stop playback and fence events', () => {
  const { events, played, stopped } = setup();
  events.setForeground(false); events.offers([offer], null);
  events.setForeground(true); events.offers([offer], null);
  assert.equal(played.length, 0, 'OS-handled background offers must not ring again on resume');
  events.setUser({ ...driver, notifications: false }); events.offers([{ ...offer, id: 'muted' }], null);
  events.setUser({ id: 'client', role: 'CLIENT', notifications: true }); events.offers([{ ...offer, id: 'client-offer' }], null);
  assert.equal(played.length, 0); assert.ok(stopped() >= 3);
  events.setUser({ ...driver, id: 'second-driver' }); events.offers([offer], null);
  assert.equal(played.length, 1);
});

test('audio queue never overlaps, stops a skipped offer and releases finished players', async () => {
  const players = [], timers = new Map(); let timerId = 0;
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/native/driverSounds.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Date, setTimeout: (fn, delay) => { timers.set(++timerId, { fn, delay }); return timerId; }, clearTimeout: id => timers.delete(id), require: id => {
    if (id === '../driverSoundEvents') return { DriverSoundEvents };
    if (id === 'expo-audio') return {
      setAudioModeAsync: async () => {},
      createAudioPlayer: source => {
        const p = { source, playing: false, removed: false, addListener: (_, fn) => { p.finish = () => fn({ didJustFinish: true }); }, play: () => { assert.equal(players.some(x => x.playing), false); p.playing = true; }, pause: () => { p.playing = false; }, remove: () => { p.removed = true; } };
        players.push(p); return p;
      },
    };
    return id;
  } });
  const events = exports.driverSounds;
  events.setUser(driver); events.offers([offer], null);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(players.length, 1); assert.ok(players[0].playing);
  const message = { id: 'queued-message', orderId: 'order', senderId: 'passenger', createdAt: new Date().toISOString() };
  events.message(message, assigned);
  events.message({ ...message, id: 'burst-message' }, assigned);
  assert.equal(players.length, 1, 'message waits for the offer sound');
  events.stopOffer('order'); await Promise.resolve();
  assert.ok(players[0].removed); assert.equal(players.length, 2); assert.ok(players[1].playing);
  players[1].finish(); assert.ok(players[1].removed); assert.equal(timers.size, 0);
  events.offers([{ ...offer, id: 'new-offer' }], null); await Promise.resolve();
  assert.equal(players.length, 3);
  events.setForeground(false); assert.ok(players[2].removed); assert.equal(timers.size, 0);
});

test('bundled notification WAVs match native resources and new-order alert lasts twelve seconds', () => {
  for (const name of ['driver_new_order', 'driver_passenger_message', 'driver_trip_completed']) {
    const wav = fs.readFileSync(path.join(__dirname, '../assets/sounds', name + '.wav'));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    const seconds = wav.readUInt32LE(40) / wav.readUInt32LE(28);
    if (name === 'driver_new_order') assert.equal(seconds, 12);
    else assert.ok(seconds > 1 && seconds < 3);
    assert.deepEqual(wav, fs.readFileSync(path.join(__dirname, '../android/app/src/main/res/raw', name + '.wav')));
  }
});
