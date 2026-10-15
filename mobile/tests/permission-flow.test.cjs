const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(compile(read(file)), { exports, require: id => {
    if (id in dependencies) return dependencies[id];
    throw Error(`Unexpected dependency ${id} in ${file}`);
  } });
  return exports;
}
const flow = load('src/permissionFlow.ts');
const plain = value => JSON.parse(JSON.stringify(value));

test('the client has notifications then location; the driver includes overlay and battery in the requested order', () => {
  assert.deepEqual(plain(flow.permissionSteps('CLIENT')), ['notifications', 'location']);
  assert.deepEqual(plain(flow.permissionSteps('DRIVER')), ['notifications', 'overlay', 'location', 'battery']);
  assert.equal(flow.nextPermissionStep('notifications', 'CLIENT'), 'location');
  assert.equal(flow.nextPermissionStep('location', 'CLIENT'), 'done');
  assert.equal(flow.nextPermissionStep('notifications', 'DRIVER'), 'overlay');
  assert.equal(flow.nextPermissionStep('overlay', 'DRIVER'), 'location');
  assert.equal(flow.nextPermissionStep('location', 'DRIVER'), 'battery');
  assert.equal(flow.nextPermissionStep('battery', 'DRIVER'), 'done');
  assert.equal(flow.savedPermissionStep('overlay', 'CLIENT'), 'notifications');
  assert.equal(flow.savedPermissionStep('battery', 'CLIENT'), 'notifications');
});

function storage() {
  const values = new Map();
  const secure = {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => { values.set(key, value); },
    deleteItemAsync: async key => { values.delete(key); },
  };
  return { values, api: load('src/native/sessionStore.ts', { 'expo-secure-store': secure, '../permissionFlow': flow }) };
}

test('new and unfinished legacy accounts start at notifications; completed accounts preserve their result', async () => {
  const { api, values } = storage();
  assert.equal(await api.readPermissionIntro('new', 'CLIENT'), 'notifications');
  assert.equal(await api.readPermissionIntro('new', 'DRIVER'), 'notifications');
  for (const oldStep of ['location', 'notifications', 'done']) {
    values.set('taxi.permissionIntro.v1.old', oldStep);
    assert.equal(await api.readPermissionIntro('old', 'CLIENT'), oldStep === 'done' ? 'done' : 'notifications');
  }
});

test('saved client and driver progress stays separate and cannot introduce a driver screen into the client', async () => {
  const { api } = storage();
  await api.writePermissionIntro('same', 'overlay', 'DRIVER');
  await api.writePermissionIntro('same', 'location', 'CLIENT');
  assert.equal(await api.readPermissionIntro('same', 'DRIVER'), 'overlay');
  assert.equal(await api.readPermissionIntro('same', 'CLIENT'), 'location');
  await api.writePermissionIntro('same', 'battery', 'CLIENT');
  assert.equal(await api.readPermissionIntro('same', 'CLIENT'), 'notifications');
});

test('account deletion clears both new flow records and prevents queued writes from restoring them', async () => {
  const { api, values } = storage();
  values.set('taxi.permissionIntro.v1.deleted', 'done');
  await api.writePermissionIntro('deleted', 'location', 'CLIENT');
  await api.writePermissionIntro('deleted', 'battery', 'DRIVER');
  const pending = api.writePermissionIntro('deleted', 'done', 'DRIVER');
  await api.clearPermissionIntro('deleted');
  await pending;
  await api.writePermissionIntro('deleted', 'done', 'CLIENT');
  assert.equal([...values.keys()].some(key => key.endsWith('.deleted')), false);
});

function system(os = 'android', nativeModule) {
  return load('src/native/systemPermissions.ts', { 'react-native': { Platform: { OS: os }, NativeModules: nativeModule ? { AtlasSystemPermissions: nativeModule } : {} } });
}

test('system settings availability never masquerades as an Android grant', async () => {
  const missing = system();
  await assert.rejects(missing.getSystemPermissionState('overlay'), /Обновите приложение/);
  await assert.rejects(missing.openSystemPermissionSettings('battery'), /Обновите приложение/);
  for (const os of ['ios', 'web']) {
    assert.deepEqual(plain(await system(os).getSystemPermissionState('overlay')), { granted: false, canAskAgain: false, supported: false });
  }
});

test('the native overlay and global battery state are re-read independently of opening settings', async () => {
  let overlay = false, battery = false;
  const opened = [];
  const native = system('android', {
    canDrawOverlays: async () => overlay,
    isBatterySaverDisabled: async () => battery,
    openOverlaySettings: async () => opened.push('overlay'),
    openBatterySaverSettings: async () => opened.push('battery'),
  });
  const permissions = load('src/native/onboardingPermissions.ts', {
    './systemPermissions': native, './location': {}, './push': {},
  });
  assert.equal((await permissions.requestOnboardingPermission('overlay')).granted, false);
  assert.equal((await permissions.requestOnboardingPermission('battery')).granted, false);
  assert.deepEqual(opened, ['overlay', 'battery']);
  assert.equal((await permissions.getOnboardingPermissionState('overlay')).granted, false);
  overlay = true; battery = true;
  assert.equal((await permissions.getOnboardingPermissionState('overlay')).granted, true);
  assert.equal((await permissions.getOnboardingPermissionState('battery')).granted, true);
});

