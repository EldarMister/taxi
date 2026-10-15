function nextReleaseVersion(version, versionCode) {
  if (!/^\d+\.\d+\.\d{2}$/.test(version) || !Number.isSafeInteger(versionCode) || versionCode < 1) throw new Error('Invalid release version');
  let [major, minor, patch] = version.split('.').map(Number);
  patch += 1;
  if (patch === 100) { patch = 0; minor += 1; }
  if (minor === 100) { minor = 0; major += 1; }
  return { version: `${major}.${minor}.${String(patch).padStart(2, '0')}`, versionCode: versionCode + 1 };
}
module.exports = { nextReleaseVersion };
