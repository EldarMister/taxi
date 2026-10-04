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
const carAnimationExports = {};
vm.runInNewContext(compile('carRouteAnimation.ts'), { exports: carAnimationExports });
const roadMatchExports = {};
vm.runInNewContext(compile('roadMatch.ts'), { exports: roadMatchExports, require: id => {
  if (id === './carRouteAnimation') return carAnimationExports;
  throw Error(id);
} });
const followCameraExports = {};
vm.runInNewContext(compile('followCamera.ts'), { exports: followCameraExports });
const feature = (latitude, longitude, properties = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties });

async function mountMap(t, initialProps, options = {}) {
  const timers = new Map(), frames = new Map(), cameraCalls = [], bounds = [], requests = [], headers = [], nativeShapes = new Map(), appListeners = new Set();
  const animationClock = options.animationClock || { now: Date.now() };
  // UI fixtures default to a real 1 Hz moving GPS sample; motion-specific cases
  // explicitly supply measurement time, speed, accuracy and course.
  const gpsProps = value => value.driverPosition ? { ...value, driverPosition: {
    measuredAtMs: animationClock.now, accuracyM: 5, speedMps: value.driverPosition.speed ?? 5, ...value.driverPosition,
  } } : value;
  let next = 0, renderer, props = gpsProps(initialProps);
  const AppState = { currentState: 'active', addEventListener: (_event, callback) => {
    appListeners.add(callback); return { remove: () => appListeners.delete(callback) };
  } };
  const ShapeSource = React.forwardRef((sourceProps, ref) => {
    React.useImperativeHandle(ref, () => ({ setNativeProps: patch => { nativeShapes.set(sourceProps.id, patch.shape); } }), [sourceProps.id]);
    return React.createElement('ShapeSource', sourceProps);
  });
  const nativeCamera = { setCamera: config => cameraCalls.push(config), fitBounds: (...args) => bounds.push(args) };
  const Camera = React.forwardRef((cameraProps, ref) => { React.useImperativeHandle(ref, () => nativeCamera); return React.createElement('Camera', cameraProps); });
  const NativeMap = React.forwardRef((mapProps, ref) => { React.useImperativeHandle(ref, () => ({
    getCenter: async () => options.mapCenter || null,
    getVisibleBounds: async () => options.mapBounds || [[74.6, 42.9], [74.58, 42.88]],
  })); return React.createElement('MapView', mapProps); });
  const exports = {};
  const api = { baseUrl: 'https://api.example.test/api', request: async (url, init) => {
    requests.push({ url, init });
    if (options.request) return options.request(url, init);
    throw Error('Routing unavailable');
  } };
  const styles = {};
  const playbackExports = {}, markerExports = {};
  const runtime = {
    Date: class extends Date { static now() { return animationClock.now; } },
    performance: { now: () => animationClock.now },
    requestAnimationFrame: callback => { const id = ++next; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  vm.runInNewContext(compile('trackingPlayback.ts'), { ...runtime, exports: playbackExports });
  vm.runInNewContext(compile('DriverTrackingMarker.tsx'), { ...runtime, exports: markerExports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return { AppState };
    if (id === './trackingPlayback') return playbackExports;
    if (id === '@maplibre/maplibre-react-native') return { ShapeSource, CircleLayer: 'CircleLayer', SymbolLayer: 'SymbolLayer' };
    if (id.startsWith('../../assets/')) return path.basename(id);
    throw Error(id);
  } });
  vm.runInNewContext(compile('taxiMapStyle.ts'), { exports: styles, process: { env: options.env || {} }, require: id => {
    if (id === './openfreemap-bright.json') return JSON.parse(fs.readFileSync(path.join(__dirname, '../src/native/openfreemap-bright.json'), 'utf8'));
    throw Error(id);
  } });
  vm.runInNewContext(compile('TaxiMap.tsx'), { ...runtime, exports, process: { env: options.env || {} },
    setTimeout: (callback, delay) => { options.timerDelays?.push(delay); const id = ++next; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'expo-device') return { isDevice: false };
      if (id === 'react-native-svg') return { __esModule: true, default: 'Svg', Path: 'SvgPath' };
      if (id === 'react-native') return { AppState, View: 'View', Image: 'Image', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'Spinner', StyleSheet: { create: s => s }, Linking: { openURL: async () => {} } };
      if (id === '../../assets/tracking-car-white.png') return 'tracking-car-white.png';
      if (id === '../../assets/driver-navigation-arrow.png') return 'driver-navigation-arrow.png';
      if (id === '../../assets/road-signs/traffic-light.png') return 'traffic-light.png';
      if (id === '../../assets/map-crossing-zebra.png') return 'map-crossing-zebra.png';
      if (id === 'react-native-reanimated') return { __esModule: true, default: { View: 'View' }, useAnimatedStyle: fn => ({ evaluate: fn }) };
      if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
      if (id === '../ui') return { Button: 'Button', Icon: 'Icon', PickupIcon: 'PickupIcon', colors: {}, shortAddress: x => x || '', tr: () => value => value };
      if (id === '@maplibre/maplibre-react-native') return { Camera, MapView: NativeMap, PointAnnotation: 'PointAnnotation', MarkerView: 'MarkerView', ShapeSource, LineLayer: 'LineLayer', SymbolLayer: 'SymbolLayer', FillLayer: 'FillLayer', UserLocation: 'UserLocation', addCustomHeader: (...args) => headers.push(args) };
      if (id === '../api') return { api };
      if (id === './mapkit') return { BISHKEK: { latitude: 42.87, longitude: 74.57 }, reverseGeocode: async point => ({ ...point, address: 'Выбранная улица' }) };
      if (id === './location') return { getCurrentPosition: async () => {
        if (options.getPosition) return options.getPosition();
        if (options.locationError) throw options.locationError;
        return options.position || { latitude: 42.88, longitude: 74.59 };
      } };
      if (id === './routeFrame') return frameExports;
      if (id === './carRouteAnimation') return carAnimationExports;
      if (id === './roadMatch') return roadMatchExports;
      if (id === './DriverTrackingMarker') return markerExports;
      if (id === './followCamera') return followCameraExports;
      if (id === './taxiMapStyle') return styles;
      throw Error(id);
    },
  });
  await act(async () => { renderer = create(React.createElement(exports.default, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); assert.equal(timers.size, 0); assert.equal(frames.size, 0); assert.equal(appListeners.size, 0); });
  const map = () => renderer.root.findByType('MapView');
  const update = async patch => {
    if (patch.driverPosition && !options.animationClock) animationClock.now += 1000;
    props = { ...props, ...gpsProps(patch) }; await act(async () => renderer.update(React.createElement(exports.default, props)));
  };
  const ready = async () => { await act(async () => {
    renderer.root.findByProps({ testID: 'map-viewport' }).props.onLayout({ nativeEvent: { layout: { width: 412, height: 914 } } });
    map().props.onDidFinishLoadingStyle();
  }); await settle(); };
  const advanceFrame = async ms => {
    animationClock.now += ms;
    const due = [...frames.values()]; frames.clear();
    await act(async () => { for (const callback of due) callback(); });
  };
  const settle = async (duration = 1800) => { for (let i = 0; i < duration; i += 40) await advanceFrame(40); };
  const shape = id => nativeShapes.get(id) || renderer.root.findByProps({ id }).props.shape;
  const background = async state => { AppState.currentState = state; await act(async () => { for (const listener of appListeners) listener(state); }); };
  return { renderer, map, update, ready, cameraCalls, bounds, requests, headers, timers, frames, advanceFrame, settle, shape, background, appListeners };
}

test('food map uses the shared arrival marker and hides its initial hint after two seconds', async t => {
  const timerDelays = [];
  const h = await mountMap(t, { selectionMode: 'pickup', selectionAppearance: 'food', pickup: { latitude: 42.87, longitude: 74.57 } }, { timerDelays });
  const hints = () => h.renderer.root.findAllByProps({ testID: 'food-pin-hint' });
  assert.equal(hints().length, 0, 'the hint waits until the map is ready');
  await h.ready();
  assert.equal(hints().length, 1);
  assert.ok(timerDelays.includes(2000));
  const pin = h.renderer.root.findByProps({ accessibilityLabel: 'Адрес доставки' });
  assert.equal(pin.findAllByType('PickupIcon').length, 0, 'food uses the arrival marker instead of taxi pickup');
  const arrivalIcon = pin.findByType('Icon');
  assert.equal(arrivalIcon.props.name, 'flag');
  assert.equal(arrivalIcon.props.size, 24, 'the arrival flag uses the square pin size');
  assert.equal(pin.findAllByType('Icon').some(node => node.props.name === 'walk'), false);
  await act(async () => { for (const [id, callback] of [...h.timers]) { h.timers.delete(id); callback(); } });
  assert.equal(hints().length, 0);
  await h.update({ focusPoint: { latitude: 42.88, longitude: 74.58 } });
  assert.equal(hints().length, 0, 'choosing another address does not repeat the hint');
});

test('client booking opens at current GPS even with an old pickup and focus', async t => {
  const position = { latitude: 42.9, longitude: 74.6 };
  const old = { latitude: 42.87, longitude: 74.57 };
  const h = await mountMap(t, { passengerView: true, browsePickup: true, showUserPosition: true, pickup: old, focusPoint: old }, { position });
  await h.ready();
  assert.deepEqual(Array.from(h.cameraCalls.at(-1).centerCoordinate), [74.6, 42.9]);
});

test('delivery points stay centered in the visible map above the order panel', async t => {
  const pickup = { latitude: 42.87, longitude: 74.57 };
  const dropoff = { latitude: 42.89, longitude: 74.59 };
  const h = await mountMap(t, { passengerView: true, pickup, contentTopInset: 110, contentBottomInset: 350, centerInVisibleArea: true });
  await h.ready();
  const camera = h.cameraCalls.at(-1);
  const mercatorY = latitude => (1 - Math.log(Math.tan(latitude * Math.PI / 180)
    + 1 / Math.cos(latitude * Math.PI / 180)) / Math.PI) / 2;
  const markerY = 914 / 2 + (mercatorY(pickup.latitude) - mercatorY(camera.centerCoordinate[1])) * 512 * 2 ** camera.zoomLevel;
  assert.ok(Math.abs(markerY - 246) < 1, `pickup marker is at ${markerY}px in the visible map`);
  assert.equal(camera.padding.paddingBottom, 0, 'a shifted camera center avoids native padding being applied twice');
  await h.update({ dropoff, geometry: [pickup, dropoff] });
  assert.ok(h.bounds.at(-1)[2][2] >= 478, 'route endpoints clear the delivery panel');
});

test('delivery pickup selection rises with its panel while the pin stays at the map center', async t => {
  const pickup = { latitude: 42.87, longitude: 74.57 };
  const h = await mountMap(t, { passengerView: true, pickup, browsePickup: true, centerInVisibleArea: true, contentBottomInset: 350 });
  await h.ready();
  assert.equal(h.renderer.root.findByProps({ testID: 'map-viewport' }).props.style[1].bottom, 210);
  assert.equal(h.renderer.root.findByProps({ accessibilityLabel: 'Метка места подачи' }).props.style[0].top, '50%');
  await h.update({ contentBottomInset: 400 });
  assert.equal(h.renderer.root.findByProps({ testID: 'map-viewport' }).props.style[1].bottom, 240);
});

test('one zoom step loads traffic lights and cross-road markings for a passenger', async t => {
  const mapped = [
    { id: '1:traffic_light', kind: 'traffic_light', latitude: 42.885, longitude: 74.59 },
    { id: '2:pedestrian_crossing', kind: 'pedestrian_crossing', latitude: 41.1963546, longitude: 72.1795808, bearing: 89 },
    { id: '3:pedestrian_crossing', kind: 'pedestrian_crossing', latitude: 41.1963556, longitude: 72.179758, bearing: 90 },
    { id: '4:pedestrian_crossing', kind: 'pedestrian_crossing', latitude: 41.1962771, longitude: 72.1796587, bearing: 360 },
    { id: '5:pedestrian_crossing', kind: 'pedestrian_crossing', latitude: 41.1964142, longitude: 72.1796581, bearing: 360 },
  ];
  const h = await mountMap(t, { passengerView: true }, { request: async url => {
    if (url.startsWith('/routes/map-features?')) return { features: mapped };
    throw Error(url);
  } });
  await h.ready();
  await act(async () => h.map().props.onRegionDidChange(feature(42.89, 74.59, { zoomLevel: 15 })));
  await act(async () => {
    for (const [id, callback] of [...h.timers]) { h.timers.delete(id); callback(); }
  });
  assert.ok(h.requests.some(request => request.url.startsWith('/routes/map-features?')));
  const source = h.renderer.root.findByProps({ id: 'map-road-features' });
  assert.deepEqual(source.props.shape.features.map(item => item.properties.kind),
    ['traffic_light', 'pedestrian_crossing', 'pedestrian_crossing', 'pedestrian_crossing', 'pedestrian_crossing']);
  assert.ok(source.props.shape.features.every(item => item.geometry.type === 'Point'));
  assert.deepEqual(source.props.shape.features.slice(1).map(item => item.properties.bearing), [89, 90, 0, 0]);
  assert.equal(h.renderer.root.findByProps({ id: 'map-traffic-lights' }).props.style.iconImage, 'traffic-light.png');
  assert.equal(h.renderer.root.findByProps({ id: 'map-traffic-lights' }).props.minZoomLevel, 14.5);
  assert.equal(h.renderer.root.findByProps({ id: 'map-traffic-lights' }).props.style.iconAllowOverlap, true);
  const crossing = h.renderer.root.findByProps({ id: 'map-pedestrian-crossings' });
  assert.equal(crossing.props.minZoomLevel, 14.5);
  assert.equal(crossing.props.style.iconImage, 'map-crossing-zebra.png');
  assert.equal(crossing.props.style.iconRotationAlignment, 'map');
  assert.deepEqual(Array.from(crossing.props.style.iconRotate), ['get', 'bearing']);
  assert.deepEqual(JSON.parse(JSON.stringify(crossing.props.style.iconSize)),
    ['interpolate', ['linear'], ['zoom'], 14.5, .22, 16, .34, 19, .62],
    'crosswalk shrinks with the road when zooming out and remains bounded when zooming in');
  assert.equal(crossing.props.style.iconAllowOverlap, true, 'all four crossings remain visible at a signalized junction');
  assert.equal(crossing.props.belowLayerID, 'current-osm-street-major', 'street labels should give way to road markings');
  const bitmap = fs.readFileSync(path.join(__dirname, '../assets/map-crossing-zebra.png'));
  assert.equal(bitmap.readUInt32BE(16), 32);
  assert.equal(bitmap.readUInt32BE(20), 32);
});

test('wider map view still requests road features within the server area limit', async t => {
  const h = await mountMap(t, { passengerView: true }, {
    mapBounds: [[74.61, 42.91], [74.59, 42.86]],
    request: async url => url.startsWith('/routes/map-features?') ? { features: [] } : Promise.reject(Error(url)),
  });
  await h.ready();
  await act(async () => h.map().props.onRegionDidChange(feature(42.89, 74.59, { zoomLevel: 15 })));
  await act(async () => {
    for (const [id, callback] of [...h.timers]) { h.timers.delete(id); callback(); }
  });
  const url = h.requests.find(request => request.url.startsWith('/routes/map-features?'))?.url;
  assert.ok(url);
  const bounds = new URL(`https://api.example.test${url}`).searchParams;
  assert.ok(Number(bounds.get('north')) - Number(bounds.get('south')) < .06);
  assert.ok(Number(bounds.get('east')) - Number(bounds.get('west')) < .08);
});

test('a delayed initial GPS fix does not undo the client dragging the pickup pin', async t => {
  let resolve;
  const pending = new Promise(r => { resolve = r; });
  const h = await mountMap(t, { passengerView: true, browsePickup: true, showUserPosition: true }, { getPosition: () => pending });
  await h.ready();
  await act(async () => h.map().props.onRegionWillChange(feature(42.92, 74.62, { isUserInteraction: true })));
  await act(async () => h.map().props.onRegionDidChange(feature(42.92, 74.62)));
  const calls = h.cameraCalls.length;
  await act(async () => resolve({ latitude: 42.9, longitude: 74.6 }));
  assert.equal(h.cameraCalls.length, calls);
});

test('food map interactions distinguish camera animation and preserve newer choices against delayed GPS', async t => {
  const interactions = [], gpsRequests = [];
  const pickup = { latitude: 42.87, longitude: 74.57 };
  const h = await mountMap(t, {
    passengerView: true, selectionMode: 'pickup', selectionAppearance: 'food', pickup,
    onSelectionInteraction: action => interactions.push(action),
    renderSelectionPanel: selection => React.createElement('SelectionPanel', selection),
  }, { getPosition: () => new Promise(resolve => gpsRequests.push(resolve)) });
  const selection = () => h.renderer.root.findByType('SelectionPanel').props;
  const locate = async () => act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Моё местоположение' }).props.onPress());
  await h.ready();
  await act(async () => h.map().props.onRegionWillChange(feature(pickup.latitude, pickup.longitude, { isUserInteraction: false })));
  await act(async () => h.map().props.onRegionDidChange(feature(pickup.latitude, pickup.longitude, { isUserInteraction: false })));
  assert.deepEqual(interactions, [], 'a programmatic camera move is not a new user selection');

  await locate();
  assert.deepEqual(interactions, ['locate-start']);
  assert.equal(selection().ready, false, 'the old candidate cannot be confirmed while GPS is pending');
  const dragged = { latitude: 42.91, longitude: 74.61 };
  await act(async () => h.map().props.onRegionWillChange(feature(dragged.latitude, dragged.longitude, { isUserInteraction: true })));
  await act(async () => h.map().props.onRegionDidChange(feature(dragged.latitude, dragged.longitude)));
  assert.deepEqual(interactions, ['locate-start', 'move']);
  const callsAfterDrag = h.cameraCalls.length;
  await act(async () => gpsRequests[0]({ latitude: 42.8, longitude: 74.5 }));
  assert.equal(h.cameraCalls.length, callsAfterDrag, 'the stale GPS request must not recenter after a map gesture');
  assert.equal(selection().point.latitude, dragged.latitude);
  assert.equal(selection().point.longitude, dragged.longitude);
  assert.equal(selection().ready, true);
  assert.ok(!interactions.includes('locate-success'), 'a discarded GPS fix must not count as a successful choice');

  await locate();
  const searched = { latitude: 42.93, longitude: 74.63, address: 'Адрес из поиска' };
  await h.update({ focusPoint: searched });
  const callsAfterSearch = h.cameraCalls.length;
  await act(async () => gpsRequests[1]({ latitude: 42.81, longitude: 74.51 }));
  assert.equal(h.cameraCalls.length, callsAfterSearch, 'a newer search focus also invalidates the old GPS request');
  assert.equal(selection().point.latitude, searched.latitude);
  assert.equal(selection().point.longitude, searched.longitude);
  assert.deepEqual(Array.from(h.cameraCalls.at(-1).centerCoordinate), [searched.longitude, searched.latitude]);

  await locate();
  const fresh = { latitude: 42.94, longitude: 74.64 };
  await act(async () => gpsRequests[2](fresh));
  assert.equal(interactions.at(-1), 'locate-success', 'a current GPS request remains usable');
  assert.equal(selection().point.latitude, fresh.latitude);
  assert.equal(selection().point.longitude, fresh.longitude);
  assert.deepEqual(Array.from(h.cameraCalls.at(-1).centerCoordinate), [fresh.longitude, fresh.latitude]);
});

test('routes added after GPS stay explicitly below the driver symbol', async t => {
  const a = { latitude: 42.87, longitude: 74.57 }, b = { latitude: 42.9, longitude: 74.6 };
  const h = await mountMap(t, { navigationActive: true });
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-arrow' }).type, 'SymbolLayer');
  await h.ready();
  await h.update({ driverPosition: a, geometry: [a, b], approachGeometry: [b, a] });
  const layers = h.renderer.root.findAllByType('LineLayer');
  assert.equal(layers.length, 6);
  assert.ok(layers.every(layer => layer.props.belowLayerID === 'driver-navigation-arrow'));
});

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
  const markers = h.renderer.root.findAllByType('MarkerView');
  await act(async () => { markers[0].findByType('Pressable').props.onPress(); markers[1].findByType('Pressable').props.onPress(); });
  assert.deepEqual(edited, ['pickup', 'dropoff']);
  const browsed = [];
  await h.update({ browsePickup: true, dropoff: null, focusPoint: null, onPickupChange: p => browsed.push(p) });
  assert.equal(h.renderer.root.findAllByType('Button').length, 0);
  assert.equal(h.renderer.root.findAllByType('MarkerView').length, 0, 'home has only the fixed center pin');
  await act(async () => h.map().props.onRegionDidChange(feature(42.88, 74.58)));
  await act(async () => { for (const [id, callback] of [...h.timers]) { h.timers.delete(id); callback(); } });
  assert.equal(browsed.at(-1).latitude, 42.88);
  assert.equal(browsed.at(-1).address, 'Выбранная улица');
  assert.equal(selected.length, 2);
});

