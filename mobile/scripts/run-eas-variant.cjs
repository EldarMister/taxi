const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { APP_VARIANTS, resolveAppVariant } = require('../config/app-variant.cjs');

const [requestedVariant, ...argumentsForEas] = process.argv.slice(2);
const variant = resolveAppVariant(requestedVariant);
if (!argumentsForEas.length) throw new Error('Pass an EAS command after the app variant.');

// EAS reads android/app/build.gradle before Gradle evaluates it. It mistakes
// the variable name for the package and attaches push credentials to that name.
const gradlePath = path.join(__dirname, '../android/app/build.gradle');
const original = fs.readFileSync(gradlePath, 'utf8');
const marker = 'applicationId taxiApplicationId';
if (original.split(marker).length !== 2) throw new Error('Expected one variant applicationId in build.gradle.');
const configured = original.replace(marker, `applicationId "${APP_VARIANTS[variant].androidPackage}"`);
const environment = { ...process.env, APP_VARIANT: variant };
const easArguments = process.platform === 'win32'
  ? [require.resolve('eas-cli/bin/run', { paths: [path.join(process.env.APPDATA, 'npm/node_modules')] }), ...argumentsForEas]
  : argumentsForEas;

try {
  fs.writeFileSync(gradlePath, configured);
  const result = spawnSync(process.platform === 'win32' ? process.execPath : 'eas', easArguments, {
    cwd: path.join(__dirname, '..'), env: environment, stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.writeFileSync(gradlePath, original);
}
