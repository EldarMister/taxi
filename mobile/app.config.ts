import type { ExpoConfig } from 'expo/config';
import { existsSync } from 'node:fs';

const { resolveApiUrl } = require('./config/api.cjs') as { resolveApiUrl: (value?: string, production?: boolean) => string };
const { resolveAppVariantConfig } = require('./config/app-variant.cjs') as {
  resolveAppVariantConfig: (environment?: NodeJS.ProcessEnv, fileExists?: (path: string) => boolean) => {
    variant: 'client' | 'driver';
    identity: {
      expectedRole: 'CLIENT' | 'DRIVER'; name: string; slug: string; scheme: string;
      androidPackage: string; iosBundleIdentifier: string;
    };
    easProjectId?: string;
    googleServicesFile?: string;
  };
};
// Fail before creating an APK if a release is configured for an emulator or placeholder.
resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, process.env.APP_ENV === 'production');
const { variant, identity, easProjectId, googleServicesFile } = resolveAppVariantConfig(process.env, existsSync);

const config: ExpoConfig = {
  name: identity.name,
  slug: identity.slug,
  scheme: identity.scheme,
  icon: variant === 'client' ? './assets/logo.png' : './assets/edu-drive-icon.png',
  version: '1.1.28',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: false,
  ios: {
    bundleIdentifier: identity.iosBundleIdentifier,
    supportsTablet: false,
    infoPlist: {
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      ITSAppUsesNonExemptEncryption: false,
      ...(variant === 'driver' ? { UIBackgroundModes: ['location', 'audio'] } : {}),
    },
  },
  android: {
    package: identity.androidPackage,
    versionCode: 39,
    adaptiveIcon: { foregroundImage: variant === 'client' ? './assets/logo.png' : './assets/edu-drive-icon.png', backgroundColor: '#FFFFFF' },
    googleServicesFile,
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS', ...(variant === 'client' ? ['READ_CONTACTS'] : ['CAMERA'])],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      ...(variant === 'client' ? ['android.permission.CAMERA'] : []),
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.WRITE_CONTACTS',
      ...(variant === 'client' ? ['android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.FOREGROUND_SERVICE_LOCATION'] : ['android.permission.READ_CONTACTS']),
    ],
  },
  plugins: [
    'expo-asset',
    '@maplibre/maplibre-react-native',
    ['expo-build-properties', {
      android: { minSdkVersion: 26, usesCleartextTraffic: process.env.APP_ENV !== 'production' },
      ios: { deploymentTarget: '15.1', buildReactNativeFromSource: true },
    }],
    ['expo-location', {
      locationWhenInUsePermission: 'Местоположение нужно, чтобы найти адрес подачи и показать вас на карте.',
      locationAlwaysAndWhenInUsePermission: 'Во время поездки геолокация в фоне нужна для навигации и положения машины у вашего пассажира.',
      isIosBackgroundLocationEnabled: variant === 'driver',
      isAndroidBackgroundLocationEnabled: variant === 'driver',
      isAndroidForegroundServiceEnabled: variant === 'driver',
    }],
    ['expo-image-picker', {
      photosPermission: 'Доступ к фотографиям нужен водителю, чтобы выбрать фото профиля.',
      cameraPermission: variant === 'driver' ? 'Камера нужна для фотографии профиля, документов и транспорта.' : false,
      microphonePermission: false,
    }],
    ...(variant === 'driver' ? [['expo-camera', { cameraPermission: 'Камера нужна для фотографии профиля, документов и транспорта.', recordAudioAndroid: false }] as [string, { cameraPermission: string; recordAudioAndroid: boolean }]] : []),
    'expo-document-picker',
    ...(variant === 'client' ? [['expo-contacts', { contactsPermission: 'Выберите пассажира из контактов для заказа поездки другому человеку.' }] as [string, { contactsPermission: string }]] : []),
    ['expo-audio', { microphonePermission: false, recordAudioAndroid: false }],
    ['expo-notifications', { defaultChannel: 'orders', color: '#246BFD', sounds: [
      './assets/sounds/driver_new_order.wav',
      './assets/sounds/driver_passenger_message.wav',
      './assets/sounds/driver_trip_completed.wav',
    ] }],
    ['expo-secure-store', { configureAndroidBackup: true }],
  ],
  extra: {
    appVariant: variant,
    expectedRole: identity.expectedRole,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;