test('food destination uses the shared map with a custom panel and a settled geocoded address', async t => {
  let selection;
  const h = await mountMap(t, { selectionMode: 'pickup', selectionAppearance: 'food', passengerView: true,
    pickup: { latitude: 42.87, longitude: 74.57 }, renderSelectionPanel: value => { selection = value; return React.createElement('FoodAddressPanel', value); } });
  assert.equal(selection.ready, false);
  assert.equal(h.renderer.root.findAllByType('Button').length, 0, 'taxi confirmation is replaced by food address fields');
  assert.equal(h.renderer.root.findAllByProps({ testID: 'map-zoom-controls' }).length, 0);
  await h.ready();
  await act(async () => h.map().props.onRegionWillChange(feature(42.87, 74.57, { isUserInteraction: true })));
  assert.equal(selection.moving, true);
  await act(async () => h.map().props.onRegionDidChange(feature(42.891, 74.591)));
  assert.equal(selection.locatingAddress, true, 'old address is discarded on movement');
  await act(async () => { for (const [id, callback] of [...h.timers]) { h.timers.delete(id); callback(); } });
  assert.equal(selection.point.latitude, 42.891);
  assert.equal(selection.address, 'Выбранная улица');
  assert.equal(selection.ready, true);
  assert.equal(selection.locatingAddress, false);
  const customPanel = h.renderer.root.findByType('FoodAddressPanel').parent;
  await act(async () => customPanel.props.onLayout({ nativeEvent: { layout: { height: 345 } } }));
  assert.equal(h.renderer.root.findByProps({ testID: 'map-viewport' }).props.style[1].bottom, 345);
  assert.equal(h.renderer.root.findByProps({ testID: 'map-controls' }).props.style[2].bottom, 357);
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
  assert.equal(h.renderer.root.findAllByProps({ testID: 'pickup' }).length, 1, 'passenger pickup is not changed');
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
  assert.equal(300 - compact.props.style[2].top - 60, 16, 'driver controls sit in the bottom corner with a safe gap above the card');
  assert.equal(h.renderer.root.findByProps({ testID: 'map-zoom-controls' }).props.style[1].height, 58);
  assert.ok(compact.props.style[2].top + 60 <= 300, 'all controls fit above the short offer card');
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Показать водителя' }).props.onPress());
  assert.deepEqual(followChanges, [true]);
  await h.update({ followDriver: true });
  await h.settle();
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[0] - 74.57) < .000001);
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[1] - 42.87) < .000001);

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
  await h.settle(600);
  assert.deepEqual(followChanges, []);
  assert.ok(h.cameraCalls.at(-1).centerCoordinate[0] > driver.longitude, 'zoom preserves the forward road view');
  assert.ok(Math.abs(h.cameraCalls.at(-1).heading - 90) < .1, 'native camera callbacks do not override the measured course');
  assert.equal(h.cameraCalls.at(-1).padding.paddingTop, followPadding.paddingTop, 'zoom preserves the camera offset above the driver card');
  const callsAfterZoom = h.cameraCalls.length;
  await h.update({ driverPosition: { ...driver, latitude: 42.8701 } });
  await h.settle(600);
  assert.ok(h.cameraCalls.length > callsAfterZoom, 'GPS keeps the zoomed map centered on the driver');
  assert.ok(h.cameraCalls.at(-1).centerCoordinate[0] > 74.57, 'the navigation camera looks ahead of an eastbound driver');
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[1] - 42.8701) < .000001);
  await act(async () => h.map().props.onRegionWillChange(feature(42.8701, 74.57, { isUserInteraction: true })));
  assert.deepEqual(followChanges, [false]);
  await h.update({ followDriver: false });
  const callsAfterDrag = h.cameraCalls.length;
  await h.update({ driverPosition: { ...driver, latitude: 42.8702 } });
  await h.settle(600);
  assert.equal(h.cameraCalls.length, callsAfterDrag, 'manual free view stays in place during GPS updates');
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Показать водителя' }).props.onPress());
  assert.deepEqual(followChanges, [false, true]);
  await h.update({ followDriver: true });
  await h.settle();
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[1] - 42.8702) < .000001);
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
  const marker = id => h.renderer.root.findByProps({ testID: id });
  assert.equal(marker('dropoff').props.anchor.y, 1, 'an ordinary trip anchors the pin stem to the destination');
  assert.equal(marker('dropoff').findAllByType('Text').length, 0);

  await h.update({ dropoffRouteLabel: '44 км · 1 ч 10 мин' });
  const badgeMarker = marker('dropoff');
  assert.equal(badgeMarker.props.coordinate[0], dropoff.longitude);
  assert.equal(badgeMarker.props.coordinate[1], dropoff.latitude);
  assert.equal(badgeMarker.props.anchor.y, 1, 'the pin stem stays anchored to the destination coordinate');
  assert.equal(marker('pickup').props.anchor.y, 1, 'pickup marker is unaffected');
  assert.equal(badgeMarker.findAll(node => node.props.accessibilityLabel === 'Пункт назначения Б, 44 км · 1 ч 10 мин').length, 1);
  assert.deepEqual(badgeMarker.findAllByType('Text').map(node => node.children.join('')), ['Б', '44 км', '1 ч 10 мин']);

  await h.update({ dropoffRouteLabel: undefined });
  assert.equal(marker('dropoff').props.anchor.y, 1);
  assert.equal(marker('dropoff').findAllByType('Text').length, 0, 'regular route markers never retain the offer badge');
});

