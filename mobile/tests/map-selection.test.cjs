const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/native/', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
const frameExports = {};
vm.runInNewContext(compile('routeFrame.ts'), { exports: frameExports });
const feature = (latitude, longitude, properties = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties });

async function mountMap(t, initialProps, options = {}) {
  const timers = new Map(), cameraCalls = [], bounds = [], requests = [], headers = [];
  let next = 0, renderer, props = initialProps;
  const nativeCamera = { setCamera: config => cameraCalls.push(config), fitBounds: (...args) => bounds.push(args) };
  const Camera = React.forwardRef((cameraProps, ref) => { React.useImperativeHandle(ref, () => nativeCamera); return React.createElement('Camera', cameraProps); });
  const NativeMap = React.forwardRef((mapProps, ref) => { React.useImperativeHandle(ref, () => ({ getCenter: async () => options.mapCenter || null })); return React.createElement('MapView', mapProps); });
  const exports = {};
  const api = { baseUrl: 'https://api.example.test/api', request: async (url, init) => {
    requests.push({ url, init });
    if (options.request) return options.request(url, init);
    throw Error('Routing unavailable');
  } };
  const styles = {};
  vm.runInNewContext(compile('taxiMapStyle.ts'), { exports: styles, process: { env: options.env || {} }, require: id => {
    if (id === './openfreemap-bright.json') return JSON.parse(fs.readFileSync(path.join(__dirname, '../src/native/openfreemap-bright.json'), 'utf8'));
    throw Error(id);
  } });
  vm.runInNewContext(compile('TaxiMap.tsx'), { exports, process: { env: options.env || {} },
    setTimeout: callback => { const id = ++next; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'expo-device') return { isDevice: false };
      if (id === 'react-native-svg') return { __esModule: true, default: 'Svg', Path: 'SvgPath' };
      if (id === 'react-native') return { View: 'View', Image: 'Image', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'Spinner', StyleSheet: { create: s => s }, Linking: { openURL: async () => {} } };
      if (id === '../../assets/tracking-car-white.png') return 'tracking-car-white.png';
      if (id === '../../assets/driver-navigation-arrow.png') return 'driver-navigation-arrow.png';
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
      if (id === '../ui') return { Button: 'Button', Icon: 'Icon', PickupIcon: 'PickupIcon', colors: {}, shortAddress: x => x || '' };
      if (id === '@maplibre/maplibre-react-native') return { Camera, MapView: NativeMap, PointAnnotation: 'PointAnnotation', MarkerView: 'MarkerView', ShapeSource: 'ShapeSource', LineLayer: 'LineLayer', SymbolLayer: 'SymbolLayer', FillLayer: 'FillLayer', UserLocation: 'UserLocation', addCustomHeader: (...args) => headers.push(args) };
      if (id === '../api') return { api };
      if (id === './mapkit') return { BISHKEK: { latitude: 42.87, longitude: 74.57 }, reverseGeocode: async point => ({ ...point, address: 'Выбранная улица' }) };
      if (id === './location') return { getCurrentPosition: async () => {
        if (options.locationError) throw options.locationError;
        return options.position || { latitude: 42.88, longitude: 74.59 };
      } };
      if (id === './routeFrame') return frameExports;
      if (id === './taxiMapStyle') return styles;
      throw Error(id);
    },
  });
  await act(async () => { renderer = create(React.createElement(exports.default, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(timers.size, 0); });
  const map = () => renderer.root.findByType('MapView');
  const update = async patch => { props = { ...props, ...patch }; await act(async () => renderer.update(React.createElement(exports.default, props))); };
  const ready = async () => { await act(async () => {
    renderer.root.findByProps({ testID: 'map-viewport' }).props.onLayout({ nativeEvent: { layout: { width: 412, height: 914 } } });
    map().props.onDidFinishLoadingStyle();
  }); };
  return { renderer, map, update, ready, cameraCalls, bounds, requests, headers, timers };
}

test('center pin confirms the settled camera point, switches endpoints and browses without saving GPS', async t => {
  const selected = [], edited = [];
  const h = await mountMap(t, { selectionMode: 'pickup', pickup: { latitude: 42.87, longitude: 74.57 }, onSelectPoint: p => selected.push(p), onEditPoint: f => edited.push(f) });
  const confirm = () => h.renderer.root.findByType('Button');
  await h.ready();
  await act(async () => h.map().props.onRegionWillChange(feature(42.87, 74.57, { isUserInteraction: true })));
  assert.equal(confirm().props.disabled, true);
  await act(async () => h.map().props.onRegionDidChange(feature(42.881, 74.583)));
  assert.equal(confirm().props.disabled, false);
  await act(async () => confirm().props.onPress());
  assert.equal(selected[0].latitude, 42.881); assert.equal(selected[0].longitude, 74.583);
  await h.update({ selectionMode: 'dropoff', dropoff: { latitude: 42.9, longitude: 74.6 } });
  assert.equal(h.cameraCalls.at(-1).centerCoordinate[1], 42.9);
  await h.update({ focusPoint: { latitude: 42.91, longitude: 74.61 } });
  assert.equal(h.cameraCalls.at(-1).centerCoordinate[1], 42.91); assert.equal(selected.length, 1);
  await act(async () => confirm().props.onPress()); assert.equal(selected[1].latitude, 42.91);
  await h.update({ selectionMode: null });
  const markers = h.renderer.root.findAllByType('PointAnnotation');
  await act(async () => { markers[0].props.onSelected(); markers[1].props.onSelected(); });
  assert.deepEqual(edited, ['pickup', 'dropoff']);
  const browsed = [];
  await h.update({ browsePickup: true, dropoff: null, focusPoint: null, onPickupChange: p => browsed.push(p) });
  assert.equal(h.renderer.root.findAllByType('Button').length, 0);
  assert.equal(h.renderer.root.findAllByType('PointAnnotation').length, 0, 'home has only the fixed center pin');
  await act(async () => h.map().props.onRegionDidChange(feature(42.88, 74.58)));
  await act(async () => { for (const [id, callback] of [...h.timers]) { h.timers.delete(id); callback(); } });
  assert.equal(browsed.at(-1).latitude, 42.88);
  assert.equal(browsed.at(-1).address, 'Выбранная улица');
  assert.equal(selected.length, 2);
});

test('white map controls zoom around the visible center and GPS recenters without changing pickup or bearing', async t => {
  const pickup = { latitude: 42.87, longitude: 74.57 };
  const options = { position: { latitude: 42.9, longitude: 74.6 }, mapCenter: [74.583, 42.881] };
  const h = await mountMap(t, { passengerView: true, pickup, contentTopInset: 110 }, options);
  await h.ready();
  assert.equal(h.map().props.rotateEnabled, true);
  const control = label => h.renderer.root.findByProps({ accessibilityLabel: label });
  assert.equal(control('Приблизить карту').findByType('Icon').props.color, '#111827');
  assert.equal(control('Отдалить карту').findByType('Icon').props.color, '#111827');
  assert.equal(control('Моё местоположение').findByType('Icon').props.color, '#111827');
  assert.equal(h.renderer.root.findByProps({ testID: 'map-zoom-controls' }).props.style[0].backgroundColor, '#FFFFFF');
  assert.equal(control('Моё местоположение').props.style({ pressed: false })[0].backgroundColor, '#FFFFFF');
  assert.equal(h.renderer.root.findByProps({ testID: 'map-controls' }).props.style[2].top, 621, 'client controls clear the order panel');
  assert.equal(h.renderer.root.findByProps({ testID: 'map-viewport' }).props.style[1].bottom, 0);
  await act(async () => h.map().props.onRegionWillChange(feature(42.87, 74.57, { isUserInteraction: true, zoomLevel: 12, heading: 75 })));
  await act(async () => h.map().props.onRegionDidChange(feature(42.87, 74.57, { zoomLevel: 12, heading: 75 })));
  const rotatedCameraCalls = h.cameraCalls.length;
  await h.update({ contentTopInset: 120 });
  assert.equal(h.cameraCalls.length, rotatedCameraCalls, 'an unrelated layout update does not snap the rotated map north');
  await act(async () => control('Приблизить карту').props.onPress());
  assert.equal(h.cameraCalls.at(-1).zoomLevel, 13);
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], options.mapCenter, 'zoom keeps the current visible center');
  assert.equal(h.cameraCalls.at(-1).heading, 75, 'zoom preserves the user rotation');
  await act(async () => control('Приблизить карту').props.onPress());
  assert.equal(h.cameraCalls.at(-1).zoomLevel, 14, 'quick repeated taps each add one level');
  await act(async () => control('Отдалить карту').props.onPress());
  assert.equal(h.cameraCalls.at(-1).zoomLevel, 13);
  await act(async () => control('Моё местоположение').props.onPress());
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [74.6, 42.9]);
  assert.equal(h.cameraCalls.at(-1).heading, undefined, 'GPS recenter preserves the user rotation');
  assert.equal(h.renderer.root.findAllByProps({ id: 'pickup' }).length, 1, 'passenger pickup is not changed');
  assert.equal(h.renderer.root.findByProps({ accessibilityLabel: 'Приблизить карту' }).props.style({ pressed: false })[0].width, 58);
});

