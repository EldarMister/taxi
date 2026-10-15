const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

test('Android measures screen coordinates in both activity and modal windows, preserving cutout offsets', () => {
  const calls = [], module = { exports: {} };
  const native = { Platform: { OS: 'android' }, findNodeHandle: view => view.tag, NativeModules: { AtlasNumberPicker: {
    measureOnScreen: (tag, callback) => callback(0, tag === 11 ? 104 : 24, 360, 700),
  } } };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/measureInScreen.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, require: () => native });
  const measure = module.exports.measureInScreen;
  measure({ tag: 11, measureInWindow: () => { throw Error('window coordinates would lose the cutout offset'); } }, (...frame) => calls.push(frame));
  measure({ tag: 12, measureInWindow: () => { throw Error('modal has its own screen offset'); } }, (...frame) => calls.push(frame));
  assert.deepEqual(calls, [[0, 104, 360, 700], [0, 24, 360, 700]]);
  assert.equal(Math.max(0, calls[0][1] + calls[0][3] - 600), 204);
  assert.equal(Math.max(0, calls[1][1] + calls[1][3] - 600), 124);
  native.Platform.OS = 'ios';
  measure({ measureInWindow: cb => cb(0, 10, 360, 700) }, (...frame) => calls.push(frame));
  assert.deepEqual(calls.at(-1), [0, 10, 360, 700]);
});