test('navigation uses measured course even when the planned route points another way', async t => {
  const clock = { now: 1_000_000 };
  const route = [{ latitude: 42, longitude: 74 }, { latitude: 42.002, longitude: 74 }];
  const point = { latitude: 42.0005, longitude: 74.0001, courseDeg: 90, speedMps: 8, accuracyM: 5, measuredAtMs: clock.now };
  const h = await mountMap(t, { pickup: route[0], dropoff: route[1], geometry: route,
    driverPosition: point, navigationActive: true, followDriver: true, showUserPosition: true }, { animationClock: clock });
  assert.ok(Math.abs(h.shape('driver-navigation-position').geometry.coordinates[0] - point.longitude) < 1e-10);
  assert.equal(h.shape('driver-navigation-position').geometry.coordinates[1], point.latitude);
  await h.ready();
  const marker = h.shape('driver-navigation-position');
  assert.ok(marker.geometry.coordinates[0] >= point.longitude, 'bounded local prediction follows measured course, never the planned road');
  assert.equal(marker.properties.bearing, 90, 'a preview road cannot override measured course');
  assert.ok(Math.abs(h.cameraCalls.at(-1).heading - 90) < .1);
  assert.ok(h.cameraCalls.at(-1).centerCoordinate[0] > point.longitude, 'camera looks ahead to the east');
  assert.equal(h.renderer.root.findAllByType('UserLocation').length, 0, 'navigation uses the owning local GPS stream');
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-accuracy' }).length, 0);
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-arrow' }).props.style.iconImage, 'driver-navigation-arrow.png');
  assert.equal(h.requests.length, 0);
});

