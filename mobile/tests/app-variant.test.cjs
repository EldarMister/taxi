const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const binary = file => fs.readFileSync(path.join(root, file));
const {
  APP_VARIANTS,
  DEFAULT_CLIENT_EAS_PROJECT_ID,
  DEFAULT_DRIVER_EAS_PROJECT_ID,
  isRoleAllowed,
  resolveAppVariant,
  resolveAppVariantConfig,
  roleMismatchCopy,
} = require('../config/app-variant.cjs');
const {
  LOCAL_ANDROID_ARCHITECTURES,
  PHONE_RELEASE_ANDROID_ARCHITECTURES,
  resolveLocalAndroidArchitectures,
} = require('../config/android-build.cjs');

test('the absent APP_VARIANT remains the existing client application', () => {
  const resolved = resolveAppVariantConfig({}, file => file === './google-services.json');
  assert.equal(resolveAppVariant(), 'client');
  assert.equal(resolved.variant, 'client');
  assert.equal(resolved.identity.name, 'Atlas');
  assert.equal(resolved.identity.slug, 'taxi-go');
  assert.equal(resolved.identity.scheme, 'taxi-go');
  assert.equal(resolved.identity.androidPackage, 'kg.taxigo.app');
  assert.equal(resolved.identity.iosBundleIdentifier, 'kg.taxigo.app');
  assert.equal(resolved.identity.expectedRole, 'CLIENT');
  assert.equal(resolved.easProjectId, DEFAULT_CLIENT_EAS_PROJECT_ID);
  assert.equal(resolved.googleServicesFile, './google-services.json');
});

test('the driver build has an independent install identity and credentials', () => {
  const env = {
    APP_VARIANT: 'driver',
    EXPO_PUBLIC_DRIVER_EAS_PROJECT_ID: 'driver-project-id',
    DRIVER_GOOGLE_SERVICES_FILE: 'C:/secure/google-services.driver.json',
  };
  const resolved = resolveAppVariantConfig(env, file => file === env.DRIVER_GOOGLE_SERVICES_FILE);
  assert.equal(resolved.identity.name, 'Atlas pro');
  assert.equal(resolved.identity.slug, 'taxi-go-driver');
  assert.equal(resolved.identity.scheme, 'taxi-go-driver');
  assert.equal(resolved.identity.androidPackage, 'kg.taxigo.driver');
  assert.equal(resolved.identity.iosBundleIdentifier, 'kg.taxigo.driver');
  assert.equal(resolved.identity.expectedRole, 'DRIVER');
  assert.equal(resolved.easProjectId, 'driver-project-id');
  assert.equal(resolved.googleServicesFile, env.DRIVER_GOOGLE_SERVICES_FILE);
  assert.notEqual(APP_VARIANTS.client.androidPackage, APP_VARIANTS.driver.androidPackage);

  const defaults = resolveAppVariantConfig({ APP_VARIANT: 'driver' }, file => file === './google-services.driver.json');
  assert.equal(defaults.easProjectId, DEFAULT_DRIVER_EAS_PROJECT_ID);
  assert.equal(defaults.googleServicesFile, './google-services.driver.json');
});

test('invalid variants and incomplete production driver credentials fail before building', () => {
  assert.throws(() => resolveAppVariant('restaurant'), /client.*driver/);
  assert.throws(
    () => resolveAppVariantConfig({ APP_VARIANT: 'driver', APP_ENV: 'production' }),
    /DRIVER_GOOGLE_SERVICES_FILE/,
  );
  const complete = resolveAppVariantConfig(
    { APP_VARIANT: 'driver', APP_ENV: 'production' },
    file => file === './google-services.driver.json',
  );
  assert.equal(complete.easProjectId, DEFAULT_DRIVER_EAS_PROJECT_ID);
  assert.throws(
    () => resolveAppVariantConfig({ APP_VARIANT: 'client', CLIENT_GOOGLE_SERVICES_FILE: 'missing.json' }),
    /does not exist/,
  );
  const easEvaluation = resolveAppVariantConfig(
    { APP_VARIANT: 'driver', APP_ENV: 'production', EXPO_NO_DOTENV: '1', DRIVER_GOOGLE_SERVICES_FILE: '/eas/not-materialized-yet.json' },
    file => file === './google-services.driver.json',
  );
  assert.equal(easEvaluation.googleServicesFile, './google-services.driver.json');
});

test('each binary accepts only its own account role and explains a cleared mismatch', () => {
  assert.equal(isRoleAllowed('client', 'CLIENT'), true);
  assert.equal(isRoleAllowed('client', 'DRIVER'), false);
  assert.equal(isRoleAllowed('driver', 'DRIVER'), true);
  assert.equal(isRoleAllowed('driver', 'CLIENT'), false);
  assert.match(roleMismatchCopy('client', 'ru').message, /Atlas pro.*очищена/);
  assert.match(roleMismatchCopy('driver', 'ru').message, /клиентское приложение Atlas.*очищена/);
  assert.match(roleMismatchCopy('driver', 'ky').action, /номер/);
});

