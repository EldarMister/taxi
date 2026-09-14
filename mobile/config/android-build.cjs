const LOCAL_ANDROID_ARCHITECTURES = 'arm64-v8a,x86_64';
const PHONE_RELEASE_ANDROID_ARCHITECTURES = 'arm64-v8a';

function optionValue(arguments_, name) {
  const inline = arguments_.find(argument => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = arguments_.indexOf(name);
  return index >= 0 ? arguments_[index + 1] : undefined;
}

function resolveLocalAndroidArchitectures(expoArguments, environment = {}) {
  const explicit = environment.ORG_GRADLE_PROJECT_reactNativeArchitectures;
  if (explicit) return explicit;
  if (expoArguments[0] !== 'run:android') return undefined;

  const nativeVariant = optionValue(expoArguments, '--variant');
  return /release/i.test(nativeVariant || '')
    ? PHONE_RELEASE_ANDROID_ARCHITECTURES
    : LOCAL_ANDROID_ARCHITECTURES;
}

module.exports = {
  LOCAL_ANDROID_ARCHITECTURES,
  PHONE_RELEASE_ANDROID_ARCHITECTURES,
  resolveLocalAndroidArchitectures,
};