test('driver marker and camera turn on the same interruptible frame stream', async t => {
  const clock = { now: 1_000_000 };
  const first = { latitude: 42, longitude: 74, courseDeg: 0, speedMps: 6, accuracyM: 5, measuredAtMs: clock.now };
  const h = await mountMap(t, { driverPosition: first, navigationActive: true, followDriver: true }, { animationClock: clock });
  await h.ready();
  const before = h.cameraCalls.length;
  const displayed = [...h.shape('driver-navigation-position').geometry.coordinates];
  const second = { ...first, latitude: 42.0001, longitude: 74.0001, courseDeg: 90, measuredAtMs: clock.now };
  await h.update({ driverPosition: second });
  const initial = h.shape('driver-navigation-position');
  assert.deepEqual([...initial.geometry.coordinates], displayed, 'a new target starts at the displayed point');
  await h.advanceFrame(120);
  const middle = h.shape('driver-navigation-position');
  assert.ok(middle.properties.bearing > 0 && middle.properties.bearing < 90);
  assert.ok(middle.geometry.coordinates[0] > 74 && middle.geometry.coordinates[0] < second.longitude);
  assert.ok(h.cameraCalls.at(-1).heading > 0 && h.cameraCalls.at(-1).heading <= middle.properties.bearing);
  assert.equal(h.frames.size, 1, 'there is one active animation stream');
  assert.ok(h.cameraCalls.length > before);
  await h.settle(1600);
  assert.ok(Math.abs(h.shape('driver-navigation-position').properties.bearing - 90) < .001);
  assert.ok(Math.abs(h.cameraCalls.at(-1).heading - 90) < .5, 'camera damping settles to within half a degree');
  assert.ok(h.cameraCalls.slice(before).every(call => call.animationDuration === 0 && call.animationMode === 'moveTo'));
});