test('restore, synchronization and OTP handoff all enforce the role gate', () => {
  const app = read('App.tsx');
  const section = (start, end) => {
    const from = app.indexOf(start);
    assert.ok(from >= 0, start);
    const to = app.indexOf(end, from + start.length);
    assert.ok(to > from, end);
    return app.slice(from, to);
  };
  const rejection = section('async function rejectMismatchedRole', 'async function sync');
  const synchronization = section('async function sync', 'async function bootstrap');
  const bootstrap = section('async function bootstrap', 'useEffect(() => {');
  const login = section('async function login', 'const logout');
  assert.match(rejection, /isRoleAllowed\(profile\.role\)/);
  assert.match(rejection, /Promise\.allSettled\(\[api\.clear\(\), writeLastOrderId\(null\)\]\)/);
  assert.match(synchronization, /rejectMismatchedRole\(profile\)/);
  assert.match(bootstrap, /api\.restore\(\)[\s\S]*rejectMismatchedRole\(profile\)[\s\S]*updateUser\(profile\)/);
  assert.match(bootstrap, /shouldRestoreCompletedOrder\(last, profile\.role\)/);
  assert.match(login, /rejectMismatchedRole\(session\.user\)[\s\S]*api\.setTokens\(session\)[\s\S]*rejectMismatchedRole\(profile\)/);
  assert.match(app, /if \(wrongAppLanguage\)[\s\S]*<WrongAppScreen/);
});

