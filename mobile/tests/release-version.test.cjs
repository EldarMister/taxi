const assert = require('node:assert/strict');
const { test } = require('node:test');
const { nextReleaseVersion } = require('../config/release-version.cjs');
test('release versions carry at 99 and preserve a monotonically increasing Android code', () => {
  assert.deepEqual(nextReleaseVersion('1.1.99', 111), { version: '1.2.00', versionCode: 112 });
  assert.deepEqual(nextReleaseVersion('1.2.00', 112), { version: '1.2.01', versionCode: 113 });
  assert.deepEqual(nextReleaseVersion('1.2.01', 113), { version: '1.2.02', versionCode: 114 });
  assert.deepEqual(nextReleaseVersion('1.99.99', 1000), { version: '2.0.00', versionCode: 1001 });
  assert.throws(() => nextReleaseVersion('1.2.101', 114));
});