test('driver navigation stays course-up without a camera mode button', async t => {
  const h = await mountMap(t, { navigationActive: true, followDriver: true,
    driverPosition: { latitude: 42, longitude: 74, courseDeg: 270, speedMps: 8 } });
  await h.ready();
  assert.equal(h.renderer.root.findAllByProps({ testID: 'navigation-camera-mode' }).length, 0);
  assert.ok(Math.abs(followCameraExports.shortestBearingDelta(h.cameraCalls.at(-1).heading, 270)) < .1);
  assert.equal(h.shape('driver-navigation-position').properties.bearing, 270);
});

test('client tracking keeps the car with no GPS data panel even in diagnostic builds', async t => {
  const h = await mountMap(t, { passengerView: true,
    driverPosition: { latitude: 42, longitude: 74, courseDeg: 90, speedMps: 4 } },
    { env: { EXPO_PUBLIC_TRACKING_DIAGNOSTICS: '1' } });
  assert.equal(h.renderer.root.findAllByProps({ testID: 'client-tracking-diagnostics' }).length, 0);
  assert.equal(h.renderer.root.findByProps({ id: 'client-driver-car' }).props.style.iconImage, 'tracking-car-white.png');
});

test('driver display corrects a small roadside offset without changing GPS data or measured course', async t => {
  const point = { latitude: 42.0005, longitude: 74.00003, courseDeg: 0, speedMps: 6, accuracyM: 2 };
  const h = await mountMap(t, { navigationActive: true, followDriver: true, driverPosition: point,
    geometry: [{ latitude: 42, longitude: 74 }, { latitude: 42.001, longitude: 74 }] });
  await h.ready();
  assert.equal(h.shape('driver-navigation-position').geometry.coordinates[0], 74);
  assert.equal(h.shape('driver-navigation-position').properties.bearing, 0);
  assert.equal(point.longitude, 74.00003, 'display correction cannot mutate the source GPS measurement');
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[0] - 74) < .000001);
});

test('a gesture pauses camera immediately while marker frames continue and recenter smoothly resumes', async t => {
  const clock = { now: 1_000_000 }, followChanges = [];
  const first = { latitude: 42, longitude: 74, courseDeg: 0, speedMps: 6, measuredAtMs: clock.now };
  const h = await mountMap(t, { driverPosition: first, navigationActive: true, followDriver: true,
    onFollowDriverChange: value => followChanges.push(value) }, { animationClock: clock });
  await h.ready();
  await act(async () => h.map().props.onRegionWillChange(feature(42.01, 74.01, { isUserInteraction: true, heading: 110, zoomLevel: 15 })));
  const before = h.cameraCalls.length;
  await h.update({ driverPosition: { ...first, latitude: 42.0001, measuredAtMs: clock.now } });
  await h.settle(500);
  assert.equal(h.cameraCalls.length, before, 'gesture pauses before the parent rerenders followDriver');
  assert.ok(h.shape('driver-navigation-position').geometry.coordinates[1] > 42);
  assert.deepEqual(followChanges, [false]);
  await h.update({ followDriver: false });
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Показать водителя' }).props.onPress());
  await h.update({ followDriver: true });
  await h.advanceFrame(40);
  const firstReturn = h.cameraCalls.at(-1);
  assert.ok(firstReturn.centerCoordinate[1] > 42.0001 && firstReturn.centerCoordinate[1] < 42.01);
  assert.ok(firstReturn.heading > 0 && firstReturn.heading < 110);
  await h.settle(1400);
  assert.ok(h.cameraCalls.at(-1).centerCoordinate[1] < 42.001);
  assert.deepEqual(followChanges, [false, true]);
});

test('a measured route departure moves both marker and camera away from the planned road', async t => {
  const clock = { now: 1_000_000 };
  const road = [{ latitude: 42, longitude: 74 }, { latitude: 42.001, longitude: 74 }];
  const first = { latitude: 42.0005, longitude: 74, courseDeg: 0, speedMps: 5, accuracyM: 5, measuredAtMs: clock.now };
  const h = await mountMap(t, { geometry: road, driverPosition: first, navigationActive: true, followDriver: true }, { animationClock: clock });
  await h.ready();
  const turned = { ...first, longitude: 73.99982, courseDeg: 270, matched: false, measuredAtMs: clock.now };
  await h.update({ driverPosition: turned });
  await h.settle(1200);
  const shownLongitude = h.shape('driver-navigation-position').geometry.coordinates[0];
  assert.ok(shownLongitude <= turned.longitude && shownLongitude > turned.longitude - .0001, 'only bounded prediction may advance beyond the new measurement');
  assert.ok(h.cameraCalls.at(-1).centerCoordinate[0] < turned.longitude);
});

