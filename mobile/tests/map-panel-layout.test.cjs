const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compiled = ts.transpileModule(fs.readFileSync(require.resolve('../src/MapPanelLayout.tsx'), 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const exportsForTest = {};
vm.runInNewContext(compiled, { exports: exportsForTest, require: id => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id);
  if (id === 'react-native-reanimated') return { useSharedValue: initial => {
    const ref = React.useRef();
    if (!ref.current) { let value=initial; ref.current={ get:()=>value, set:next=>{value=next;} }; }
    return ref.current;
  } };
  throw Error(id);
} });

test('offer measurements are scoped to their order and late callbacks cannot resize a newer offer', async t => {
  let current, mounts=0, renderer;
  function Map() { React.useEffect(()=>{ mounts++; },[]); return React.createElement('Map'); }
  const element = session => React.createElement(exportsForTest.MapPanelLayout, { session }, layout => { current=layout; return React.createElement(Map); });
  await act(async()=>{ renderer=create(element('idle')); });
  t.after(async()=>act(async()=>renderer.unmount()));
  assert.equal(current.ready,false);
  const oldCallback=current.onHeight;
  await act(async()=>oldCallback(600));
  assert.equal(current.height,600);
  await act(async()=>renderer.update(element('offer-1')));
  assert.equal(current.ready,false);
  assert.equal(current.height,0,'an incoming offer cannot inherit an expanded idle or previous panel');
  await act(async()=>oldCallback(700));
  assert.equal(current.height,0);
  const firstOfferCallback=current.onHeight;
  await act(async()=>firstOfferCallback(280));
  assert.equal(current.height,280);
  assert.equal(current.ready,true);
  await act(async()=>renderer.update(element('offer-2')));
  assert.equal(current.height,0);
  await act(async()=>firstOfferCallback(650));
  assert.equal(current.height,0);
  await act(async()=>renderer.update(element('offer-1')));
  await act(async()=>firstOfferCallback(650));
  assert.equal(current.height,0,'even a reused order ID rejects callbacks from an earlier instance');
  await act(async()=>current.onHeight(290));
  assert.equal(current.height,290);
  assert.equal(mounts,1,'changing offers does not remount the native map');
});

test('returning from another page starts with an unmeasured panel and a fresh animated inset', async () => {
  let current, renderer;
  const element=()=>React.createElement(exportsForTest.MapPanelLayout,{session:'offer'},layout=>{current=layout;return React.createElement('Map');});
  await act(async()=>{renderer=create(element());});
  await act(async()=>current.onHeight(650)); current.animatedInset.set(650);
  const previous=current;
  await act(async()=>renderer.unmount());
  await act(async()=>{renderer=create(element());});
  assert.equal(current.height,0);
  assert.equal(current.ready,false);
  assert.equal(current.animatedInset.get(),0);
  assert.notEqual(current.animatedInset,previous.animatedInset);
  await act(async()=>previous.onHeight(700));
  assert.equal(current.height,0);
  await act(async()=>current.onHeight(NaN)); assert.equal(current.height,0);
  await act(async()=>renderer.unmount());
});
