const fs = require('node:fs');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const metadata = {
  'com.google.firebase.messaging.default_notification_icon': '@drawable/atlas_notification_icon',
  'expo.modules.notifications.default_notification_icon': '@drawable/atlas_notification_icon',
  'expo.modules.notifications.large_notification_icon': '@drawable/atlas_notification_logo',
};

function writeResources(projectRoot, androidRoot) {
  const resources = path.join(androidRoot, 'app/src/main/res');
  fs.mkdirSync(path.join(resources, 'drawable'), { recursive: true });
  fs.mkdirSync(path.join(resources, 'drawable-nodpi'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'notification-icon.xml'), path.join(resources, 'drawable/atlas_notification_icon.xml'));
  fs.copyFileSync(path.join(projectRoot, 'assets/logo1.png'), path.join(resources, 'drawable-nodpi/atlas_notification_logo.png'));
}

function setMetadata(application) {
  application['meta-data'] ??= [];
  for (const [name, resource] of Object.entries(metadata)) {
    application['meta-data'] = application['meta-data'].filter(item => item.$['android:name'] !== name);
    application['meta-data'].push({ $: { 'android:name': name, 'android:resource': resource } });
  }
}

module.exports = function withNotificationBranding(config) {
  config = withAndroidManifest(config, mod => {
    setMetadata(AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults));
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    writeResources(mod.modRequest.projectRoot, mod.modRequest.platformProjectRoot);
    return mod;
  }]);
};
module.exports.writeResources = writeResources;
module.exports.setMetadata = setMetadata;