test('client movement is interpolated between measurements and is independent of the preview route', async t => {
  const clock = { now: 1_000_000 };
  const first = { latitude: 42, longitude: 74.0001, courseDeg: 0, speedMps: 6, accuracyM: 5, measuredAtMs: clock.now };
  const h = await mountMap(t, { passengerView: true,
    geometry: [{ latitude: 42, longitude: 74 }, { latitude: 42.001, longitude: 74 }], driverPosition: first }, { animationClock: clock });
  assert.equal(h.shape('client-driver-position').geometry.coordinates[0], first.longitude, 'no forced snap to the preview road');
  await h.advanceFrame(1000);
  const second = { ...first, latitude: 42.0001, measuredAtMs: clock.now };
  await h.update({ driverPosition: second });
  const atArrival = h.shape('client-driver-position').geometry.coordinates[1];
  await h.advanceFrame(400);
  const middle = h.shape('client-driver-position').geometry.coordinates[1];
  assert.ok(middle > atArrival && middle < second.latitude, 'native source moves without a new GPS/network event');
  await h.settle(2000);
  assert.ok(Math.abs(h.shape('client-driver-position').geometry.coordinates[1] - second.latitude) < 1e-8);
  const confirmed = h.shape('client-driver-position');
  await h.advanceFrame(20_000);
  assert.ok(h.shape('client-driver-position').geometry.coordinates.every((value, index) =>
    Math.abs(value - confirmed.geometry.coordinates[index]) < 1e-10), 'loss of signal never extrapolates beyond the last measurement');
});

test('stopping preserves course through GPS and device-heading noise', async t => {
  const clock = { now: 1_000_000 };
  const first = { latitude: 42, longitude: 74, courseDeg: 359, speedMps: 4, accuracyM: 5, measuredAtMs: clock.now };
  const h = await mountMap(t, { driverPosition: first, navigationActive: true, followDriver: true }, { animationClock: clock });
  await h.ready();
  await h.update({ driverPosition: { ...first, longitude: 74.00001, courseDeg: 180, heading: 90,
    deviceHeading: 270, speedMps: 0, measuredAtMs: clock.now } });
  await h.settle(800);
  assert.equal(h.shape('driver-navigation-position').properties.bearing, 359);
  assert.ok(Math.abs(followCameraExports.shortestBearingDelta(h.cameraCalls.at(-1).heading, 359)) < .1);
  await h.update({ driverPosition: { ...first, latitude: 42.0001, courseDeg: 1, speedMps: 4, measuredAtMs: clock.now } });
  await h.advanceFrame(120);
  const bearing = h.shape('driver-navigation-position').properties.bearing;
  assert.ok(bearing > 359 || bearing < 1, '359 to 1 follows the two-degree arc');
});

test('client keeps its original car at rest before course is known and during movement', async t => {
  const clock = { now: 1_000_000 };
  const h = await mountMap(t, { passengerView: true,
    driverPosition: { latitude: 42, longitude: 74, courseDeg: null, heading: 0, speedMps: 0 } },
    { animationClock: clock });
  assert.equal(h.shape('client-driver-position').properties.bearing, null);
  assert.equal(h.shape('client-driver-position').properties.hasBearing, false);
  assert.equal(h.renderer.root.findAllByProps({ id: 'client-driver-unknown-course' }).length, 0);
  const car = h.renderer.root.findByProps({ id: 'client-driver-car' });
  assert.equal(car.props.filter, undefined, 'the car remains visible without a measured course');
  assert.equal(car.props.style.iconImage, 'tracking-car-white.png');
  assert.equal(car.props.style.iconSize, .025);
  assert.equal(car.props.style.iconRotationAlignment, 'map');
  assert.deepEqual(JSON.parse(JSON.stringify(car.props.style.iconRotate)), ['+', ['coalesce', ['get', 'bearing'], 0], 0]);
  await h.advanceFrame(1000);
  await h.update({ driverPosition: { latitude: 42.0001, longitude: 74, courseDeg: 90, speedMps: 6 } });
  await h.settle();
  assert.equal(h.shape('client-driver-position').properties.hasBearing, true);
  assert.equal(h.shape('client-driver-position').properties.bearing, 90);
  assert.equal(h.renderer.root.findByProps({ id: 'client-driver-car' }).props.style.iconImage, 'tracking-car-white.png');
});

test('driver keeps its original arrow at rest and on movement, including diagnostic builds', async t => {
  const clock = { now: 1_000_000 };
  const h = await mountMap(t, { navigationActive: true, followDriver: true,
    driverPosition: { latitude: 42, longitude: 74, courseDeg: null, heading: 0, speedMps: 0 } },
    { animationClock: clock, env: { EXPO_PUBLIC_TRACKING_DIAGNOSTICS: '1' } });
  await h.ready();
  assert.equal(h.shape('driver-navigation-position').properties.hasBearing, false);
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-navigation-unknown-course' }).length, 0, 'driver arrow is never replaced by a circle');
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-navigation-unknown-course-halo' }).length, 0);
  const arrow = h.renderer.root.findByProps({ id: 'driver-navigation-arrow' });
  assert.equal(arrow.props.filter, undefined, 'the original arrow is visible even before movement supplies a course');
  assert.equal(arrow.props.style.iconImage, 'driver-navigation-arrow.png');
  assert.equal(arrow.props.style.iconSize, .42, 'keep the original arrow size');
  assert.deepEqual(JSON.parse(JSON.stringify(arrow.props.style.iconRotate)), ['+', ['coalesce', ['get', 'bearing'], 0], 0]);
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-raw-debug' }).length, 0);
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-accuracy' }).length, 0);
  await h.update({ driverPosition: { latitude: 42.0001, longitude: 74, courseDeg: 90, speedMps: 6 } });
  await h.settle();
  assert.equal(h.shape('driver-navigation-position').properties.hasBearing, true);
  assert.equal(h.renderer.root.findByProps({ id: 'driver-navigation-arrow' }).props.style.iconImage, 'driver-navigation-arrow.png');
});