test('prebuild installs the native settings module for the selected Android package and registers it once', async t => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-permission-plugin-'));
  t.after(() => {
    const target = path.resolve(temporaryDirectory);
    assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(target).startsWith('atlas-permission-plugin-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  let dangerousMod, applicationMod;
  const module = { exports: {} };
  vm.runInNewContext(read('plugins/with-system-permissions.cjs'), {
    module, __dirname: path.join(root, 'plugins'), require: id => {
      if (id === 'node:fs') return fs;
      if (id === 'node:path') return path;
      if (id === '@expo/config-plugins') return {
        withDangerousMod: (config, [, callback]) => { dangerousMod = callback; return config; },
        withMainApplication: (config, callback) => { applicationMod = callback; return config; },
      };
      throw Error(`Unexpected plugin dependency ${id}`);
    },
  });
  for (const packageName of ['atlas.kg', 'atlas.pro']) {
    module.exports({ android: { package: packageName } });
    await dangerousMod({ android: { package: packageName }, modRequest: { platformProjectRoot: temporaryDirectory } });
    const native = fs.readFileSync(path.join(temporaryDirectory, 'app/src/main/java', ...packageName.split('.'), 'AtlasSystemPermissionsPackage.kt'), 'utf8');
    assert.ok(native.startsWith(`package ${packageName}\n`));
    const config = { modResults: { language: 'kt', contents: 'PackageList(this).packages.apply {\n}' } };
    applicationMod(config); applicationMod(config);
    assert.equal(config.modResults.contents.match(/add\(AtlasSystemPermissionsPackage\(\)\)/g).length, 1);
  }
  assert.equal(read('plugins/system-permissions/AtlasSystemPermissionsPackage.kt'), read('android/app/src/main/java/kg/taxigo/app/AtlasSystemPermissionsPackage.kt'));
});

// Execute the actual App permission handlers/effect with React state. Other
// account/map logic is outside this fixture; permission transitions are not mocked.
const appSource = read('App.tsx');
const rememberSource = appSource.slice(appSource.indexOf('  const rememberPermissionStep ='), appSource.indexOf('  const locateAfterPermissionGrant ='));
const handlerSource = appSource.slice(appSource.indexOf('  const completePermissionStep ='), appSource.indexOf('  const locate = () =>'));
assert.ok(rememberSource.length && handlerSource.length);

async function renderFlow(t, options = {}) {
  const role = options.role ?? 'CLIENT';
  const states = Object.fromEntries(flow.permissionSteps(role).map(step => [step, { granted: false, canAskAgain: step === 'location' || step === 'notifications', supported: true, ...(step === 'location' ? { servicesEnabled: true } : {}) }]));
  const opened = [], saved = [], requests = [], locations = [], patches = [];
  const source = `
    import React, { useEffect, useRef, useState } from 'react';
    import { nextPermissionStep } from './permissionFlow';
    import { getOnboardingPermissionState, requestOnboardingPermission, openOnboardingPermissionSettings } from './onboardingPermissions';
    import { writePermissionIntro, api, registerPushNotifications, options, saved, locations } from './boundaries';
    export function Screen() {
      const [user, setUser] = useState({ id: 'account', role: options.role, notifications: false });
      const userRef = useRef(user);
      const updateUser = next => { userRef.current = next; setUser(next); };
      const [permissionStep, setPermissionStep] = useState(options.step || 'notifications');
      const [permissionBusy, setPermissionBusy] = useState(false);
      const permissionBusyRef = useRef(false);
      const permissionRefreshPending = useRef(false);
      const [permissionRefreshVersion, setPermissionRefreshVersion] = useState(0);
      const [permissionError, setPermissionError] = useState('');
      const [permissionNeedsSettings, setPermissionNeedsSettings] = useState(false);
      const [locationPermission, setLocationPermission] = useState(null);
      const locationPermissionVersion = useRef(0);
      const [availabilityRetry, setAvailabilityRetry] = useState(0);
      const permissionRole = options.role;
      const messageOf = e => e.message;
      const setError = setPermissionError;
      const locateAfterPermissionGrant = user => { locations.push(user.id); };
      ${rememberSource}
      ${handlerSource}
      return React.createElement('Screen', { step: permissionStep, busy: permissionBusy, error: permissionError, locationPermission,
        allow: allowPermission, skip: skipPermission, resume: () => setAvailabilityRetry(value => value + 1),
        logout: () => { userRef.current = null; setUser(null); }
      });
    }
  `;
  const exports = {};
  vm.runInNewContext(compile(source), { exports, require: id => {
    if (id === 'react') return React;
    if (id === './permissionFlow') return flow;
    if (id === './onboardingPermissions') return {
      getOnboardingPermissionState: async step => ({ ...states[step] }),
      requestOnboardingPermission: async step => { requests.push(step); if (options.requestError) throw options.requestError; return { ...states[step] }; },
      openOnboardingPermissionSettings: async step => { opened.push(step); if (options.openSettings) await options.openSettings(); },
    };
    if (id === './boundaries') return {
      options: { ...options, role }, locations, saved,
      writePermissionIntro: async (account, step, role) => { if (options.save) await options.save(); saved.push([account, step, role]); },
      api: { patch: async (_path, patch) => { patches.push(patch); return { id: 'account', role, ...patch }; } },
      registerPushNotifications: () => Promise.resolve(),
    };
    throw Error(`Unexpected ${id}`);
  } });
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.Screen)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const props = () => renderer.root.findByType('Screen').props;
  const call = async action => { await act(async () => { await props()[action](); }); };
  return { states, opened, saved, requests, locations, patches, props, call };
}

test('returning from notification settings leaves denial on screen and advances only after an actual grant', async t => {
  const h = await renderFlow(t);
  h.states.notifications.canAskAgain = false;
  await h.call('resume');
  await h.call('allow');
  assert.deepEqual(h.opened, ['notifications']);
  assert.equal(h.props().step, 'notifications');
  assert.equal(h.saved.length, 0);
  await h.call('resume');
  assert.equal(h.props().step, 'notifications');
  h.states.notifications.granted = true;
  await h.call('resume');
  assert.equal(h.props().step, 'location');
  assert.deepEqual(plain(h.patches), [{ notifications: true }]);
});

test('location grant completes the client even while GPS is unavailable; skipped notifications remain disabled', async t => {
  const h = await renderFlow(t);
  await h.call('skip');
  assert.equal(h.props().step, 'location');
  h.states.location.granted = true;
  h.states.location.servicesEnabled = false;
  await h.call('resume');
  assert.equal(h.props().step, 'done');
  assert.equal(h.props().locationPermission.granted, true);
  assert.deepEqual(h.locations, ['account']);
  assert.deepEqual(h.patches, []);
});

test('a failing native permission request keeps the notification screen retryable without saving completion', async t => {
  const h = await renderFlow(t, { requestError: Error('Permission provider temporarily unavailable') });
  await h.call('allow');
  assert.equal(h.props().step, 'notifications');
  assert.match(h.props().error, /temporarily unavailable/);
  assert.equal(h.saved.length, 0);
  assert.equal(h.props().busy, false);
});

test('a quick settings return during a slow native launch queues an OS recheck after the button becomes idle', async t => {
  let finishOpening;
  const h = await renderFlow(t, { openSettings: () => new Promise(resolve => { finishOpening = resolve; }) });
  h.states.notifications.canAskAgain = false;
  await h.call('resume');
  let opening;
  await act(async () => { opening = h.props().allow(); });
  assert.equal(h.props().busy, true);
  h.states.notifications.granted = true;
  await h.call('resume');
  assert.equal(h.props().step, 'notifications');
  await act(async () => { finishOpening(); await opening; });
  assert.equal(h.props().step, 'location');
  assert.equal(h.props().busy, false);
});

test('finishing a slow permission write after logout cannot change the current account screen', async t => {
  let finishSave;
  const h = await renderFlow(t, { save: () => new Promise(resolve => { finishSave = resolve; }) });
  let advancing;
  await act(async () => { advancing = h.props().skip(); });
  await h.call('logout');
  await act(async () => { finishSave(); await advancing; });
  assert.equal(h.props().step, 'notifications');
  assert.equal(h.props().busy, false);
});

test('driver settings buttons and returning without changing them cannot advance either system step', async t => {
  const h = await renderFlow(t, { role: 'DRIVER' });
  await h.call('skip');
  assert.equal(h.props().step, 'overlay');
  await h.call('allow');
  await h.call('resume');
  assert.equal(h.props().step, 'overlay');
  assert.deepEqual(h.opened, ['overlay']);
  h.states.overlay.granted = true;
  await h.call('resume');
  assert.equal(h.props().step, 'location');
  await h.call('skip');
  assert.equal(h.props().step, 'battery');
  await h.call('allow');
  await h.call('resume');
  assert.equal(h.props().step, 'battery');
  h.states.battery.granted = true;
  await h.call('resume');
  assert.equal(h.props().step, 'done');
  assert.deepEqual(h.saved.map(value => value[1]), ['overlay', 'location', 'battery', 'done']);
});