test('client map controls rise above the point-selection sheet as its height changes', async t => {
  const h = await mountMap(t, { passengerView: true, selectionMode: 'pickup', pickup: { latitude: 42.87, longitude: 74.57 } });
  await h.ready();
  const controlsTop = () => h.renderer.root.findByProps({ testID: 'map-controls' }).props.style[2].top;
  assert.equal(controlsTop(), 517);
  await act(async () => h.renderer.root.findByType('Button').parent.props.onLayout({ nativeEvent: { layout: { height: 240 } } }));
  assert.equal(controlsTop(), 457, 'zoom and location stay above the measured sheet');
});

test('dark map keeps vector streets readable, uses monochrome controls and switches without moving the camera', async t => {
  const h = await mountMap(t, { theme: 'dark', passengerView: true, pickup: { latitude: 42.87, longitude: 74.57 } });
  await h.ready();
  const style = h.map().props.mapStyle;
  assert.equal(style.name, 'Atlas · Night');
  assert.equal(style.sources.openmaptiles.type, 'vector');
  assert.equal(h.map().props.preferredFramesPerSecond, 30, 'emulator caps idle map rendering without changing physical devices');
  assert.equal(style.layers.find(layer => layer.id === 'background').paint['background-color'], '#101010');
  assert.equal(style.layers.find(layer => layer.id === 'highway-minor').paint['line-color'], '#646464');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-road-minor').paint['line-color'], '#575757');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-road-footways').paint['line-color'], '#777777');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-buildings').paint['fill-color'], '#353535');
  assert.ok(JSON.stringify(style.layers.find(layer => layer.id === 'current-osm-green-areas').paint['fill-outline-color']).includes('#66583E'), 'dark playgrounds keep one distinct outline');
  assert.equal(style.layers.find(layer => layer.id === 'building-housenumber-local').paint['text-color'], '#F0F0F0');
  assert.equal(h.renderer.root.findByProps({ testID: 'map-zoom-controls' }).props.style[2].backgroundColor, '#101010');
  assert.equal(h.renderer.root.findByProps({ accessibilityLabel: 'Приблизить карту' }).findByType('Icon').props.color, '#FFFFFF');
  assert.equal(h.renderer.root.findByProps({ accessibilityLabel: 'Моё местоположение' }).findByType('Icon').props.color, '#FFFFFF');
  await act(async () => h.map().props.onRegionDidChange(feature(42.87, 74.57, { heading: 47, zoomLevel: 16 })));
  const before = h.cameraCalls.length;
  await h.update({ theme: 'light' });
  assert.equal(h.map().props.mapStyle.name, 'Atlas · City');
  assert.equal(h.cameraCalls.length, before, 'switching theme preserves the viewed location and rotation');
  await h.update({ language: 'ky' });
  const kyrgyzStreet = h.map().props.mapStyle.layers.find(layer => layer.id === 'current-osm-street-major');
  assert.equal(kyrgyzStreet['source-layer'], 'street_labels');
  assert.deepEqual(JSON.parse(JSON.stringify(kyrgyzStreet.layout['text-field'][1])), ['get', 'name_ky']);
  assert.equal(h.cameraCalls.length, before, 'switching map language preserves the viewed location');
  await h.update({ theme: 'dark' });
  await act(async () => h.map().props.onDidFailLoadingMap());
  assert.equal(h.map().props.mapStyle.layers[0].paint['raster-saturation'], -1);
  assert.equal(h.map().props.mapStyle.layers[0].paint['raster-brightness-max'], 0.42);
});