test('animation pauses in background, resumes once, and cleans up on assignment replacement and unmount', async t => {
  const h = await mountMap(t, { passengerView: true,
    driverPosition: { latitude: 42, longitude: 74, courseDeg: 90, speedMps: 4, assignmentId: 'first' } });
  assert.equal(h.frames.size, 1);
  assert.equal(h.appListeners.size, 1);
  await h.background('background');
  assert.equal(h.frames.size, 0);
  await h.background('active');
  await h.background('active');
  assert.equal(h.frames.size, 1, 'repeated foreground events cannot start a second loop');
  await h.update({ driverPosition: { latitude: 42, longitude: 74, courseDeg: 270, speedMps: 4, assignmentId: 'second' } });
  assert.equal(h.frames.size, 1);
  assert.equal(h.appListeners.size, 1);
  assert.equal(h.shape('client-driver-position').properties.bearing, 270);
  // mountMap's cleanup also asserts every timer, frame and AppState listener is removed.
});
test('driver trims the guidance line while client preserves the planned route without rematching the car', async t => {
  const road = [
    { latitude: 42, longitude: 74 },
    { latitude: 42.001, longitude: 74 },
    { latitude: 42.001, longitude: 74.001 },
  ];
  const position = { latitude: 42.0005, longitude: 74.00002, accuracy: 5 };
  const h = await mountMap(t, {
    pickup: road[0], dropoff: road[2], geometry: road, driverPosition: position,
    navigationActive: true, followDriver: true, routeProgressMeters: 55,
  });
  await h.ready();
  let coordinates = h.renderer.root.findByProps({ id: 'route' }).props.shape.coordinates;
  assert.ok(coordinates[0][1] > road[0].latitude);
  await h.update({ navigationActive: false, followDriver: false, passengerView: true, routeProgressMeters: undefined });
  coordinates = h.renderer.root.findByProps({ id: 'route' }).props.shape.coordinates;
  assert.equal(coordinates[0][1], road[0].latitude);
  assert.equal(h.shape('client-driver-position').geometry.coordinates[0], position.longitude);
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
  const h = await mountMap(t, { passengerView: true, pickup: route[0], dropoff: route[2], geometry: route, contentTopInset: 110, showUserPosition: true }, { env: { EXPO_PUBLIC_OSM_TILE_URL: 'https://tiles.example.test/{z}/{x}/{y}.png' } });
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
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-agricultural-areas')['source-layer'], 'land');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-natural-ground')['source-layer'], 'land');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-wetlands')['source-layer'], 'land');
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
  for (const kind of ['allotments', 'vineyard', 'heath', 'scrub', 'sand', 'bare_rock', 'marsh']) {
    assert.ok(style.layers.some(layer => layer['source-layer'] === 'land' && JSON.stringify(layer.filter).includes(`"${kind}"`)), `${kind} remains visible at detailed zoom`);
  }
  for (const kind of ['sports_center', 'sports_centre', 'construction', 'prison', 'danger_area']) {
    assert.ok(JSON.stringify(style.layers.find(layer => layer.id === 'current-osm-sites').filter).includes(`"${kind}"`), `${kind} territory is styled`);
  }
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-addresses')['source-layer'], 'addresses');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-pois')['source-layer'], 'pois');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-pois').minzoom, 14);
  assert.equal(style.layers.some(layer => layer.id.startsWith('highway-name-')), false, 'stale OpenMapTiles street names are hidden');
  assert.equal(style.layers.some(layer => layer.id.startsWith('highway-shield-')), false, 'stale route shields cannot hide current street names');
  assert.equal(style.layers.find(layer => layer.id === 'overview-street-local').minzoom, 13, 'minor street names appear before detailed zoom');
  assert.equal(style.layers.find(layer => layer.id === 'overview-street-local').maxzoom, 14, 'overview names hand off without duplication');
  assert.ok(JSON.stringify(style.layers.find(layer => layer.id === 'overview-street-local').filter).includes('"minor"'));
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-road-ref').minzoom, 13, 'route numbers do not hide street names on the overview');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-road-ref').maxzoom, 15.5, 'route numbers leave room for street names at close zoom');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-street-major').maxzoom, 15.5);
  assert.notEqual(style.layers.find(layer => layer.id === 'current-osm-street-major').layout['text-allow-overlap'], true, 'major street names must not cover each other');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-street-major-detail').minzoom, 15.5);
  assert.notEqual(style.layers.find(layer => layer.id === 'current-osm-street-major-detail').layout['text-allow-overlap'], true, 'major street names avoid crossings at close zoom');
  assert.notEqual(style.layers.find(layer => layer.id === 'current-osm-street-local').layout['text-allow-overlap'], true, 'local street names avoid other labels');
  assert.equal(style.layers.find(layer => layer.id === 'current-osm-street-area-names')['source-layer'], 'streets_polygons_labels');
  assert.ok(style.layers.findIndex(layer => layer.id === 'current-osm-street-major') > style.layers.findIndex(layer => layer.id === 'poi_r20'));
  assert.ok(style.layers.findIndex(layer => layer.id === 'current-osm-street-major') < style.layers.findIndex(layer => layer.id === 'current-osm-road-ref'), 'street names take label priority over route shields');
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
  await h.settle();
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[1] - h.shape('driver-navigation-position').geometry.coordinates[1]) < .000001);
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[1] - 41.199) < .0001, 'idle recenter returns near the driver, not the startup city');
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

test('late client GPS replaces the startup city camera and displays a dot without an accuracy radius', async t => {
  const seen = [];
  const h = await mountMap(t, { passengerView: true, showUserPosition: true, onUserLocation: point => seen.push(point) });
  await h.ready();
  const puck = h.renderer.root.findByType('UserLocation');
  assert.equal(puck.props.visible, false);
  await act(async () => puck.props.onUpdate({ timestamp: Date.now(), coords: { latitude: 41.1987, longitude: 72.1802, accuracy: 8 } }));
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [72.1802, 41.1987]);
  assert.equal(h.renderer.root.findByProps({ id: 'client-user-position' }).props.coordinate[1], 41.1987);
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-accuracy' }).length, 0);
  assert.equal(seen.length, 1);
});

test('following client GPS keeps an explicitly chosen pickup pin unchanged', async t => {
  const pickup = { latitude: 41.24, longitude: 72.25, address: 'Выбранный вручную адрес' };
  const changed = [];
  const h = await mountMap(t, { passengerView: true, showUserPosition: true, pickup, browsePickup: false, onPickupChange: point => changed.push(point) });
  await h.ready();
  await act(async () => h.renderer.root.findByType('UserLocation').props.onUpdate({
    timestamp: Date.now(), coords: { latitude: 41.1987, longitude: 72.1802, accuracy: 8 },
  }));
  assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [72.1802, 41.1987]);
  assert.deepEqual([...h.renderer.root.findByProps({ testID: 'pickup' }).props.coordinate], [pickup.longitude, pickup.latitude]);
  assert.equal(changed.length, 0);
});

test('dark approach route has a distinct amber line alongside the white fare route', async t => {
  const a = { latitude: 41.1987, longitude: 72.1802 }, b = { latitude: 41.20, longitude: 72.183 };
  const h = await mountMap(t, { theme: 'dark', pickup: a, dropoff: b, geometry: [a, b], approachGeometry: [a, b] });
  await h.ready();
  assert.equal(h.renderer.root.findByProps({ id: 'approach-route-line' }).props.style.lineColor, '#FFBC4B');
  assert.equal(h.renderer.root.findByProps({ id: 'route-line' }).props.style.lineColor, '#F0F0F0');
});

test('destination Б uses blue in the light theme and white in the dark theme', async t => {
  const h = await mountMap(t, { pickup: { latitude: 41.2, longitude: 72.18 }, dropoff: { latitude: 41.24, longitude: 72.22 }, dropoffRouteLabel: '0,5 км · 1 мин' });
  const letter = () => h.renderer.root.findAllByType('Text').find(node => node.children.includes('Б'));
  assert.equal(letter().parent.props.style[0].backgroundColor, '#246BFD');
  await h.update({ theme: 'dark' });
  assert.equal(letter().parent.props.style[1].backgroundColor, '#FFFFFF');
});

