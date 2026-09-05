import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Taxi GO',
  slug: 'taxi-go',
  scheme: 'taxi-go',
  version: '1.0.0',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: false,
  ios: {
    bundleIdentifier: 'kg.taxigo.app',
    supportsTablet: false,
    infoPlist: {
      YandexMapKitAPIKey: process.env.EXPO_PUBLIC_YANDEX_MAPKIT_KEY || '',
      NSAppTransportSecurity: { NSAllowsLocalNetworking: true },
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'kg.taxigo.app',
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS'],
    blockedPermissions: [
      'android.permission.ACCESS_BACKGROUND_LOCATION',
      'android.permission.FOREGROUND_SERVICE_LOCATION',
    ],
  },
  plugins: [
    './plugins/withYandexMapKit.cjs',
    ['expo-build-properties', {
      android: { minSdkVersion: 26, usesCleartextTraffic: process.env.APP_ENV !== 'production' },
      ios: { deploymentTarget: '15.1', buildReactNativeFromSource: true },
    }],
    ['expo-location', {
      locationWhenInUsePermission: 'Местоположение нужно, чтобы найти адрес подачи и показать вас на карте.',
      isIosBackgroundLocationEnabled: false,
      isAndroidBackgroundLocationEnabled: false,
      isAndroidForegroundServiceEnabled: false,
    }],
    ['expo-notifications', { defaultChannel: 'orders', color: '#246BFD' }],
    ['expo-secure-store', { configureAndroidBackup: true }],
  ],
  extra: {
    eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID || undefined },
  },
};

export default config;