test('driver location control resumes follow and GPS errors are visible', async t => {
  const driver = { latitude: 42.87, longitude: 74.57 };
  const followChanges = [];
  const h = await mountMap(t, { driverPosition: driver, navigationActive: true, followDriver: false, contentTopInset: 154, onFollowDriverChange: value => followChanges.push(value) });
  await h.ready();
  assert.equal(h.map().props.rotateEnabled, true);
  await act(async () => h.renderer.root.findByProps({ testID: 'map-viewport' }).props.onLayout({ nativeEvent: { layout: { width: 412, height: 300 } } }));
  const compact = h.renderer.root.findByProps({ testID: 'map-controls' });
  assert.equal(compact.props.style[2].top, 164, 'driver controls stay clear of the bottom card');
  assert.equal(h.renderer.root.findByProps({ testID: 'map-zoom-controls' }).props.style[1].height, 58);
  assert.ok(compact.props.style[2].top + 60 <= 300, 'all controls fit above the short offer card');
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Показать водителя' }).props.onPress());
  assert.deepEqual(followChanges, [true]);
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [74.57, 42.87]);

  const withoutFix = await mountMap(t, { passengerView: true }, { locationError: new Error('Включите геолокацию в настройках устройства.') });
  await withoutFix.ready();
  await act(async () => withoutFix.renderer.root.findByProps({ accessibilityLabel: 'Моё местоположение' }).props.onPress());
  assert.equal(withoutFix.renderer.root.findByProps({ accessibilityRole: 'alert' }).findByType('Text').props.children, 'Включите геолокацию в настройках устройства.');
});

test('zoom buttons keep following the driver; a manual map drag pauses until GPS button is pressed', async t => {
  const driver = { latitude: 42.87, longitude: 74.57, heading: 90 };
  const followChanges = [];
  const h = await mountMap(t, { driverPosition: driver, navigationActive: true, followDriver: true, onFollowDriverChange: value => followChanges.push(value) }, { mapCenter: [74.583, 42.881] });
  await h.ready();
  await act(async () => h.map().props.onRegionDidChange(feature(42.881, 74.583, { zoomLevel: 16, heading: 32 })));
  const followPadding = h.cameraCalls.at(-1).padding;
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Приблизить карту' }).props.onPress());
  assert.deepEqual(followChanges, []);
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [driver.longitude, driver.latitude]);
  assert.equal(h.cameraCalls.at(-1).heading, 32);
  assert.equal(h.cameraCalls.at(-1).padding.paddingTop, followPadding.paddingTop, 'zoom preserves the camera offset above the driver card');
  const callsAfterZoom = h.cameraCalls.length;
  await h.update({ driverPosition: { ...driver, latitude: 42.872 } });
  assert.ok(h.cameraCalls.length > callsAfterZoom, 'GPS keeps the zoomed map centered on the driver');
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [74.57, 42.872]);
  await act(async () => h.map().props.onRegionWillChange(feature(42.872, 74.57, { isUserInteraction: true })));
  assert.deepEqual(followChanges, [false]);
  await h.update({ followDriver: false });
  const callsAfterDrag = h.cameraCalls.length;
  await h.update({ driverPosition: { ...driver, latitude: 42.873 } });
  assert.equal(h.cameraCalls.length, callsAfterDrag, 'manual free view stays in place during GPS updates');
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Показать водителя' }).props.onPress());
  assert.deepEqual(followChanges, [false, true]);
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [74.57, 42.873]);
});

