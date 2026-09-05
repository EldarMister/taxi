const { withAppDelegate } = require('expo/config-plugins');

module.exports = function withYandexMapKit(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      throw new Error('Yandex MapKit plugin expects the Expo SDK54 Swift AppDelegate.');
    }
    let source = mod.modResults.contents;
    if (!source.includes('import YandexMapsMobile')) {
      source = 'import YandexMapsMobile\n' + source;
    }
    if (!source.includes('// Taxi GO: initialize MapKit before React Native')) {
      const anchor = '    let delegate = ReactNativeDelegate()';
      if (!source.includes(anchor)) throw new Error('Yandex MapKit: AppDelegate initialization anchor was not found.');
      source = source.replace(anchor, `    // Taxi GO: initialize MapKit before React Native\n    if let mapKey = Bundle.main.object(forInfoDictionaryKey: "YandexMapKitAPIKey") as? String, !mapKey.isEmpty {\n      YMKMapKit.setLocale("ru_RU")\n      YMKMapKit.setApiKey(mapKey)\n      YMKMapKit.sharedInstance().onStart()\n    }\n\n${anchor}`);
    }
    mod.modResults.contents = source;
    return mod;
  });
};

