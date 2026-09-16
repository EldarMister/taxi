const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('last-order writes finish in call order so dismissal survives a slow earlier save', async () => {
  let stored = null, finishSet;
  const operations = [];
  const secureStore = {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'device-only',
    getItemAsync: async () => stored,
    setItemAsync: async (_key, value) => {
      operations.push('set:start');
      await new Promise(resolve => { finishSet = resolve; });
      stored = value;
      operations.push('set:end');
    },
    deleteItemAsync: async () => { operations.push('delete'); stored = null; },
  };
  const compiled = ts.transpileModule(read('src/native/sessionStore.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: id => {
    assert.equal(id, 'expo-secure-store');
    return secureStore;
  } });
  const save = exports.writeLastOrderId('finished-trip');
  const dismiss = exports.writeLastOrderId(null);
  const readAfterDismiss = exports.readLastOrderId();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(operations, ['set:start']);
  finishSet();
  assert.equal(await readAfterDismiss, null);
  await Promise.all([save, dismiss]);
  assert.deepEqual(operations, ['set:start', 'set:end', 'delete']);
});

test('both production app variants configure MapLibre without a legacy map key', () => {
  const environment = { ...process.env, EXPO_NO_DOTENV: '1', APP_ENV: 'production', EXPO_PUBLIC_API_URL: 'https://api.example.org/api' };
  delete environment.EXPO_PUBLIC_YANDEX_MAPKIT_KEY;
  const result = spawnSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const path = require('node:path');
    const { getConfig } = require('@expo/config');
    const fixtureDirectory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'taxi-map-config-'));
    const fixture = path.join(fixtureDirectory, 'google-services.json');
    fs.writeFileSync(fixture, '{}');
    process.env.CLIENT_GOOGLE_SERVICES_FILE = fixture;
    process.env.DRIVER_GOOGLE_SERVICES_FILE = fixture;
    process.env.EXPO_PUBLIC_DRIVER_EAS_PROJECT_ID = '00000000-0000-4000-8000-000000000000';
    try {
      for (const variant of ['client', 'driver']) {
        process.env.APP_VARIANT = variant;
        const { exp } = getConfig(process.cwd());
        assert.equal(exp.android.package, variant === 'client' ? 'kg.taxigo.app' : 'kg.taxigo.driver');
        assert.equal(exp.newArchEnabled, false);
        const location=exp.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-location')[1];
        assert.equal(location.isAndroidBackgroundLocationEnabled,variant==='driver');
        assert.equal(location.isAndroidForegroundServiceEnabled,variant==='driver');
        assert.equal(location.isIosBackgroundLocationEnabled,variant==='driver');
        assert.ok(exp.plugins.includes('@maplibre/maplibre-react-native'));
        assert.equal(Object.hasOwn(exp.ios.infoPlist, 'YandexMapKitAPIKey'), false);
      }
    } finally {
      fs.unlinkSync(fixture);
      fs.rmdirSync(fixtureDirectory);
    }
  `], { cwd: root, env: environment, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const dependencies = JSON.parse(read('package.json')).dependencies;
  assert.equal(dependencies['@maplibre/maplibre-react-native'], '10.4.2');
  assert.equal(dependencies['react-native-yamap'], undefined);
});


test('driver avatar uses the system gallery without camera or broad storage permissions', () => {
  const config = read('app.config.ts');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const account = read('src/AccountScreens.tsx');
  assert.match(account, /user\.role !== 'DRIVER'/);
  assert.match(account, /launchImageLibraryAsync/);
  assert.doesNotMatch(account, /launchCameraAsync|Фотография — ссылка HTTPS/);
  assert.match(config, /cameraPermission: false/);
  for (const permission of ['CAMERA', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
    assert.match(config, new RegExp(`blockedPermissions:[\\s\\S]*android\\.permission\\.${permission}`));
    assert.match(manifest, new RegExp(`android\\.permission\\.${permission}[^>]+tools:node="remove"`));
  }
});

test('an ambiguous driver accept keeps the offer until authoritative reconciliation', () => {
  const app = read('App.tsx');
  const accept = app.slice(app.indexOf('const accept ='), app.indexOf('const skip ='));
  assert.doesNotMatch(accept, /finally\s*\{|setOffers\(/);
  assert.match(accept, /catch \(e\)[\s\S]*await sync\(\);[\s\S]*orderRef\.current\?\.id === offer\.id[\s\S]*throw e/);
});

test('foreground GPS uses a fast cached fix, precise fallback and keeps coordinates when geocoding fails', () => {
  const location = read('src/native/location.ts');
  const app = read('App.tsx');
  const map = read('src/native/TaxiMap.tsx');
  assert.match(location, /getLastKnownPositionAsync/);
  assert.match(location, /Location\.Accuracy\.High/);
  assert.match(location, /permission\.canAskAgain/);
  assert.match(location, /requestLocationAccess/);
  assert.match(location, /requestForegroundPermissionsAsync\(\)[\s\S]*getForegroundPermissionsAsync\(\)/);
  assert.match(location, /enableNetworkProviderAsync/);
  assert.match(app, /address: `GPS:/);
  assert.match(app, /await rememberPermissionStep\("notifications"\);\s*locateAfterPermissionGrant\(currentUser\)/);
  assert.match(app, /locationPermission\?\.granted[\s\S]*rememberPermissionStep\("notifications"\)/);
  assert.match(app, /showUserPosition=\{locationEnabled && !driver\}/);
  assert.match(map, /driverPosition \? 'Показать водителя' : 'Моё местоположение'/);
  assert.match(map, /await getCurrentPosition\(\)/);
  assert.doesNotMatch(app, /navigate-outline/, 'the old duplicate map control is gone');
  assert.match(app, /state === "active"[\s\S]*refreshLocationPermission/);
  assert.match(map, /showUserPosition && passengerView && <UserLocation visible=\{false\} onUpdate=/);
  assert.match(map, /client-user-position/);
  assert.doesNotMatch(map, /<UserLocation renderMode="native"/, 'the native puck must not paint a blue accuracy radius');
  assert.match(map, /useAnimatedCarPosition\(passengerView && driverPosition \? \{ \.\.\.driverPosition, heading: driverHeading \} : null, driverIdentity, carAnimationRoute\)/);
  assert.match(map, /trustedCarRoutePath\(previousRaw, point, from, roadRef\.current, fixInterval\)/);
  assert.match(map, /trustedCarDirectPath\(previousRaw, point, from, fixInterval\)/);
  assert.doesNotMatch(map, /roadPosition\(/, 'the passenger car cannot snap onto another route segment');
  assert.doesNotMatch(map, /<MarkerView/, 'the client car stays in MapLibre geography during camera gestures');
  assert.doesNotMatch(map, /<ShapeSource id="driver-accuracy"/);
});