test('driver controls sit higher and a map-style reload restores the followed coordinate', async t => {
  const driver = { latitude: 41.1987, longitude: 72.1802 };
  const h = await mountMap(t, { driverPosition: driver, followDriver: true, contentTopInset: 130 });
  await h.ready();
  assert.equal(h.renderer.root.findByProps({ testID: 'map-controls' }).props.style[2].top, 629);
  const before = h.cameraCalls.length;
  await act(async () => h.map().props.onDidFinishLoadingStyle());
  assert.ok(h.cameraCalls.length > before, 'map loading reapplies the live follow camera');
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [driver.longitude, driver.latitude]);
});

test('offer route badge sits above dropoff only while its distance and time are supplied', async t => {
  const pickup = { latitude: 42.87, longitude: 74.57 };
  const dropoff = { latitude: 42.91, longitude: 74.61 };
  const h = await mountMap(t, { pickup, dropoff, geometry: [pickup, dropoff] });
  const marker = id => h.renderer.root.findByProps({ id });
  assert.equal(marker('dropoff').props.anchor.y, .5, 'an ordinary trip keeps its original marker anchor');
  assert.equal(marker('dropoff').findAllByType('Text').length, 0);

  await h.update({ dropoffRouteLabel: '44 км · 1 ч 10 мин' });
  const badgeMarker = marker('dropoff');
  assert.equal(badgeMarker.props.coordinate[0], dropoff.longitude);
  assert.equal(badgeMarker.props.coordinate[1], dropoff.latitude);
  assert.equal(badgeMarker.props.anchor.y, .81, 'the larger badge keeps the dropoff pin centered on its coordinate');
  assert.equal(marker('pickup').props.anchor.y, 1, 'pickup marker is unaffected');
  assert.equal(badgeMarker.findAll(node => node.props.accessibilityLabel === 'Пункт назначения Б, 44 км · 1 ч 10 мин').length, 1);
  assert.deepEqual(badgeMarker.findAllByType('Text').map(node => node.children.join('')), ['Б', '44 км', '1 ч 10 мин']);

  await h.update({ dropoffRouteLabel: undefined });
  assert.equal(marker('dropoff').props.anchor.y, .5);
  assert.equal(marker('dropoff').findAllByType('Text').length, 0, 'regular route markers never retain the offer badge');
});

test('navigation follows explicit driver fixes, pauses immediately on pan and resumes on recenter', async t => {
  const followChanges = [];
  const route = [{ latitude: 42.87, longitude: 74.57 }, { latitude: 42.89, longitude: 74.57 }, { latitude: 42.89, longitude: 74.6 }];
  const h = await mountMap(t, {
    pickup: route[0], dropoff: route[2], geometry: route, driverPosition: { ...route[0], heading: 90, accuracy: 20 },
    navigationActive: true, followDriver: true, showUserPosition: true, onFollowDriverChange: follow => followChanges.push(follow),
  });
  await h.ready();
  assert.equal(h.cameraCalls.at(-1).heading, 90);
  assert.equal(h.cameraCalls.at(-1).centerCoordinate[0], 74.57);
  assert.equal(h.renderer.root.findAllByType('UserLocation').length, 0, 'no second GPS stream for a driver');
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-accuracy' }).length, 0, 'driver has no duplicate accuracy circle');
  assert.equal(h.renderer.root.findByProps({ id: 'route' }).props.shape.coordinates.length, 3);
  assert.equal(h.renderer.root.findAllByType('Image').length, 0, 'driver sees a navigation arrow, not the passenger car');
  assert.equal(h.renderer.root.findAllByType('MarkerView').length, 0, 'driver arrow is anchored in the native map');
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-position' }).props.shape.coordinates[0], 74.57);
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-arrow' }).props.style.iconImage, 'driver-navigation-arrow.png');
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-arrow' }).props.style.iconSize, .42, 'driver arrow remains compact');
  assert.equal(h.renderer.root.findAllByType('CircleLayer').length, 0, 'driver arrow has no blue accuracy halo');
  assert.equal(h.requests.length, 0);
  await h.update({ driverPosition: { latitude: 42.872, longitude: 74.57, heading: 95, accuracy: 18 } });
  assert.equal(h.cameraCalls.at(-1).heading, 95);
  assert.equal(h.cameraCalls.at(-1).zoomLevel, undefined, 'GPS fixes do not reset manual zoom');
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-position' }).props.shape.coordinates[1], 42.872);
  const beforeHeadingJitter = h.cameraCalls.length;
  await h.update({ driverPosition: { latitude: 42.87201, longitude: 74.57, heading: 260, accuracy: 18 } });
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-arrow' }).props.style.iconRotate, 95, 'stationary heading noise cannot spin the arrow');
  assert.equal(h.cameraCalls.length, beforeHeadingJitter, 'stationary heading noise cannot spin the map');
  await act(async () => h.map().props.onRegionWillChange(feature(42.87, 74.57, { isUserInteraction: true, heading: 40 })));
  assert.deepEqual(followChanges, [false]);
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-position' }).props.shape.coordinates[1], 42.87201, 'panning keeps the arrow anchored to its GPS coordinate');
  const beforePausedUpdate = h.cameraCalls.length;
  await h.update({ driverPosition: { latitude: 42.875, longitude: 74.57, heading: 95 } });
  assert.equal(h.cameraCalls.length, beforePausedUpdate, 'pan pauses before the parent commits the follow prop');
  await h.update({ followDriver: false });
  await h.update({ followDriver: true, recenterKey: 1 });
  assert.equal(h.cameraCalls.at(-1).centerCoordinate[1], 42.875);
  await h.update({ geometry: [], driverPosition: null });
  assert.equal(h.renderer.root.findAllByProps({ id: 'route' }).length, 0);
  assert.equal(h.renderer.root.findAllByType('UserLocation').length, 0, 'navigation waits for the owning GPS stream');
  assert.equal(h.requests.length, 0, 'navigation owns route requests even while loading');
});

