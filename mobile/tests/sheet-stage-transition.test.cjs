const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class AnimatedValue {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
  interpolate(config) { return { source: this, config }; }
}

const exits = [];
const entries = [];
let deferEntry = false;
const native = {
  Animated: {
    Value: AnimatedValue,
    timing(value, config) {
      let stopped = false;
      return {
        start(done) {
          const finish = () => { if (!stopped) { value.setValue(config.toValue); done?.({ finished: true }); } };
          if (config.toValue === 0) exits.push(finish);
          else if (deferEntry) entries.push(finish);
          else finish();
        },
        stop() { stopped = true; },
      };
    },
  },
  Easing: { cubic: value => value, in: value => value, out: value => value },
  useWindowDimensions: () => ({ width: 412, height: 914 }),
};

const file = path.resolve(__dirname, '../src/useSheetStageTransition.ts');
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const loaded = {};
vm.runInNewContext(code, { exports: loaded, require(id) {
  if (id === 'react') return React;
  if (id === 'react-native') return native;
  if (id === './design/motion') return { useMotionPreference: () => false };
  if (id === './design/tokens') return { motion: { sheet: 320 } };
  throw Error(id);
} });

test('a replacement waits for the old review sheet to exit, then restores the previous sheet on close', async t => {
  exits.length = 0;
  let current, renderer, closed = 0;
  function Probe() { current = loaded.useSheetStageTransition('success'); return null; }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.equal(current.stage, 'success');
  await act(async () => current.navigate('rating'));
  assert.equal(current.stage, 'success', 'old content remains until its downward exit finishes');
  await act(async () => exits.shift()());
  assert.equal(current.stage, 'rating');
  await act(async () => current.navigate('success'));
  assert.equal(current.stage, 'rating');
  await act(async () => exits.shift()());
  assert.equal(current.stage, 'success');
  await act(async () => current.exit(() => { closed++; }));
  assert.equal(closed, 0, 'the parent remains mounted during final exit');
  await act(async () => exits.shift()());
  assert.equal(closed, 1);
});

test('an early successful review closes while its entry animation is still finishing', async t => {
  exits.length = 0; entries.length = 0; deferEntry = false;
  let current, renderer, closed = 0;
  function Probe() { current = loaded.useSheetStageTransition('success'); return null; }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => { deferEntry = false; entries.length = 0; await act(async () => renderer.unmount()); });
  deferEntry = true;
  await act(async () => current.navigate('rating'));
  await act(async () => exits.shift()());
  assert.equal(current.stage, 'rating');
  assert.equal(entries.length, 1, 'the review is still entering');
  await act(async () => current.exit(() => { closed++; }));
  assert.equal(closed, 0);
  await act(async () => exits.shift()());
  assert.equal(closed, 1, 'pending entry must not swallow the final close');
});
