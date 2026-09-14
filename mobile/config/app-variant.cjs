const DEFAULT_CLIENT_EAS_PROJECT_ID = 'a167169e-47e1-4a60-93ec-739f9dd77c10';
const DEFAULT_DRIVER_EAS_PROJECT_ID = 'c9056e00-5a97-482f-b121-75840b31d24e';

const APP_VARIANTS = Object.freeze({
  client: Object.freeze({
    key: 'client',
    expectedRole: 'CLIENT',
    name: 'Atlas',
    slug: 'taxi-go',
    scheme: 'taxi-go',
    androidPackage: 'kg.taxigo.app',
    iosBundleIdentifier: 'kg.taxigo.app',
    easProjectEnv: 'EXPO_PUBLIC_CLIENT_EAS_PROJECT_ID',
    googleServicesEnv: 'CLIENT_GOOGLE_SERVICES_FILE',
    googleServicesFallback: './google-services.json',
  }),
  driver: Object.freeze({
    key: 'driver',
    expectedRole: 'DRIVER',
    name: 'Atlas pro',
    slug: 'taxi-go-driver',
    scheme: 'taxi-go-driver',
    androidPackage: 'kg.taxigo.driver',
    iosBundleIdentifier: 'kg.taxigo.driver',
    easProjectEnv: 'EXPO_PUBLIC_DRIVER_EAS_PROJECT_ID',
    googleServicesEnv: 'DRIVER_GOOGLE_SERVICES_FILE',
    googleServicesFallback: './google-services.driver.json',
  }),
});

function resolveAppVariant(value) {
  const variant = String(value || 'client').trim().toLowerCase();
  if (!Object.hasOwn(APP_VARIANTS, variant)) {
    throw new Error(`APP_VARIANT must be "client" or "driver", received ${JSON.stringify(value)}.`);
  }
  return variant;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveAppVariantConfig(environment = process.env, fileExists = () => false) {
  const variant = resolveAppVariant(environment.APP_VARIANT);
  const identity = APP_VARIANTS[variant];
  const easProjectId = text(environment[identity.easProjectEnv])
    || (variant === 'client'
      ? text(environment.EXPO_PUBLIC_EAS_PROJECT_ID) || DEFAULT_CLIENT_EAS_PROJECT_ID
      : DEFAULT_DRIVER_EAS_PROJECT_ID);
  const explicitGoogleServicesFile = text(environment[identity.googleServicesEnv]);
  const explicitGoogleServicesFileExists = explicitGoogleServicesFile && fileExists(explicitGoogleServicesFile);
  const fallbackGoogleServicesFileExists = fileExists(identity.googleServicesFallback);
  const evaluatingEasEnvironment = Boolean(environment.EXPO_NO_DOTENV);
  if (explicitGoogleServicesFile && !explicitGoogleServicesFileExists && !(evaluatingEasEnvironment && fallbackGoogleServicesFileExists)) {
    throw new Error(`${identity.googleServicesEnv} points to a file that does not exist: ${explicitGoogleServicesFile}`);
  }
  const googleServicesFile = explicitGoogleServicesFileExists
    ? explicitGoogleServicesFile
    : fallbackGoogleServicesFileExists
      ? identity.googleServicesFallback
      : explicitGoogleServicesFile;
  const production = environment.APP_ENV === 'production';
  if (variant === 'driver' && production && !easProjectId) {
    throw new Error(`${identity.easProjectEnv} is required for a production driver build.`);
  }
  if (variant === 'driver' && production && !googleServicesFile) {
    throw new Error(`${identity.googleServicesEnv} or ${identity.googleServicesFallback} is required for a production driver build.`);
  }
  return { variant, identity, easProjectId, googleServicesFile };
}

function expectedRoleForVariant(value) {
  return APP_VARIANTS[resolveAppVariant(value)].expectedRole;
}

function isRoleAllowed(value, role) {
  return role === expectedRoleForVariant(value);
}

function roleMismatchCopy(value, language = 'ru') {
  const variant = resolveAppVariant(value);
  if (language === 'ky') {
    return variant === 'driver'
      ? {
          title: 'Бул аккаунт башка колдонмо үчүн',
          message: 'Бул номер жүргүнчүнүн аккаунтуна таандык. Кардарлар үчүн Atlas колдонмосун ачыңыз. Бул жердеги сессия тазаланды.',
          action: 'Башка номер менен кирүү',
        }
      : {
          title: 'Бул аккаунт башка колдонмо үчүн',
          message: 'Бул номер айдоочунун аккаунтуна таандык. Atlas pro колдонмосун ачыңыз. Бул жердеги сессия тазаланды.',
          action: 'Башка номер менен кирүү',
        };
  }
  return variant === 'driver'
    ? {
        title: 'Этот аккаунт для другого приложения',
        message: 'Номер зарегистрирован как пассажир. Откройте клиентское приложение Atlas. Сессия в приложении водителя очищена.',
        action: 'Войти с другим номером',
      }
    : {
        title: 'Этот аккаунт для другого приложения',
        message: 'Номер зарегистрирован как водитель. Откройте приложение Atlas pro. Сессия в клиентском приложении очищена.',
        action: 'Войти с другим номером',
      };
}

module.exports = {
  APP_VARIANTS,
  DEFAULT_CLIENT_EAS_PROJECT_ID,
  DEFAULT_DRIVER_EAS_PROJECT_ID,
  expectedRoleForVariant,
  isRoleAllowed,
  resolveAppVariant,
  resolveAppVariantConfig,
  roleMismatchCopy,
};
