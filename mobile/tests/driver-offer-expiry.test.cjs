const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function setup(t, offerFactory = now => ({ id: 'first', searchExpiresAt: new Date(now + 30_000).toISOString() })) {
  let now = 1_000_000;
  let sequence = 0;
  let renderer;
  const clocks = [], timers = new Map(), listeners = new Set();
  class Clock extends Date { static now() { return now; } }
  const AppState = { addEventListener(event, listener) {
    assert.equal(event, 'change');
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  } };
  const exports = {};
  const source = fs.readFileSync(require.resolve('../src/useDriverOfferExpiry.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, Date: Clock,
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === 'react') return React;
      if (id === 'react-native') return { AppState };
      throw Error(`Unexpected dependency ${id}`);
    },
  });
  const onClock = value => clocks.push(value);
  const Offer = ({ offer }) => { exports.useDriverOfferExpiry(offer, onClock); return null; };
  let offer = offerFactory(now);
  await act(async () => { renderer = create(React.createElement(Offer, { offer })); });
  t.after(async () => act(async () => renderer.unmount()));
  return {
    clocks, timers, listeners,
    get now() { return now; },
    setNow: value => { now = value; },
    async update(value) { offer = value; await act(async () => renderer.update(React.createElement(Offer, { offer }))); },
    async emit(state) { await act(async () => { for (const listener of [...listeners]) listener(state); }); },
    async advance(ms) {
      now += ms;
      await act(async () => {
        for (const [id, timer] of [...timers]) {
          if (timer.at <= now) { timers.delete(id); timer.callback(); }
        }
      });
    },
    async wakeEarly() {
      const [id, timer] = [...timers][0];
      timers.delete(id);
      await act(async () => timer.callback());
    },
    async unmount() { await act(async () => renderer.unmount()); },
  };
}

test('the current server deadline expires an offer between global clock ticks without restarting on render', async t => {
  const h = await setup(t, now => ({ id: 'next-driver', searchExpiresAt: new Date(now + 12_345).toISOString(), createdAt: new Date(now - 60_000).toISOString() }));
  assert.equal([...h.timers.values()][0].delay, 12_345, 'uses the remaining server time rather than another 30 seconds or original creation time');
  await h.advance(12_344);
  assert.deepEqual(h.clocks, []);
  const timerId = [...h.timers.keys()][0];
  await h.update({ id: 'next-driver', searchExpiresAt: new Date(1_012_345).toISOString() });
  assert.equal([...h.timers.keys()][0], timerId, 'rerendering an equivalent offer leaves the timer intact');
  await h.advance(1);
  assert.deepEqual(h.clocks, [1_012_345]);
  assert.equal(h.timers.size, 0);
});

test('foreground resume resyncs immediately after suspended expiry and retains the deadline before expiry', async t => {
  const h = await setup(t);
  await h.advance(5_000);
  await h.emit('background');
  assert.deepEqual(h.clocks, []);
  await h.emit('active');
  assert.deepEqual(h.clocks, [1_005_000]);
  assert.equal([...h.timers.values()][0].delay, 25_000);
  h.setNow(1_037_000);
  await h.emit('active');
  assert.deepEqual(h.clocks, [1_005_000, 1_037_000]);
  assert.equal(h.timers.size, 0, 'the expired background timer cannot fire again');
});

test('replacing an offer or deadline cancels obsolete timers and fences queued callbacks', async t => {
  const h = await setup(t);
  const obsolete = [...h.timers.values()][0].callback;
  await h.update({ id: 'second', searchExpiresAt: new Date(h.now + 7_000).toISOString() });
  assert.equal(h.listeners.size, 1);
  assert.equal(h.timers.size, 1);
  await act(async () => obsolete());
  assert.deepEqual(h.clocks, []);
  assert.equal(h.timers.size, 1);
  await h.update({ id: 'second', searchExpiresAt: new Date(h.now + 9_000).toISOString() });
  await h.advance(7_000);
  assert.deepEqual(h.clocks, []);
  await h.advance(2_000);
  assert.deepEqual(h.clocks, [1_009_000]);
});

test('an early timer wake rechecks wall time and waits until the authoritative expiry', async t => {
  const h = await setup(t);
  h.setNow(h.now + 10_000);
  await h.wakeEarly();
  assert.deepEqual(h.clocks, []);
  assert.equal([...h.timers.values()][0].delay, 20_000);
  await h.advance(20_000);
  assert.deepEqual(h.clocks, [1_030_000]);
});

test('expired offers resync immediately while missing or invalid deadlines never invent a timeout', async t => {
  const h = await setup(t, now => ({ id: 'expired', searchExpiresAt: new Date(now - 1).toISOString() }));
  assert.deepEqual(h.clocks, [1_000_000]);
  assert.equal(h.timers.size, 0);
  for (const offer of [undefined, { id: 'missing' }, { id: 'invalid', searchExpiresAt: 'invalid' }]) {
    await h.update(offer);
    assert.equal(h.timers.size, 0);
    assert.equal(h.listeners.size, 0);
  }
  assert.deepEqual(h.clocks, [1_000_000]);
});

test('unmount removes timers and foreground listeners without delivering stale updates', async t => {
  const h = await setup(t);
  const timer = [...h.timers.values()][0].callback;
  const foreground = [...h.listeners][0];
  await h.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  h.setNow(h.now + 40_000);
  await act(async () => { timer(); foreground('active'); });
  assert.deepEqual(h.clocks, []);
});
