const { spawnSync } = require('node:child_process');
const { mkdirSync, copyFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const apiUrl = require('../config/api.cjs').resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, true);
const env = {
  ...process.env,
  EXPO_PUBLIC_API_URL: apiUrl,
  APP_ENV: 'production',
  NODE_ENV: 'production',
  ATLAS_PHONE_BUILD: '1',
  EXPO_NO_DOTENV: '1',
};
function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true, shell });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// A non-debuggable variant embeds Hermes/JS and uses a local testing certificate.
// Production signing and the release build remain separate.
run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android', '--no-install'], root);
run(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', [
  'assemblePhone',
  '-PreactNativeArchitectures=arm64-v8a,armeabi-v7a',
  '--console=plain',
  '--max-workers=2',
], path.join(root, 'android'), process.platform === 'win32');

const destination = path.join(root, 'builds', 'Atlas-Restaurant-2.0.0-phone.apk');
mkdirSync(path.dirname(destination), { recursive: true });
copyFileSync(path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'phone', 'app-phone.apk'), destination);
console.log(`Phone APK: ${destination}`);
