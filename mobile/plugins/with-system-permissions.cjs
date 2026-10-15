const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');

module.exports = function withSystemPermissions(config) {
  config = withDangerousMod(config, ['android', async mod => {
    const packageName = mod.android.package;
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/java', ...packageName.split('.'));
    const template = fs.readFileSync(path.join(__dirname, 'system-permissions/AtlasSystemPermissionsPackage.kt'), 'utf8');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'AtlasSystemPermissionsPackage.kt'), template.replace(/^package .+$/m, `package ${packageName}`));
    return mod;
  }]);
  return withMainApplication(config, mod => {
    if (mod.modResults.language !== 'kt') throw new Error('Atlas system permissions require a Kotlin MainApplication.');
    const contents = mod.modResults.contents;
    if (!contents.includes('add(AtlasSystemPermissionsPackage())')) {
      const anchor = /PackageList\(this\)\.packages\.apply\s*\{/;
      if (!anchor.test(contents)) throw new Error('Unable to register AtlasSystemPermissionsPackage.');
      mod.modResults.contents = contents.replace(anchor, value => `${value}\n              add(AtlasSystemPermissionsPackage())`);
    }
    return mod;
  });
};
