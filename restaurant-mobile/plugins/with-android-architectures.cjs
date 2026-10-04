const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = config => withAppBuildGradle(config, mod => {
  const marker = '// Atlas Restaurant: package only the architectures being built.';
  if (!mod.modResults.contents.includes(marker)) {
    mod.modResults.contents = mod.modResults.contents.replace(/defaultConfig\s*\{/, `defaultConfig {
        ${marker}
        ndk {
            abiFilters (*((findProperty('reactNativeArchitectures') ?: 'arm64-v8a,x86_64').split(',')))
        }`);
  }
  return mod;
});
