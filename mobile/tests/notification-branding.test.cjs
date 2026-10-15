const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const plugin = require('../plugins/with-notification-branding.cjs');
const root = path.resolve(__dirname, '..');

test('notification branding survives Android generation and keeps the provided logo bytes', t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-notification-branding-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith('atlas-notification-branding-'));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  plugin.writeResources(root, temporary);
  const original = fs.readFileSync(path.join(root, 'assets/logo1.png'));
  assert.ok(fs.readFileSync(path.join(temporary, 'app/src/main/res/drawable-nodpi/atlas_notification_logo.png')).equals(original));
  assert.ok(fs.readFileSync(path.join(root, 'android/app/src/main/res/drawable-nodpi/atlas_notification_logo.png')).equals(original));
  assert.equal(fs.readFileSync(path.join(temporary, 'app/src/main/res/drawable/atlas_notification_icon.xml'), 'utf8'),
    fs.readFileSync(path.join(root, 'android/app/src/main/res/drawable/atlas_notification_icon.xml'), 'utf8'));
});

test('Firebase and Expo use the Atlas mark; Expo cards load the original logo, with idempotent metadata', () => {
  const unrelated = { $: { 'android:name': 'other-setting', 'android:value': 'preserve' } };
  const application = { 'meta-data': [unrelated, { $: { 'android:name': 'com.google.firebase.messaging.default_notification_icon', 'android:resource': '@drawable/old' } }] };
  plugin.setMetadata(application); plugin.setMetadata(application);
  assert.equal(application['meta-data'].length, 4);
  assert.equal(application['meta-data'][0], unrelated);
  const resources = Object.fromEntries(application['meta-data'].slice(1).map(item => [item.$['android:name'], item.$['android:resource']]));
  assert.equal(resources['com.google.firebase.messaging.default_notification_icon'], '@drawable/atlas_notification_icon');
  assert.equal(resources['expo.modules.notifications.default_notification_icon'], '@drawable/atlas_notification_icon');
  assert.equal(resources['expo.modules.notifications.large_notification_icon'], '@drawable/atlas_notification_logo');
  const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  for (const [name, resource] of Object.entries(resources)) {
    assert.ok(manifest.includes(`android:name="${name}" android:resource="${resource}"`));
  }
  assert.match(fs.readFileSync(path.join(root, 'app.config.ts'), 'utf8'), /'\.\/plugins\/with-notification-branding.cjs'/);
});

test('the complete Expo plugin chain retains all notification logos in both variants', () => {
  const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
  for (const variant of ['client', 'driver']) {
    const result = spawnSync(process.execPath, [cli, 'config', '--type', 'introspect', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, APP_VARIANT: variant, APP_ENV: 'production', EXPO_NO_DOTENV: '1',
        EXPO_PUBLIC_API_URL: 'https://api-production-47be.up.railway.app/api' },
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.equal(config.android.package, variant === 'client' ? 'atlas.kg' : 'atlas.pro');
    const application = config._internal.modResults.android.manifest.manifest.application[0];
    const resources = Object.fromEntries(application['meta-data'].map(item => [item.$['android:name'], item.$['android:resource']]));
    assert.equal(resources['com.google.firebase.messaging.default_notification_icon'], '@drawable/atlas_notification_icon');
    assert.equal(resources['expo.modules.notifications.default_notification_icon'], '@drawable/atlas_notification_icon');
    assert.equal(resources['expo.modules.notifications.large_notification_icon'], '@drawable/atlas_notification_logo');
  }
});
