import type { ExpoConfig } from 'expo/config';
const { resolveApiUrl } = require('./config/api.cjs');
const production = process.env.APP_ENV === 'production';
resolveApiUrl(process.env.EXPO_PUBLIC_API_URL, production);
const projectId = process.env.EXPO_PUBLIC_RESTAURANT_EAS_PROJECT_ID?.trim();
const config: ExpoConfig = {
  name: 'Atlas Restaurant', slug: 'atlas-restaurant', scheme: 'atlas-restaurant',
  version: '2.0.0', icon: './assets/icon.png', userInterfaceStyle: 'light', newArchEnabled: true,
  ios: { bundleIdentifier: 'kg.taxigo.restaurant', supportsTablet: true, buildNumber: '200', infoPlist: { ITSAppUsesNonExemptEncryption: false } },
  android: { package: 'kg.taxigo.restaurant', versionCode: 200, adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#087FFF' }, blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.CAMERA', 'android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_BACKGROUND_LOCATION', 'android.permission.READ_CONTACTS'] },
  web: { bundler: 'metro', favicon: './assets/icon.png' },
  plugins: ['expo-asset', 'expo-font', ['expo-build-properties', { android: { minSdkVersion: 26, usesCleartextTraffic: !production }, ios: { deploymentTarget: '15.1' } }], ['expo-image-picker', { photosPermission: 'Выберите фотографию блюда или ресторана.', cameraPermission: false, microphonePermission: false }], ['expo-secure-store', { configureAndroidBackup: true }], './plugins/with-phone-build.cjs'],
  extra: { ...(projectId ? { eas: { projectId } } : {}) },
};
export default config;