test('completed order restoration uses the rating still owed by each role', () => {
  const source = read('App.tsx');
  const syntax = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const declaration = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'shouldRestoreCompletedOrder');
  assert.ok(declaration, 'restoration decision stays independently testable');
  const compiled = ts.transpileModule(`${declaration.getText(syntax)}\nexports.restore = shouldRestoreCompletedOrder;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {} };
  vm.runInNewContext(compiled, context);
  const restore = context.exports.restore;
  const completed = { status: 'COMPLETED', rating: 5, driverRating: null };
  assert.equal(restore(completed, 'DRIVER'), true, 'client feedback must not hide the driver rating prompt');
  assert.equal(restore(completed, 'CLIENT'), false, 'client already rated the driver');
  assert.equal(restore({ ...completed, rating: null, driverRating: 4 }, 'DRIVER'), false);
  assert.equal(restore({ ...completed, rating: null, driverRating: 4 }, 'CLIENT'), true);
  assert.equal(restore({ ...completed, status: 'CANCELLED', rating: null }, 'DRIVER'), false);
});

test('closing a trip fences late socket, sync, and rating responses for its order ID', () => {
  const source = read('App.tsx');
  const syntax = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const declaration = syntax.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isDismissedOrderUpdate');
  assert.ok(declaration);
  const compiled = ts.transpileModule(`${declaration.getText(syntax)}\nexports.ignore = isDismissedOrderUpdate;`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {} };
  vm.runInNewContext(compiled, context);
  const ignore = context.exports.ignore;
  const dismissed = new Set(['finished-trip']);
  for (const status of ['IN_PROGRESS', 'COMPLETED']) assert.equal(ignore({ id: 'finished-trip', status }, dismissed), true);
  assert.equal(ignore({ id: 'new-trip', status: 'ASSIGNED' }, dismissed), false, 'new active trips still work');
  assert.equal(ignore(null, dismissed), false, 'closing the current trip still works');
  assert.match(source, /const applyOrder = useCallback\([\s\S]*?isDismissedOrderUpdate\(next, dismissedOrderIds\.current\)/);
  const sync = source.slice(source.indexOf('async function sync()'), source.indexOf('async function bootstrap()'));
  assert.match(sync, /const currentActive = isDismissedOrderUpdate\(active, dismissedOrderIds\.current\) \? null : active/);
  assert.match(sync, /if \(currentActive\) applyOrder\(currentActive\)/);
  const done = source.slice(source.indexOf('const done ='), source.indexOf('const rate ='));
  assert.match(done, /if \(!current \|\| busyRef\.current\) return/);
  assert.match(done, /dismissedOrderIds\.current\.add\(current\.id\)[\s\S]*await writeLastOrderId\(null\)[\s\S]*applyOrder\(null\)/);
});

test('Expo, EAS and the checked-in Android project use the same build variant', () => {
  const expoConfig = read('app.config.ts');
  const runtime = read('src/appVariant.ts');
  const runner = read('scripts/run-app-variant.cjs');
  const gradle = read('android/app/build.gradle');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const eas = JSON.parse(read('eas.json'));
  assert.match(expoConfig, /resolveAppVariantConfig\(process\.env, existsSync\)/);
  assert.match(expoConfig, /appVariant: variant/);
  assert.match(expoConfig, /icon: variant === 'client' \? '\.\/assets\/logo\.png' : '\.\/assets\/edu-drive-icon\.png'/);
  assert.match(expoConfig, /adaptiveIcon: \{ foregroundImage: variant === 'client' \? '\.\/assets\/logo\.png' : '\.\/assets\/edu-drive-icon\.png'/);
  assert.match(runtime, /Constants\.expoConfig\?\.extra\?\.appVariant/);
  assert.match(runner, /APP_ENV: process\.env\.APP_ENV \|\| 'development'/);
  assert.match(gradle, /System\.getenv\("APP_VARIANT"\)/);
  assert.match(gradle, /taxiAppName = taxiAppVariant == "driver" \? "Atlas pro" : "Atlas"/);
  assert.match(gradle, /kg\.taxigo\.driver/);
  assert.match(gradle, /taxiAppVariant == "driver" \? "@drawable\/edu_drive_icon" : "@drawable\/edu_go_client_logo"/);
  assert.match(gradle, /taxiAppVariant == "driver" \? "@style\/Theme\.EduDrive\.SplashScreen" : "@style\/Theme\.EduGo\.SplashScreen"/);
  assert.match(manifest, /android:icon="\$\{taxiAppIcon\}"/);
  assert.match(gradle, /rename \{ "google-services\.json" \}/);
  assert.match(manifest, /\$\{taxiAppScheme\}/);
  assert.equal(eas.build.preview.env.APP_VARIANT, 'client');
  assert.equal(eas.build['preview-driver'].env.APP_VARIANT, 'driver');
  assert.equal(eas.build['apk-client'].env.APP_VARIANT, 'client');
  assert.equal(eas.build['apk-client'].env.APP_ENV, 'production');
  assert.equal(eas.build['apk-client'].environment, 'production');
  assert.equal(eas.build['apk-client'].android.buildType, 'apk');
  assert.equal(eas.build['apk-driver'].env.APP_VARIANT, 'driver');
  assert.equal(eas.build['apk-driver'].env.APP_ENV, 'production');
  assert.equal(eas.build['apk-driver'].environment, 'production');
  assert.equal(eas.build['apk-driver'].android.buildType, 'apk');
  assert.equal(eas.build.production.env.APP_VARIANT, 'client');
  assert.equal(eas.build['production-driver'].env.APP_VARIANT, 'driver');
});

test('local Android artwork and in-app branding use the new Atlas assets', () => {
  assert.ok(binary('android/app/src/main/res/drawable-nodpi/edu_go_client_logo.png').equals(binary('assets/logo.png')), 'client icon stays in sync');
  assert.ok(binary('android/app/src/main/res/drawable-nodpi/edu_drive_icon.png').equals(binary('assets/edu-drive-icon.png')), 'driver icon stays in sync');
  assert.match(read('android/app/src/main/res/drawable/edu_go_splash_background.xml'), /@drawable\/edu_go_client_logo/);
  assert.match(read('android/app/src/main/res/drawable/edu_drive_splash_background.xml'), /@drawable\/edu_drive_icon/);
  assert.match(read('src/ui.tsx'), /isDark \? require\('\.\.\/assets\/logo dark\.png'\) : require\('\.\.\/assets\/logo light\.png'\)/);
});

test('local Android debug builds support the emulator without widening phone releases', () => {
  assert.equal(resolveLocalAndroidArchitectures(['run:android']), LOCAL_ANDROID_ARCHITECTURES);
  assert.equal(resolveLocalAndroidArchitectures(['run:android', '--variant', 'debug']), 'arm64-v8a,x86_64');
  assert.equal(resolveLocalAndroidArchitectures(['run:android', '--variant=release']), PHONE_RELEASE_ANDROID_ARCHITECTURES);
  assert.equal(resolveLocalAndroidArchitectures(['run:android', '--variant', 'clientRelease']), 'arm64-v8a');
  assert.equal(resolveLocalAndroidArchitectures(['run:ios']), undefined);
  assert.equal(
    resolveLocalAndroidArchitectures(['run:android'], { ORG_GRADLE_PROJECT_reactNativeArchitectures: 'x86_64' }),
    'x86_64',
    'an explicit Gradle architecture override must win',
  );

  assert.match(read('android/gradle.properties'), /^reactNativeArchitectures=arm64-v8a$/m);
  assert.match(read('scripts/run-app-variant.cjs'), /ORG_GRADLE_PROJECT_reactNativeArchitectures/);
  assert.match(read('scripts/run-app-variant.cjs'), /'--app-id', APP_VARIANTS\[variant\]\.androidPackage/);
});