test('accepted trip shows both routes while manual map browsing persists through completion', async t => {
  const driver = { latitude: 41.19, longitude: 72.16 };
  const pickup = { latitude: 41.20, longitude: 72.18 };
  const bend = { latitude: 41.25, longitude: 72.24 };
  const dropoff = { latitude: 41.22, longitude: 72.20 };
  const h = await mountMap(t, {
    pickup, dropoff, geometry: [pickup, bend, dropoff], approachGeometry: [driver, pickup],
    routeOverview: true, navigationActive: true, followDriver: false, driverPosition: driver,
    cameraSession: 'ride:ASSIGNED', contentTopInset: 100, contentBottomInset: 290,
  });
  await h.ready();
  assert.equal(h.renderer.root.findByProps({ id: 'route-line' }).props.style.lineColor, '#57AAFF');
  assert.equal(h.renderer.root.findByProps({ id: 'approach-route-line' }).props.style.lineColor, '#FFD54A');
  assert.equal(h.renderer.root.findByProps({ id: 'approach-route' }).props.shape.coordinates[0][0], driver.longitude);
  assert.equal(h.bounds.length, 1);
  assert.equal(h.bounds[0][0][1], bend.latitude, 'far bend in the ride stays inside the overview');
  assert.equal(h.bounds[0][1][0], driver.longitude, 'approach origin stays inside the same overview');
  assert.ok(h.bounds[0][2][2] >= 290, 'the client card cannot cover the route');
  assert.equal(h.cameraCalls.at(-1).pitch, 0, 'overview is flat even when turn navigation is active');

  await act(async () => h.map().props.onRegionDidChange(feature(41.21, 72.19, { zoomLevel: 14, heading: 0 })));
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Приблизить карту' }).props.onPress());
  assert.equal(h.cameraCalls.at(-1).padding.paddingTop, h.bounds[0][2][0], 'zoom keeps the overview clear of the header');
  assert.equal(h.cameraCalls.at(-1).padding.paddingBottom, h.bounds[0][2][2], 'zoom keeps the overview clear of the trip panel');

  await act(async () => h.map().props.onRegionWillChange(feature(41.2, 72.18, { isUserInteraction: true })));
  await h.update({ approachGeometry: [{ ...driver, longitude: 72.15 }, pickup] });
  assert.equal(h.bounds.length, 1, 'moving the map pauses automatic overview refits');

  await h.update({ approachGeometry: null, navigationActive: false, driverPosition: null, cameraSession: 'ride:COMPLETED' });
  assert.equal(h.renderer.root.findAllByProps({ id: 'approach-route' }).length, 0);
  assert.equal(h.renderer.root.findByProps({ id: 'route' }).props.shape.coordinates.length, 3);
  assert.equal(h.bounds.length, 1, 'completion preserves a manually moved map');
});

