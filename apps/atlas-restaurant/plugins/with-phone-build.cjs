const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withPhoneBuild(config) {
  if (process.env.ATLAS_PHONE_BUILD !== '1') return config;
  return withAppBuildGradle(config, (mod) => {
    const marker = '// Atlas standalone phone testing build';
    mod.modResults.contents = mod.modResults.contents.replace(
      /\n\/\/ Atlas standalone phone testing build\nandroid\.buildTypes \{\n    phone \{[\s\S]*?\n    \}\n\}\n/g,
      '',
    );
    mod.modResults.contents += `
${marker}
android.buildTypes {
    phone {
        initWith android.buildTypes.release
        debuggable false
        signingConfig android.signingConfigs.debug
        matchingFallbacks = ['release']
    }
}
`;
    return mod;
  });
};
