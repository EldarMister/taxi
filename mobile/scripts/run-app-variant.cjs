const { spawnSync } = require('node:child_process');
const { APP_VARIANTS, resolveAppVariant } = require('../config/app-variant.cjs');
const { resolveLocalAndroidArchitectures } = require('../config/android-build.cjs');

const [requestedVariant, ...expoArguments] = process.argv.slice(2);
const variant = resolveAppVariant(requestedVariant);
if (!expoArguments.length) {
  throw new Error('Pass an Expo command after the app variant.');
}

const androidArchitectures = resolveLocalAndroidArchitectures(expoArguments, process.env);
const launchArguments = expoArguments[0] === 'run:android' && !expoArguments.some(argument => argument === '--app-id' || argument.startsWith('--app-id='))
  ? [...expoArguments, '--app-id', APP_VARIANTS[variant].androidPackage]
  : expoArguments;
const childEnvironment = {
  ...process.env,
  APP_VARIANT: variant,
  APP_ENV: process.env.APP_ENV || 'development',
  ...(androidArchitectures ? { ORG_GRADLE_PROJECT_reactNativeArchitectures: androidArchitectures } : {}),
};

const result = spawnSync(process.execPath, [require.resolve('expo/bin/cli'), ...launchArguments], {
  cwd: process.cwd(),
  // Local start/run/prebuild commands must not accidentally inherit APP_ENV
  // from a release-oriented .env file that Expo loads after this wrapper.
  // An explicitly exported APP_ENV still wins when a production prebuild is
  // genuinely intended; EAS release profiles bypass this wrapper entirely.
  // Local debug APKs contain both modern phone and x86_64 emulator libraries.
  // Release variants and EAS builds retain the ARM64 default from gradle.properties.
  env: childEnvironment,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
