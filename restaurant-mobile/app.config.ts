import type { ExpoConfig } from 'expo/config';

const { resolveApiUrl } = require('./config/api.cjs');
resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, process.env.APP_ENV === 'production');
const projectId = process.env.EXPO_PUBLIC_RESTAURANT_EAS_PROJECT_ID?.trim();

const config: ExpoConfig = {
  name: 'Atlas Restaurant',
  slug: 'atlas-restaurant',
  scheme: 'atlas-restaurant',
  version: '1.1.86',
  icon: './assets/icon.png',
  orientation: 'portrait',
  userInterfaceStyle: 'light',
  newArchEnabled: false,
  ios: {
    bundleIdentifier: 'kg.taxigo.restaurant',
    supportsTablet: false,
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'kg.taxigo.restaurant',
    versionCode: 97,
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#087FFF' },
    blockedPermissions: [
      'android.permission.RECORD_AUDIO', 'android.permission.CAMERA',
      'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION',
      'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.READ_CONTACTS',
      'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    './plugins/with-android-architectures.cjs',
    'expo-asset', 'expo-font',
    ['expo-build-properties', { android: { minSdkVersion: 26, usesCleartextTraffic: process.env.APP_ENV !== 'production' }, ios: { deploymentTarget: '15.1' } }],
    ['expo-image-picker', { photosPermission: 'Выберите фотографии блюд и ресторана.', cameraPermission: false, microphonePermission: false }],
    ['expo-secure-store', { configureAndroidBackup: true }],
  ],
  extra: { ...(projectId ? { eas: { projectId } } : {}) },
};

export default config;
