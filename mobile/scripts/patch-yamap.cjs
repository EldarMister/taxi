const fs = require('node:fs');
const path = require('node:path');

// The upstream 4.8.3 wrapper predates AGP 8 namespaces. Keep this patch
// deterministic, checked into source, and applied on every npm install.
const root = path.dirname(require.resolve('react-native-yamap/package.json'));
const gradle = path.join(root, 'android', 'build.gradle');
let source = fs.readFileSync(gradle, 'utf8');
source = source.replace(/\s*jcenter\(\)/g, '');
if (!source.includes("namespace 'ru.vvdev.yamap'")) {
  source = source.replace('android {', "android {\n    namespace 'ru.vvdev.yamap'\n    compileSdkVersion rootProject.ext.compileSdkVersion\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }");
}
source = source.replace('        compileSdkVersion 34\n', '');
source = source.replace("com.google.android.gms:play-services-location:+", "com.google.android.gms:play-services-location:21.3.0");
source = source.replace("com.facebook.react:react-native:+", "com.facebook.react:react-android");
fs.writeFileSync(gradle, source);
const manifest = path.join(root, 'android', 'src', 'main', 'AndroidManifest.xml');
fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').replace(/\s+package="[^"]+"/, ''));

// Upstream geocodePoint/searchPoint accidentally pass latitude as longitude on iOS.
const iosSearch = path.join(root, 'ios', 'YamapSearch.swift');
fs.writeFileSync(iosSearch, fs.readFileSync(iosSearch, 'utf8').replaceAll('longitude: point["lat"] as! Double', 'longitude: point["lon"] as! Double'));

// RN 0.81 made bridge return types explicitly nullable and event maps mutable.
const androidRoot = path.join(root, 'android', 'src', 'main', 'java', 'ru', 'vvdev', 'yamap');
for (const filename of fs.readdirSync(androidRoot).filter((file) => file.endsWith('Manager.kt'))) {
  const target = path.join(androidRoot, filename);
  let kotlin = fs.readFileSync(target, 'utf8');
  kotlin = kotlin.replaceAll('getExportedCustomDirectEventTypeConstants(): Map<String, Any>?', 'getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any>?');
  kotlin = kotlin.replaceAll('getCommandsMap(): Map<String, Int>?', 'getCommandsMap(): MutableMap<String, Int>?');
  kotlin = kotlin.replace(/\.build\(\)(?!\.toMutableMap)/g, '.build().toMutableMap()');
  kotlin = kotlin.replaceAll('args.getArray(1), args.getString(2))', 'args.getArray(1), args.getString(2) ?: return)');
  kotlin = kotlin.replaceAll('emitWorldToScreenPoints(args.getArray(0),', 'emitWorldToScreenPoints(args.getArray(0) ?: return,');
  kotlin = kotlin.replaceAll('emitScreenToWorldPoints(args.getArray(0),', 'emitScreenToWorldPoints(args.getArray(0) ?: return,');
  kotlin = kotlin.replaceAll('vehicles.add(jsVehicles.getString(i))', 'jsVehicles.getString(i)?.let { vehicles.add(it) }');
  kotlin = kotlin.replaceAll('setClusteredMarkers(points.toArrayList())', 'setClusteredMarkers(ArrayList(points.toArrayList().filterNotNull()))');
  kotlin = kotlin.replaceAll('val markerPoint = args!!.getMap(0)\n', 'val markerPoint = args!!.getMap(0) ?: return\n');
  fs.writeFileSync(target, kotlin);
}
const androidView = path.join(androidRoot, 'view', 'YamapView.kt');
let view = fs.readFileSync(androidView, 'utf8');
view = view.replaceAll('val p = worldPoints.getMap(i)\n', 'val p = worldPoints.getMap(i) ?: continue\n');
view = view.replaceAll('val p = screenPoints.getMap(i)\n', 'val p = screenPoints.getMap(i) ?: continue\n');
view = view.replaceAll('Arguments.fromList(value)', 'Arguments.fromList(value?.filterNotNull() ?: emptyList<String>())');
fs.writeFileSync(androidView, view);

// Native sessions must remain strongly referenced until completion.
const searchClient = path.join(androidRoot, 'search', 'YandexMapSearchClient.kt');
let search = fs.readFileSync(searchClient, 'utf8');
if (!search.includes('private var searchSession:')) {
  search = search.replace('import com.yandex.mapkit.search.Session.SearchListener', 'import com.yandex.mapkit.search.Session\nimport com.yandex.mapkit.search.Session.SearchListener');
  search = search.replace('    private val searchManager:', '    private var searchSession: Session? = null\n    private val searchManager:');
  search = search.replace(/        this\.searchManager\.(submit|resolveURI|searchByURI)\(/g, '        searchSession = this.searchManager.$1(');
}
fs.writeFileSync(searchClient, search);