test('permission onboarding gates automatic push registration and persists each account flow', () => {
  const app = read('App.tsx');
  const store = read('src/native/sessionStore.ts');
  assert.match(app, /permissionStep === "done"/);
  assert.match(app, /getNotificationPermissionState/);
  assert.match(app, /<PermissionOnboarding/);
  assert.match(store, /taxi\.permissionIntro\.v1\.\$\{userId\}/);
});

test('Android auth and chat explicitly keep focused inputs above the keyboard', () => {
  const auth = read('src/AuthScreen.tsx');
  const overlays = read('src/Overlays.tsx');
  assert.match(auth, /<KeyboardAvoidingView[^>]+behavior="padding"/);
  assert.match(auth, /keyboardDismissMode=\{Platform\.OS === 'ios' \? 'interactive' : 'on-drag'\}/);
  assert.match(overlays, /<KeyboardAvoidingView[^>]+behavior="padding"/);
  assert.match(overlays, /<ScrollView[\s\S]*style=\{\{ flex: 1 \}\}[\s\S]*keyboardShouldPersistTaps="handled"/);
});


test('OSM map selects addresses and displays only OSRM road geometry', () => {
  const app = read('App.tsx');
  const map = read('src/native/TaxiMap.tsx');
  const routes = read('src/tripMapRoutes.ts');
  const style = read('src/native/taxiMapStyle.ts');
  const base = JSON.parse(read('src/native/openfreemap-bright.json'));
  assert.match(map, /@maplibre\/maplibre-react-native/);
  assert.match(map, /mapStyleForLanguage/);
  assert.match(style, /EXPO_PUBLIC_MAP_STYLE_URL/);
  assert.equal(base.sources.openmaptiles.type, 'vector');
  assert.match(map, /<ShapeSource id="route" shape=\{routeShape\}/);
  assert.match(map, /onPress=\{selectFeature\}/);
  assert.match(map, /onLongPress=\{selectFeature\}/);
  assert.match(map, /api\.request<[^>]+>\('\/routes'/);
  assert.match(map, /OpenStreetMap contributors/);
  assert.match(app, /tripMapRoutes\(\{ driver, order, offer, quote/);
  assert.match(routes, /routeProvider === 'osrm'/);
  assert.match(map, /<ShapeSource id="approach-route" shape=\{approachShape\}/);
  assert.doesNotMatch(map, /react-native-yamap|findDrivingRoutes/);
});