test('the map styles vector roads and places, keeps attribution and can fall back to configured raster tiles', async t => {
  const route = [{ latitude: 42.87, longitude: 74.57 }, { latitude: 42.93, longitude: 74.61 }, { latitude: 42.88, longitude: 74.58 }];
  const h = await mountMap(t, { pickup: route[0], dropoff: route[2], geometry: route, contentTopInset: 110, showUserPosition: true }, { env: { EXPO_PUBLIC_OSM_TILE_URL: 'https://tiles.example.test/{z}/{x}/{y}.png' } });
  await h.ready();
  const style = h.map().props.mapStyle;
  assert.equal(style.sources.openmaptiles.type, 'vector');
  assert.equal(style.layers.find(layer => layer.id === 'park').paint['fill-color'], '#DDEFE2');
  assert.equal(style.layers.find(layer => layer.id === 'water').paint['fill-color'], '#BBDCF4');
  assert.equal(style.layers.find(layer => layer.id === 'building-top').paint['fill-color'], '#E5ECF3');
  assert.equal(style.layers.find(layer => layer.id === 'highway-minor').paint['line-color'], '#FFFFFF');
  assert.equal(style.layers.find(layer => layer.id === 'building-housenumber-local')['source-layer'], 'housenumber');
  assert.equal(style.layers.find(layer => layer.id === 'building-housenumber-local').minzoom, 14);
  assert.equal(style.layers.find(layer => layer.id === 'park-name-local')['source-layer'], 'park');
  assert.equal(style.layers.some(layer => layer.id.startsWith('poi_r')), false, 'older POI icons do not repeat current OSM places');
  assert.equal(style.sources.osm_current_labels.type, 'vector');
  assert.equal(style.sources.osm_current_labels.url, 'https://vector.openstreetmap.org/shortbread_v1/tilejson.json');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-green-areas')['source-layer'], 'land');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-sites')['source-layer'], 'sites');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-water')['source-layer'], 'water_polygons');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-buildings')['source-layer'], 'buildings');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-buildings').minzoom, 14);
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-road-areas')['source-layer'], 'street_polygons');
  for (const kind of ['service', 'track', 'footway', 'path', 'cycleway', 'steps', 'residential', 'unclassified', 'road', 'primary_link']) {
    assert.ok(style.layers.some(layer => layer['source-layer'] === 'streets' && JSON.stringify(layer.filter).includes(`"${kind}"`)), `${kind} must be drawn from the detailed road network`);
  }
  assert.ok(style.layers.findIndex(layer => layer.id === 'current-osm-buildings') < style.layers.findIndex(layer => layer.id === 'current-osm-road-footways'));
  assert.ok(style.layers.findIndex(layer => layer.id === 'current-osm-road-major') < style.layers.findIndex(layer => layer.id === 'current-osm-street-major'));
  assert.ok(style.layers.findIndex(layer => layer.id === 'current-osm-sites') < style.layers.findIndex(layer => layer.id === 'building'), 'current sites stay below buildings and roads');
  for (const kind of ['stadium', 'pitch', 'track']) {
    const layer = style.layers.find(item => item.id === `site-${kind}`);
    assert.equal(layer['source-layer'], 'landuse');
    assert.equal(JSON.stringify(layer.filter), JSON.stringify(['==', ['get', 'class'], kind]));
    assert.ok(style.layers.findIndex(item => item.id === layer.id) > style.layers.findIndex(item => item.id === 'current-osm-sites'));
    assert.ok(style.layers.findIndex(item => item.id === layer.id) < style.layers.findIndex(item => item.id === 'building'));
  }
  assert.equal(style.layers.some(layer => layer.id === 'site-playground'), false, 'playgrounds use only the current polygon source');
  assert.ok(JSON.stringify(style.layers.find(layer => layer.id === 'current-osm-green-areas').paint).includes('#F8ECCC'), 'current playgrounds retain their distinct light color');
  assert.ok(JSON.stringify(style.layers.find(layer => layer.id === 'current-osm-sites').filter).includes('sports_center'), 'sports centres use the spelling in current Shortbread tiles');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-addresses')['source-layer'], 'addresses');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-pois')['source-layer'], 'pois');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-pois').minzoom, 14);
  assert.equal(style.layers.some(layer => layer.id.startsWith('highway-name-')), false, 'stale OpenMapTiles street names are hidden');
  assert.ok(style.layers.findIndex(layer => layer.id === 'current-osm-street-major') > style.layers.findIndex(layer => layer.id === 'poi_r20'));
  assert.ok(style.layers.find(layer => layer.id === 'current-osm-pois').layout['icon-image'], 'current organizations have visible icons');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-transit')['source-layer'], 'public_transport');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-neighborhoods')['source-layer'], 'place_labels');
  assert.equal(style.layers.some(layer => layer.id === 'current-osm-street-detail'), false, 'the themed map must not be covered by raster tiles');
  const visible = (id, zoom) => style.layers.some(layer => layer.id === id && (layer.minzoom ?? 0) <= zoom && zoom < (layer.maxzoom ?? Infinity));
  for (const [older, current] of [
    ['highway-minor', 'current-osm-road-minor'],
    ['highway-path', 'current-osm-road-footways'],
    ['building-top', 'current-osm-buildings'],
    ['landuse-residential', 'current-osm-urban-areas'],
    ['park', 'current-osm-green-areas'],
    ['water', 'current-osm-water'],
    ['waterway-river', 'current-osm-waterways'],
    ['waterway_line_label', 'current-osm-waterway-names'],
  ]) {
    assert.equal(visible(older, 13.5), true, `${older} provides the overview`);
    assert.equal(visible(current, 13.5), false, `${current} does not double the overview`);
    assert.equal(visible(older, 16), false, `${older} does not double detailed OSM features`);
    assert.equal(visible(current, 16), true, `${current} provides the detailed map`);
  }
  assert.equal(visible('building-housenumber-local', 14.5), true);
  assert.equal(visible('building-housenumber-local', 16), false);
  assert.equal(visible('current-osm-addresses', 16), true);
  assert.equal(visible('poi_transit', 16), false);
  assert.equal(visible('current-osm-transit', 16), true);
  assert.equal(visible('site-pitch', 16), true, 'sports grounds absent from the Shortbread fills remain visible');
  assert.equal(visible('landcover-sand', 16), true, 'unreplaced landcover remains visible');
  assert.ok(style.layers.every(layer => layer.maxzoom === undefined || layer.maxzoom > (layer.minzoom ?? 0)), 'no impossible zoom ranges');
  assert.equal(h.headers[0][0], 'User-Agent');
  assert.match(h.headers[0][1], /^Atlas\/1\.0/);
  assert.ok(h.renderer.root.findByProps({ accessibilityLabel: 'Стиль OpenMapTiles Bright' }));
  assert.ok(h.renderer.root.findByProps({ accessibilityLabel: '© OpenStreetMap contributors' }));
  assert.equal(h.renderer.root.findAllByType('UserLocation').length, 1);
  assert.equal(h.bounds.at(-1)[0][1], 42.93, 'route bend remains visible');
  assert.equal(h.bounds.at(-1)[2][0], 178, 'header clearance is passed to the camera');
  assert.equal(h.requests.length, 0);
  await act(async () => h.map().props.onDidFailLoadingMap());
  assert.equal(h.map().props.mapStyle.sources.osm.tiles[0], 'https://tiles.example.test/{z}/{x}/{y}.png');
});