test('passenger sees only the supplied driver and can inspect the route without camera resets', async t => {
  const a = { latitude: 41.1987, longitude: 72.1802, courseDeg: 90, speedMps: 6 }, b = { latitude: 41.204, longitude: 72.19 };
  const h = await mountMap(t, { passengerView: true, pickup: b, geometry: [a,b], driverPosition: a, cameraSession: 'order:ASSIGNED' });
  await h.ready(); assert.deepEqual([...h.cameraCalls.at(-1).centerCoordinate], [a.longitude, a.latitude]);
  const source = () => h.shape('client-driver-position');
  const car = () => h.renderer.root.findByProps({ id: 'client-driver-car' });
  assert.deepEqual([...source().geometry.coordinates], [a.longitude, a.latitude]);
  assert.equal(car().props.style.iconImage, 'tracking-car-white.png');
  assert.equal(car().props.style.iconSize, .025, 'the 1046×1504 source uses a scale, not logical pixels');
  assert.equal(car().props.style.iconAnchor, 'center');
  assert.deepEqual([...car().props.style.iconOffset], [0, 0]);
  assert.equal(car().props.style.iconRotationAlignment, 'map');
  assert.equal(car().props.style.iconAllowOverlap, true);
  assert.equal(h.renderer.root.findAllByType('MarkerView').filter(node => !['pickup', 'dropoff'].includes(node.props.testID)).length, 0, 'car is a geographical MapLibre symbol');
  assert.equal(h.renderer.root.findAllByType('UserLocation').length, 0, 'driver marker owns the location display');
  assert.equal(source().properties.hasBearing, true, 'the neutral point is hidden once course is known');
  assert.equal(h.renderer.root.findAllByProps({ id: 'driver-accuracy' }).length, 0, 'no duplicate GPS accuracy circle');
  const beforeStage = h.cameraCalls.length;
  await h.update({ cameraSession: 'order:ARRIVED' });
  assert.equal(h.cameraCalls.length, beforeStage, 'stage changes do not reset the followed zoom or camera');
  await act(async () => h.map().props.onRegionWillChange(feature(41.2, 72.19, { isUserInteraction: true, heading: 77 })));
  const cameraCallsAfterPan = h.cameraCalls.length;
  await h.update({ geometry: [{ ...a, latitude: 41.199 }, b], driverPosition: { ...a, latitude: 41.199, heading: 90 }, cameraSession: 'order:IN_PROGRESS' });
  await h.settle(3000);
  assert.equal(h.cameraCalls.length, cameraCallsAfterPan, 'status and GPS updates preserve free inspection');
  assert.ok(Math.abs(source().geometry.coordinates[0] - a.longitude) < 1e-10);
  assert.equal(source().geometry.coordinates[1], 41.199, 'panning does not detach the car from the latest GPS fix');
  assert.equal(source().properties.bearing, 90, 'camera heading must not change true geographic bearing');
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Показать водителя' }).props.onPress());
  await h.settle();
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[0] - a.longitude) < .000001);
  assert.ok(Math.abs(h.cameraCalls.at(-1).centerCoordinate[1] - 41.199) < .000001);
  await h.update({ driverPosition: null });
  assert.equal(source().type, 'FeatureCollection');
  assert.equal(source().features.length, 0, 'missing GPS removes the car while preserving the layer ordering anchor');
});

test('native car converts latitude and longitude at the MapLibre boundary', async t => {
  const h = await mountMap(t, { passengerView: true, driverPosition: { latitude: 42, longitude: 74, heading: 0 }, cameraSession: 'sample:ASSIGNED' });
  await h.ready();
  assert.deepEqual([...h.shape('client-driver-position').geometry.coordinates], [74, 42]);
  assert.equal(h.shape('client-driver-position').properties.bearing, 0, 'zero degrees is a real heading');
  assert.deepEqual(JSON.parse(JSON.stringify(h.renderer.root.findByProps({ id: 'client-driver-car' }).props.style.iconRotate)),
    ['+', ['coalesce', ['get', 'bearing'], 0], 0], 'asset nose points north, with no extra camera compensation');
  await act(async () => h.map().props.onRegionWillChange(feature(42, 74, { isUserInteraction: true, heading: 173, zoomLevel: 15 })));
  assert.deepEqual([...h.shape('client-driver-position').geometry.coordinates], [74, 42]);
  assert.equal(h.shape('client-driver-position').properties.bearing, 0, 'rotation cannot affect the driver fix');
  await act(async () => h.renderer.root.findByProps({ accessibilityLabel: 'Приблизить карту' }).props.onPress());
  assert.equal(h.shape('client-driver-position').properties.bearing, 0, 'zoom cannot change vehicle bearing either');
});

test('a status transition keeps the stopped car heading while a new assignment resets it', async t => {
  const point = { latitude: 42, longitude: 74, accuracyM: 5, assignmentId: 'assignment-one', heading: 90 };
  const h = await mountMap(t, { passengerView: true, driverPosition: point, cameraSession: 'order:ASSIGNED' });
  const bearing = () => h.shape('client-driver-position').properties.bearing;
  assert.equal(bearing(), 90);
  await h.update({ driverPosition: { ...point, heading: 270, speedMps: 0 }, cameraSession: 'order:IN_PROGRESS' });
  await h.settle();
  assert.equal(bearing(), 90, 'a stage change is not a new GPS bearing');
  await h.update({ driverPosition: { ...point, assignmentId: 'assignment-two', heading: 270 } });
  assert.equal(bearing(), 270, 'a replacement driver starts a new heading history');
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


test('new offer restores overview above tall panel after manual pan and style reload', async t => {
  const pickup = { latitude: 42, longitude: 74 }, dropoff = { latitude: 42.01, longitude: 74.01 };
  const driverPosition = { latitude: 41.99, longitude: 73.99 };
  const h = await mountMap(t, { pickup, dropoff, driverPosition, geometry: [pickup, dropoff], cameraSession: 'offer-one:SEARCHING', contentTopInset: 150, contentBottomInset: 510 });
  await h.ready();
  assert.ok(h.bounds.at(-1)[2][2] >= 510);
  assert.equal(h.bounds.at(-1)[1][0], driverPosition.longitude);
  for (const marker of h.renderer.root.findAllByType('MarkerView')) assert.equal(marker.props.allowOverlap, true);
  await act(async () => h.map().props.onRegionWillChange(feature(42, 74, { isUserInteraction: true })));
  const before = h.bounds.length;
  await h.update({ cameraSession: 'offer-two:SEARCHING' });
  assert.equal(h.bounds.length, before + 1);
  await act(async () => h.map().props.onDidFinishLoadingStyle());
  assert.equal(h.bounds.length, before + 2);
});


test('driver map controls and camera padding share the sheet animation clock without rerenders', async t => {
  let currentInset = 200;
  const animatedBottomInset = { get: () => currentInset };
  const h = await mountMap(t, { contentBottomInset: 200, animatedBottomInset, navigationActive: true, followDriver: true,
    driverPosition: { latitude: 42.87, longitude: 74.59, heading: 0, speed: 0, timestamp: Date.now() } });
  await h.ready();
  const controls = h.renderer.root.findByProps({ testID: 'map-controls' });
  const style = controls.props.style.at(-1);
  const initial = style.evaluate().transform[0].translateY;
  const cameraCount = h.cameraCalls.length;
  for (const inset of [220, 250, 280, 310]) {
    currentInset = inset;
    assert.equal(style.evaluate().transform[0].translateY - initial, 200 - inset);
    await h.advanceFrame(40);
    assert.equal(h.cameraCalls.at(-1).padding.paddingBottom, inset + 16);
  }
  assert.ok(h.cameraCalls.length > cameraCount);
  assert.equal(h.renderer.root.findByProps({ testID: 'map-controls' }), controls, 'the moving panel does not rerender map controls');
});
