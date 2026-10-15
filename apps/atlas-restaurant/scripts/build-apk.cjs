const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('../config/api.cjs').resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, true);
const android = path.join(root, 'android');
if (!existsSync(android)) throw new Error('Run npm run native:generate -- --platform android, then configure the original release signing credentials.');
// Never silently publish a debug-signed release as an update to the existing app.
const gradleProperties = require('node:fs').readFileSync(path.join(android, 'gradle.properties'), 'utf8');
if (!/ATLAS_RELEASE_STORE_FILE/.test(gradleProperties) && !process.env.ORG_GRADLE_PROJECT_ATLAS_RELEASE_STORE_FILE) throw new Error('Configure ATLAS_RELEASE_* signing properties and release signingConfig, or use EAS with the existing project credentials.');
const buildGradle = require('node:fs').readFileSync(path.join(android, 'app/build.gradle'), 'utf8');
if (!/signingConfig\s+signingConfigs\.(release|atlasRelease)\b/.test(buildGradle)) throw new Error('Release signingConfig is not configured. Do not release a debug-signed application.');
const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['assembleRelease', '--console=plain'], { cwd: android, env: { ...process.env, APP_ENV: 'production', NODE_ENV: 'production' }, stdio: 'inherit', windowsHide: true, shell: process.platform === 'win32' });
if (result.status !== 0) process.exit(result.status || 1);
mkdirSync(path.join(root, 'builds'), { recursive: true });
copyFileSync(path.join(android, 'app/build/outputs/apk/release/app-release.apk'), path.join(root, 'builds/Atlas-Restaurant-2.0.0.apk'));