test('a failed server route leaves no fictitious straight line', async t => {
  const h = await mountMap(t, { pickup: { latitude: 42.87, longitude: 74.57 }, dropoff: { latitude: 42.9, longitude: 74.6 } });
  await h.ready();
  assert.equal(h.requests[0].url, '/routes');
  assert.equal(h.requests[0].init.method, 'POST');
  assert.equal(JSON.parse(h.requests[0].init.body).pickup.address, 'Точка на карте');
  assert.equal(h.renderer.root.findAllByProps({ id: 'route' }).length, 0);
  assert.ok(h.renderer.root.findAllByType('Text').some(node => node.props.children === 'Маршрут временно недоступен'));
});

test('obsolete route responses cannot replace the current trip geometry', async t => {
  const pending = [];
  const pickup = { latitude: 42.87, longitude: 74.57 };
  const oldDropoff = { latitude: 42.88, longitude: 74.58 }, newDropoff = { latitude: 42.9, longitude: 74.6 };
  const h = await mountMap(t, { pickup, dropoff: oldDropoff }, { request: () => new Promise(resolve => pending.push(resolve)) });
  await h.ready();
  await h.update({ dropoff: newDropoff });
  await act(async () => pending[0]({ geometry: [pickup, oldDropoff] }));
  assert.equal(h.renderer.root.findAllByProps({ id: 'route' }).length, 0);
  await act(async () => pending[1]({ geometry: [pickup, { latitude: 42.88, longitude: 74.6 }, newDropoff] }));
  assert.equal(h.renderer.root.findByProps({ id: 'route' }).props.shape.coordinates[2][1], 42.9);
});

test('accuracy circle is closed and follows the supplied radius in metres', () => {
  const polygon = frameExports.accuracyCircle({ latitude: 42.87, longitude: 74.57, accuracy: 100 });
  const ring = polygon.coordinates[0];
  assert.deepEqual(ring[0], ring.at(-1));
  const northDistance = (ring[0][1] - 42.87) * Math.PI / 180 * 6371000;
  assert.ok(Math.abs(northDistance - 100) < .01);
  assert.equal(frameExports.accuracyCircle({ latitude: 42.87, longitude: 74.57, accuracy: -1 }), null);
  assert.equal(frameExports.routeFrame([{ latitude: NaN, longitude: 0 }], 100, 100, 0), null);
  const bounds = frameExports.routeFrame([{ latitude: 42, longitude: 74 }], 100, 100, 1000);
  assert.ok(bounds.ne[0] > bounds.sw[0]); assert.ok(bounds.ne[1] > bounds.sw[1]);
  assert.ok(bounds.padding[0] <= 60);
});

test('panning an idle driver map never jumps to the default city or refits on rerenders', async t => {
  const fix = { latitude: 41.1987, longitude: 72.1802, accuracy: 8 };
  const h = await mountMap(t, { driverPosition: fix, followDriver: true, navigationActive: false });
  await h.ready();
  await act(async () => h.map().props.onRegionWillChange(feature(41.2, 72.19, { isUserInteraction: true })));
  const count = h.cameraCalls.length;
  await h.update({ followDriver: false, driverPosition: { ...fix, latitude: 41.199 } });
  await h.update({ contentTopInset: 110 });
  assert.equal(h.cameraCalls.length, count);
  assert.equal(h.bounds.length, 0);
  await h.update({ followDriver: true, recenterKey: 1 });
  assert.equal(h.cameraCalls.at(-1).centerCoordinate[1], 41.199);
});

