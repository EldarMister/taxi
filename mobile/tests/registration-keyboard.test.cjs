const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
const { test } = require('node:test');
const assert = require('node:assert/strict');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('registration reveals focused fields and compensates only keyboard overlap left by adjustResize', async () => {
  const listeners = new Map(), frames = new Map(), calls = [];
  let serial = 0, height = 800;
  const input = { measureInWindow: callback => callback(0, 740, 80, 40) };
  const View = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ measureInWindow: callback => callback(0, 24, 320, height) }));
    return React.createElement('View', props, props.children);
  });
  const ScrollView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ getNativeScrollRef: () => ({ measureInWindow: callback => callback(0, 100, 320, height - 120) }), scrollTo: args => calls.push(args) }));
    return React.createElement('ScrollView', props, props.children);
  });
  const native = { View, ScrollView, KeyboardAvoidingView: 'KeyboardLayout', Platform: { OS: 'android' }, TextInput: { State: { currentlyFocusedInput: () => input } }, Keyboard: { addListener: (name, callback) => { listeners.set(name, callback); return { remove: () => listeners.delete(name) }; } } };
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/registration/RegistrationKeyboardLayout.tsx', 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, {
    module, exports: module.exports, require: function mockRequire(name) {
      if (name === 'react-native') return native;
      if (name === '../measureInScreen') {
        const helper = {};
        vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/measureInScreen.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: helper, require: mockRequire });
        return helper;
      }
      return require(name);
    },
    requestAnimationFrame: callback => { frames.set(++serial, callback); return serial; }, cancelAnimationFrame: id => frames.delete(id),
  });
  const { RegistrationKeyboardLayout, useRegistrationFieldFocus } = module.exports;
  function Field() { return React.createElement('Field', { onFocus: useRegistrationFieldFocus() }); }
  let renderer;
  const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  await act(async () => { renderer = create(React.createElement(RegistrationKeyboardLayout, { header: null, footer: 'Continue' }, React.createElement(Field))); });
  await act(async () => listeners.get('keyboardDidShow')({ endCoordinates: { screenY: 524 } }));
  assert.equal(renderer.root.findByType('KeyboardLayout').props.style.paddingBottom, 300);
  flush(); assert.ok(calls.at(-1).y >= 250); assert.equal(calls.at(-1).animated, true);
  height = 500;
  await act(async () => renderer.root.findAllByType('View').find(n => n.props.onLayout).props.onLayout());
  assert.equal(renderer.root.findByType('KeyboardLayout').props.style.paddingBottom, 0);
  await act(async () => renderer.root.findByType('Field').props.onFocus()); flush();
  assert.ok(calls.length >= 2);
  await act(async () => listeners.get('keyboardDidHide')());
  const before = calls.length;
  await act(async () => renderer.root.findByType('Field').props.onFocus()); flush(); assert.equal(calls.length, before);
  await act(async () => renderer.unmount()); assert.equal(listeners.size, 0);
});
