const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(require.resolve('../src/auth/endSession.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: exportsObject, setTimeout, clearTimeout });
const { endSession } = exportsObject;

test('sign-out clears local credentials when network cleanup fails', async () => {
  const calls = [];
  await endSession({ unregister: async () => { calls.push('push'); throw Error('offline'); }, revoke: async () => { calls.push('revoke'); throw Error('offline'); }, clear: async () => calls.push('clear') });
  assert.deepEqual(calls, ['push', 'revoke', 'clear']);
});
test('a hanging cleanup cannot prevent local sign-out', async () => {
  let cleared = 0, revoked = 0;
  await endSession({ unregister: () => new Promise(() => {}), revoke: async () => { revoked++; }, clear: async () => { cleared++; }, timeoutMs: 5 });
  assert.equal(cleared, 1);
  assert.equal(revoked, 1);
});
test('successful sign-out waits for cleanup before clearing once', async () => {
  let detach;
  const calls = [];
  const pending = endSession({ unregister: () => new Promise(resolve => { detach = resolve; }), revoke: async () => calls.push('revoke'), clear: async () => calls.push('clear') });
  await Promise.resolve();
  assert.deepEqual(calls, ['revoke']);
  detach();
  await pending;
  assert.deepEqual(calls, ['revoke', 'clear']);
});

test('the real drawer logout remains available while another app operation is busy', async () => {
  const source=fs.readFileSync(require.resolve('../App.tsx'),'utf8');
  const handler=source.slice(source.indexOf('  const logout = async () => {'),source.indexOf('  const online ='));
  const calls=[], output={}, logoutRef={current:false};
  const context={exports:output,logoutRef,busyRef:{current:true},endSession,
    run:()=>{throw Error('Logout must not use the busy operation gate');},
    setDrawer:value=>calls.push(['drawer',value]),
    unregisterPushNotifications:async()=>{},
    api:{getTokens:()=>({refreshToken:'test-session'}),post:async(path,body)=>calls.push([path,body.refreshToken]),clear:async()=>calls.push(['clear'])},
    writeLastOrderId:async()=>{},markManualPickup:()=>{},clearQuotes:()=>{},clearDeliveryQuotes:()=>{},emptyRideDetails:{},emptyDeliveryDetails:{},
    ...Object.fromEntries(['setPermissionStep','setPermissionError','setPermissionNeedsSettings','setPickup','setDropoff','setRideDetails','setDeliveryDetails'].map(name=>[name,()=>{}]))};
  vm.runInNewContext(handler+'exports.logout=logout;',context);
  await Promise.all([output.logout(),output.logout()]);
  assert.deepEqual(calls,[['drawer',false],['/auth/logout','test-session'],['clear']]);
  assert.equal(logoutRef.current,false);
});