test('closing a completed trip returns the map to the driver instead of Bishkek', async t => {
  const driver = { latitude: 41.1987, longitude: 72.1802, accuracy: 8 };
  const pickup = { latitude: 41.2, longitude: 72.185 };
  const dropoff = { latitude: 41.24, longitude: 72.22 };
  const h = await mountMap(t, { pickup, dropoff, geometry: [pickup, dropoff], driverPosition: driver, routeOverview: true, followDriver: false, cameraSession: 'ride:COMPLETED' });
  await h.ready();
  assert.equal(h.bounds.length, 1);
  await h.update({ pickup: null, dropoff: null, geometry: null, routeOverview: false, followDriver: true, cameraSession: 'idle:idle' });
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [driver.longitude, driver.latitude]);
  assert.equal(h.bounds.length, 1);
});

test('destination Б uses blue in the light theme and white in the dark theme', async t => {
  const h = await mountMap(t, { pickup: { latitude: 41.2, longitude: 72.18 }, dropoff: { latitude: 41.24, longitude: 72.22 }, dropoffRouteLabel: '0,5 км · 1 мин' });
  const letter = () => h.renderer.root.findAllByType('Text').find(node => node.children.includes('Б'));
  assert.equal(letter().parent.props.style[0].backgroundColor, '#246BFD');
  await h.update({ theme: 'dark' });
  assert.equal(letter().parent.props.style[1].backgroundColor, '#FFFFFF');
});

test('passenger sees only the supplied driver and can inspect the route without camera resets', async t => {
  const a = { latitude: 41.1987, longitude: 72.1802 }, b = { latitude: 41.204, longitude: 72.19 };
  const h = await mountMap(t, { passengerView: true, pickup: b, geometry: [a,b], driverPosition: a, cameraSession: 'order:assigned' });
  await h.ready(); assert.equal(h.bounds.length, 1);
  assert.ok(h.renderer.root.findByProps({ accessibilityLabel: 'Ваш водитель' }));
  assert.equal(h.renderer.root.findByType('Image').props.source, 'tracking-car-white.png');
  const passengerMarker = () => h.renderer.root.findByType('MarkerView');
  assert.deepEqual([...passengerMarker().props.coordinate], [a.longitude, a.latitude]);
  assert.deepEqual(JSON.parse(JSON.stringify(passengerMarker().props.anchor)), { x: .5, y: .5 }, 'car stays centered over its coordinate');
  assert.equal(h.renderer.root.findByType('Image').props.style.width, 26, 'passenger car stays compact');
  assert.equal(h.renderer.root.findByType('Image').props.style.height, 38);
  assert.equal(h.renderer.root.findAllByType('UserLocation').length, 0, 'driver marker owns the location display');
  assert.equal(h.renderer.root.findAllByType('CircleLayer').length, 0, 'passenger sees no second blue GPS circle');
  await act(async () => h.map().props.onRegionWillChange(feature(41.2, 72.19, { isUserInteraction: true })));
  await h.update({ geometry: [{ ...a, latitude: 41.199 }, b], driverPosition: { ...a, latitude: 41.199 } });
  assert.equal(h.bounds.length, 1);
  assert.deepEqual([...passengerMarker().props.coordinate], [a.longitude, 41.199], 'panning does not detach the car from the latest GPS fix');
  await h.update({ driverPosition: null }); assert.equal(h.renderer.root.findAllByType('MarkerView').length, 0);
});

test('native and web address lookups use the authenticated API and retain search coordinates', async () => {
  const requests = [], exports = {};
  vm.runInNewContext(compile('mapkit.ts'), { exports, require: id => {
    assert.equal(id, '../api');
    return { api: { request: async url => { requests.push(url); return []; } }, ApiError: class ApiError extends Error {} };
  } });
  assert.equal((await exports.searchAddresses('  a ')).length, 0);
  await exports.searchAddresses('  Чуй 12 ', { latitude: 42.88, longitude: 74.58 });
  assert.equal(requests[0], '/places/search?q=' + encodeURIComponent('Чуй 12') + '&latitude=42.88&longitude=74.58');
  await exports.reverseGeocode({ latitude: 42.89, longitude: 74.59 });
  assert.equal(requests[1], '/places/reverse?latitude=42.89&longitude=74.59');
  await exports.searchAddresses('Чүй', undefined, undefined, 'ky');
  assert.match(requests[2], /language=ky$/);
  await exports.reverseGeocode({ latitude: 42.89, longitude: 74.59 }, 'ky');
  assert.match(requests[3], /language=ky$/);
  assert.match(fs.readFileSync(path.join(__dirname, '../src/native/search.web.ts'), 'utf8'), /from '\.\/mapkit'/);
});

test('Kyrgyz address lookup remains usable against an older API', async () => {
  const requests = [], exports = {};
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  vm.runInNewContext(compile('mapkit.ts'), { exports, require: id => {
    assert.equal(id, '../api');
    return { ApiError, api: { request: async url => {
      requests.push(url);
      if (url.includes('&language=ky')) throw new ApiError(400, 'property language should not exist');
      return [];
    } } };
  } });
  await exports.searchAddresses('Чүй', undefined, undefined, 'ky');
  assert.equal(requests.length, 2);
  assert.match(requests[0], /language=ky$/);
  assert.doesNotMatch(requests[1], /language=/);
});

