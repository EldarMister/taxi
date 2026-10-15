const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const ts = require('typescript');
const React = require('react');
const { create, act } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let deferSheetExit = false;
let pendingSheetExits = [];
let deferRootExit = false;
let pendingRootExits = [];
let openedUrl = '';
let hardwareBackHandler = null;
class AnimatedValue {
  constructor(value) { this.value = value; }
  setValue(value) { this.value = value; }
  interpolate(config) { return { source: this, config }; }
}
const animate = (value, config) => ({ start(callback) {
  const finish = () => { value.setValue(config.toValue); callback?.({ finished: true }); };
  if (deferRootExit && config.toValue === 0) pendingRootExits.push(finish);
  else finish();
}, stop() {} });
let windowDimensions = { width: 412, height: 914 };
const native = {
  View: 'View', Text: 'Text', Pressable: 'Pressable', TextInput: 'TextInput', ScrollView: 'ScrollView', Image: 'Image', KeyboardAvoidingView: 'KeyboardAvoidingView', ActivityIndicator: 'Spinner',
  Animated: { Text: 'AnimatedText', Image: 'AnimatedImage', event: () => () => {}, View: 'AnimatedView', Value: AnimatedValue, spring: animate, timing: animate },
  PanResponder: { create: handlers => ({ panHandlers: handlers }) },
  Easing: { in: x => x, out: x => x, cubic: 'cubic' }, Platform: { OS: 'android' },
  StyleSheet: { create: x => x, absoluteFill: {}, absoluteFillObject: {}, hairlineWidth: 1 }, Keyboard: { dismiss() {} }, Linking: { openURL(url) { openedUrl = url; } }, useWindowDimensions: () => windowDimensions,
  BackHandler: { addEventListener(_event, callback) { hardwareBackHandler = callback; return { remove() { if (hardwareBackHandler === callback) hardwareBackHandler = null; } }; } },
};
let pickedContact = null;
const contacts = { isAvailableAsync: async () => true, requestPermissionsAsync: async () => ({ granted: true }), presentContactPickerAsync: async () => pickedContact };
const ui = { Car: 'Car', Avatar: 'Avatar', Icon: 'Icon', Button: 'Button', Route: 'Route', PickupIcon: 'PickupIcon', ToggleSwitch: 'ToggleSwitch', s: {}, colors: { blue: '#087FFF', muted: '#63718D' }, tr: () => x => x, localize: (language, ru, ky) => language === 'ky' ? ky : ru, shortAddress: x => x || '', km: x => String(x), mins: x => String(x), tripTime: x => String(x), money: x => String(x) };
let darkTheme = false;
const lightPalette = { background: '#F4F8FD', surface: '#FFFFFF', elevated: '#F3F7FF', ink: '#101D38', muted: '#63718D', line: '#E5EDF6', accent: '#087FFF', accentText: '#FFFFFF', backdrop: 'rgba(16,29,56,.42)' };
const darkPalette = { background: '#050505', surface: '#111111', elevated: '#1D1D1D', ink: '#FFFFFF', muted: '#B0B0B0', line: '#353535', accent: '#FFFFFF', accentText: '#050505', backdrop: 'rgba(0,0,0,.68)' };
function load(file) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, setInterval, clearInterval, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return native;
    if (id === 'react-native-reanimated') return {
      __esModule: true, default: { View: 'ReanimatedView' },
      useSharedValue: initial => {
        const ref = React.useRef();
        if (!ref.current) {
          let value = initial;
          ref.current = { get: () => value, set: next => {
            if (next?.animation) { value = next.to; next.callback?.(true); }
            else value = typeof next === 'function' ? next(value) : next;
          } };
        }
        return ref.current;
      },
      useAnimatedStyle: evaluate => ({ evaluate }), cancelAnimation() {}, runOnJS: fn => fn,
      Easing: { bezier: () => 'sheet' },
      withTiming: (to, config, callback) => ({ animation: 'timing', to, config, callback }),
      withSpring: (to, config, callback) => ({ animation: 'spring', to, config, callback }),
    };
    if (id === 'expo-contacts') return contacts;
    if (id === 'react-native-svg') return { __esModule: true, default: 'Svg', Path: 'Path', Circle: 'Circle' };
    if (id === 'react-native-gesture-handler') return {
      PanGestureHandler: 'PanGestureHandler', GestureDetector: 'GestureDetector', State: { BEGAN: 2, END: 5, CANCELLED: 3, FAILED: 1 },
      Gesture: { Pan: () => {
        const gesture = { config: {}, handlers: {} };
        for (const option of ['enabled', 'activeOffsetY', 'failOffsetX', 'failOffsetY', 'runOnJS']) {
          gesture[option] = value => { gesture.config[option] = value; return gesture; };
        }
        for (const callback of ['onStart', 'onUpdate', 'onEnd', 'onFinalize']) gesture[callback] = handler => { gesture.handlers[callback] = handler; return gesture; };
        return gesture;
      } },
    };
    if (id === './navigation') return { displayDistance: value => value + ' м', distantManeuverInstruction: progress => progress.instruction,
      distanceBetween: () => 125, navigationConfig: { offRouteMeters: 40 }, offRouteThreshold: () => 40,
      normalizeManeuver: step => ({ kind: step.maneuver.type, side: step.maneuver.modifier }) };
    if (id === './RoadFeatureAlerts') return { RoadFeatureAlerts: 'RoadFeatureAlerts' };
    if (id === './native/driverTracking') return { getDriverTrackingDiagnostics: () => ({ raw: null, processed: null, ageMs: null,
      trackingSessionId: null, sequence: 0, transportStatus: 'idle', lastDropReason: '' }), stopDriverGpsDiagnostic() {} };
    if (id === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) };
    if (id === './ui') return ui;
    if (id === './api') return { api: { baseUrl: 'http://local.test/api', getTokens: () => null } };
    if (id === './TripContactButton') return load('TripContactButton.tsx');
    if (id === './design/typography') return { fonts: { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold', extraBold: 'Inter_800ExtraBold' } };
    if (id === './BottomPanel') return { BottomPanel: function BottomPanel({ closeRequested, onClose, children, ...props }) {
      React.useEffect(() => { if (closeRequested) { if (deferSheetExit) pendingSheetExits.push(onClose); else onClose(); } }, [closeRequested]);
      return React.createElement('BottomPanel', { ...props, closeRequested, onClose }, children);
    }, panelStyle: {} };
    if (id === './design/motion') return { useMotionPreference: () => false };
    if (id === './design/theme') return { useTheme: () => ({ isDark: darkTheme, palette: darkTheme ? darkPalette : lightPalette }) };
    if (id === './design/themeStyles') return { useThemeStyles: base => base };
    if (id === './design/tokens') return load('design/tokens.ts');
    if (id === './usePanelTransition') return load('usePanelTransition.ts');
    if (id === './useParametersSwipe') return load('useParametersSwipe.ts');
    if (id === './clientMapPanelStyle') return load('clientMapPanelStyle.ts');
    if (id === './DriverRideSheet') return { DriverRideSheet: function Sheet({ header, details, compactDetails, footer, style, onExpanded, onHeight, visible = true, showHandle = true, testID = 'driver-ride-sheet', handleLabel, handleStyle, handleTouchStyle }) {
      const [open, setOpen] = React.useState(false);
      const [height, setHeight] = React.useState(0);
      React.useEffect(() => { onHeight?.(visible ? height : 0); }, [visible, height]);
      const change = value => { setOpen(value); onExpanded(value); };
      const toggle = () => change(!open);
      return React.createElement('PanGestureHandler', { enabled: true, activeOffsetY: [-8, 8], failOffsetX: [-12, 12],
        onHandlerStateChange: event => { if (event.nativeEvent.state === 5) change(event.nativeEvent.translationY < 0); } },
        React.createElement('View', { testID, style, onLayout: event => setHeight(event.nativeEvent.layout.height) },
          showHandle && React.createElement('Pressable', { testID: 'driver-panel-handle', accessibilityLabel: handleLabel(open), accessibilityState: { expanded: open }, style: handleTouchStyle || { height: 24, position: 'absolute', top: 0 }, onPress: toggle }, React.createElement('View', { style: handleStyle })),
          showHandle ? typeof header === 'function' ? header(open, toggle) : header : React.createElement('Pressable', { testID: 'driver-sheet-header-toggle', accessibilityRole: 'button', accessibilityLabel: handleLabel(open), accessibilityState: { expanded: open }, onPress: toggle }, typeof header === 'function' ? header(open, toggle) : header), open ? details : compactDetails, footer));
    } };
    if (id === './waiting') return load('waiting.ts');
    if (id === './useSheetStageTransition') return load('useSheetStageTransition.ts');
    if (id === './useSheetDragToClose') return load('useSheetDragToClose.ts');
    if (id === './ClientCompletionPanel') return load('ClientCompletionPanel.tsx');
    if (id === './ClientOrderEndPanel') return load('ClientOrderEndPanel.tsx');
    if (id === '../assets/order-cancelled-red-3d.webp') return 'order-cancelled-red-3d.webp';
    if (id === './DriverCompletionPanel') return load('DriverCompletionPanel.tsx');
    if (id === './DriverOfferAcceptButton') return { DriverOfferAcceptButton: function AcceptButton({ offer, language, busy, onAccept }) {
      return React.createElement('Pressable', { testID: 'driver-offer-accept', accessibilityRole: 'button', accessibilityLabel: ui.tr(language)('Принять'),
        accessibilityState: { disabled: busy }, disabled: busy, onPress: () => { if (!busy) onAccept(offer); } },
        React.createElement('Text', null, ui.money(offer.price)), React.createElement('Text', null, ui.tr(language)('Принять')));
    } };
    if (id === './SuccessCelebration') return { SuccessCelebration: 'SuccessCelebration' };
    if (id === './TripPanel') return { statusText: { SEARCHING: 'Ищем водителя', ASSIGNED: 'Водитель выехал к вам', COMPLETED: 'Поездка завершена', ARRIVED: 'Водитель приехал', IN_PROGRESS: 'Поездка началась' } };
    return {};
  } });
  return exports;
}
const { BookingPanel, emptyRideDetails } = load('BookingPanel.tsx');
const { ClientTripPanel, splitKyrgyzPlate, splitOldKyrgyzPlate } = load('ClientTripPanel.tsx');
const { DriverPanel, DriverOfferSkip, pickupCategory } = load('DriverPanel.tsx');
const { TripPanel } = load('TripPanel.tsx');
const { DriverNavigation } = load('DriverNavigation.tsx');
const { DeliveryPanel, emptyDeliveryDetails } = load('DeliveryPanel.tsx');
const { waitingAt } = load('waiting.ts');
const point = address => ({ address, latitude: 42.87, longitude: 74.59 });
const textOf = node => typeof node === 'string' ? node.replace(/\u00a0/g, ' ') : node.children?.map(textOf).join('') || '';
const routeLetters = renderer => renderer.root.findAllByProps({ testID: 'driver-route-letter' }).map(textOf).join('');
const assertOfferFareOnlyInButton = (renderer, price) => {
  const accept = renderer.root.findByProps({ testID: 'driver-offer-accept' });
  const priceNodes = renderer.root.findAllByType('Text').filter(node => textOf(node) === String(price));
  assert.equal(priceNodes.length, 1, 'the offer fare is shown once');
  assert.ok(accept.findAllByType('Text').includes(priceNodes[0]), 'the offer fare is inside the accept button');
};
const button = (r, label) => r.root.findAllByType('Pressable').find(n => n.props.accessibilityLabel === label || textOf(n) === label);
const tap = async (r, label) => { const target = button(r, label); assert.ok(target, label); await act(async () => target.props.onPress()); };
const slide = async (r, label) => {
  let target = r.root.findAll(node => node.props.testID === 'driver-stage-slider' && node.props.accessibilityLabel === label)[0];
  assert.ok(target, label);
  await act(async () => target.props.onLayout({ nativeEvent: { layout: { width: 360 } } }));
  target = r.root.findAll(node => node.props.testID === 'driver-stage-slider' && node.props.accessibilityLabel === label)[0];
  await act(async () => target.props.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } }));
};
const sliderGesture = async (r, label, gesture) => {
  let target = r.root.findAll(node => node.props.testID === 'driver-stage-slider' && node.props.accessibilityLabel === label)[0];
  assert.ok(target, label);
  await act(async () => target.props.onLayout({ nativeEvent: { layout: { width: 360 } } }));
  const handler = r.root.findAllByType('PanGestureHandler').find(node => node.props.activeOffsetX?.join(',') === '-2,2');
  assert.equal(handler.props.minDist, undefined, 'the swipe handler must not combine minDist with failOffsetY');
  assert.equal(handler.props.activeOffsetX.join(','), '-2,2');
  await act(async () => handler.props.onHandlerStateChange({ nativeEvent: { state: 5, translationX: gesture.dx || 0 } }));
};

test('driver cancellation is available only in expanded details and still requires confirmation at every active stage', async () => {
  for (const kind of ['RIDE', 'DELIVERY_CAR', 'DELIVERY_TRUCK']) for (const status of ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS']) {
    const actions = [];
    const order = { id: `cancel-${kind}-${status}`, kind, status, pickup: point('A'), dropoff: point('B'), price: 120, distanceMeters: 1000, durationSeconds: 300 };
    const props = { order, offer: null, user: { role: 'DRIVER', language: 'ru', driverProfile: {} }, busy: false, coming: false,
      onAction: action => actions.push(action), onAccept() {}, onRateClient() {}, onOnline() {}, onChat() {}, onDone() {} };
    let renderer;
    await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
    try {
      assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0);
      assert.equal(renderer.root.findAllByProps({ testID: 'driver-cancel-order' }).length, 0, 'cancellation cannot reserve space below the collapsed slider');
      await act(async () => renderer.root.findByProps({ testID: 'driver-panel-handle' }).props.onPress());
      const cancel = renderer.root.findByProps({ testID: 'driver-cancel-order' });
      assert.equal(renderer.root.findByProps({ testID: 'driver-trip-details' }).findAllByProps({ testID: 'driver-cancel-order' }).length, 1);
      assert.ok(cancel.props.style.minHeight >= 44);
      await tap(renderer, 'Отменить заказ');
      assert.deepEqual(actions, [], 'opening the confirmation must not cancel');
      await tap(renderer, 'Назад');
      assert.deepEqual(actions, [], 'back keeps the trip active');
      await tap(renderer, 'Отменить заказ');
      const confirmation = renderer.root.findByType('BottomPanel');
      const confirm = confirmation.findAllByType('Pressable').find(node => textOf(node) === 'Отменить заказ');
      await act(async () => confirm.props.onPress());
      assert.deepEqual(actions, ['cancel']);
      await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, order: { ...order, status: 'CANCELLED' } })));
      assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
      assert.equal(renderer.root.findAllByProps({ testID: 'driver-cancel-order' }).length, 0);
      assert.match(textOf(renderer.root), /Заказ отменён/);
      await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, busy: true })));
      await act(async () => renderer.root.findByProps({ testID: 'driver-panel-handle' }).props.onPress());
      assert.equal(renderer.root.findByProps({ testID: 'driver-cancel-order' }).props.disabled, true);
    } finally { await act(async () => renderer.unmount()); }
  }
});
test('client and driver waiting countdowns agree with the billed fare at minute boundaries', () => {
  const arrivedAt = '2026-09-24T06:00:00.000Z';
  const order = { status: 'ARRIVED', price: 100, waiting: { arrivedAt, graceMinutes: 1, freeMinutes: 5, pricePerMinute: 4 } };
  const at = seconds => waitingAt(order, Date.parse(arrivedAt) + seconds * 1000);
  assert.deepEqual([at(0).phase, at(0).remainingSeconds, at(0).charge], ['BEFORE_FREE', 60, 0]);
  assert.deepEqual([at(60).phase, at(60).remainingSeconds, at(60).charge], ['FREE', 300, 0]);
  assert.deepEqual([at(361).phase, at(361).billedMinutes, at(361).totalPrice], ['PAID', 1, 104]);
});
test('taxi footer pull opens the existing parameters and preserves taps and content scrolling', async t => {
  let renderer;
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [{ id: 'eco', name: 'Эконом' }],
    tariffId: 'eco', quote: { price: 100 }, quotes: { eco: { price: 100 } }, language: 'ru',
    details: emptyRideDetails, onDetails() {}, onAddress() {}, onTariff() {}, onSwap() {}, onHeight() {}, onBook() {} };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  const gesture = () => renderer.root.findByType('GestureDetector').props.gesture;
  const pull = async (translationY, velocityY = 0, success = true) => act(async () => gesture().handlers.onEnd({ translationY, velocityY }, success));
  assert.equal(gesture().config.enabled, true);
  assert.equal(gesture().config.activeOffsetY, -8);
  assert.equal(gesture().config.failOffsetX.join(','), '-12,12');
  assert.equal(gesture().config.failOffsetY, 10, 'downward motion releases the opener');
  assert.equal(gesture().config.runOnJS, undefined, 'gesture recognition stays on the UI thread');
  const hitArea = renderer.root.findByProps({ testID: 'taxi-parameters-swipe' });
  assert.ok(hitArea.findAllByProps({ testID: 'book-ride' }).length);
  const originalGesture = gesture();
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, quote: { price: 120 } })));
  assert.equal(gesture(), originalGesture, 'new price renders do not cancel an in-flight pull');
  assert.equal(hitArea.findAllByType('ScrollView').length, 0, 'horizontal tariffs and vertical content stay outside the gesture');
  await pull(-10); await pull(80); await pull(-60, -500, false);
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  await pull(-12, -400);
  assert.ok(button(renderer, 'Комментарий водителю'));
  assert.ok(button(renderer, 'Заказ другому человеку'));
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  await pull(-50);
  assert.ok(button(renderer, 'Комментарий водителю'));
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  await tap(renderer, 'Детали поездки');
  assert.ok(button(renderer, 'Комментарий водителю'));
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, busy: true })));
  assert.equal(gesture().config.enabled, false);
  await pull(-80, -600);
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, dropoff: null })));
  assert.equal(renderer.root.findAllByProps({ testID: 'taxi-parameters-swipe' }).length, 0, 'the taxi home has no handle or empty footer');
  assert.equal(button(renderer, 'Детали поездки'), undefined);
});

test('delivery uses the same upward footer gesture and preserves ordering, taps and body scrolling', async t => {
  let renderer, booked = 0;
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [{ id: 'car', kind: 'DELIVERY_CAR', minimumPrice: 100 }],
    selectedKind: 'DELIVERY_CAR', quote: { price: 100 }, quotes: { car: { price: 100 } },
    details: emptyDeliveryDetails, onDetails() {}, onAddress() {}, onKind() {}, onSwap() {}, onHeight() {}, onBook() { booked++; } };
  await act(async () => { renderer = create(React.createElement(DeliveryPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  const gesture = () => renderer.root.findByType('GestureDetector').props.gesture;
  const pull = async (translationY, velocityY = 0, success = true) => act(async () => gesture().handlers.onEnd({ translationY, velocityY }, success));
  const area = renderer.root.findByProps({ testID: 'delivery-parameters-swipe' });
  assert.equal(gesture().config.enabled, true);
  assert.equal(gesture().config.activeOffsetY, -8);
  assert.equal(gesture().config.failOffsetY, 10);
  assert.equal(gesture().config.runOnJS, undefined);
  assert.equal(area.findAllByType('ScrollView').length, 0, 'body scroll is outside the fixed swipe area');
  await tap(renderer, 'Заказать доставку'); assert.equal(booked, 1, 'a normal button tap still books');
  await pull(-4, -500); await pull(40, -500); await pull(-60, -500, false);
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0, 'tiny, reversed and cancelled motions do not open parameters');
  await pull(-12, -400);
  assert.ok(renderer.root.findByProps({ label: 'От двери до двери' }));
  assert.equal(booked, 1, 'a swipe does not submit an order');
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  await pull(-50);
  assert.ok(renderer.root.findByProps({ label: 'Запланировать поездку' }));
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  await tap(renderer, 'Параметры доставки');
  assert.ok(renderer.root.findByProps({ label: 'От двери до двери' }));
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  await act(async () => renderer.update(React.createElement(DeliveryPanel, { ...props, busy: true })));
  assert.equal(gesture().config.enabled, false);
  await pull(-80, -500);
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
});

test('detail sheets keep the route and saved requests; closing discards an unsaved edit', async t => {
  let saved = emptyRideDetails, renderer, booked = 0;
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [{ id: 'eco', name: 'Эконом', description: 'Город' }], tariffId: 'eco', quote: { price: 100 }, quotes: { eco: { price: 100 } }, language: 'ru', onAddress() {}, onTariff() {}, onSwap() {}, onRefresh() {}, onHeight() {}, onBook() { booked++; } };
  function Probe() { const [details, setDetails] = React.useState(emptyRideDetails); return React.createElement(BookingPanel, { ...props, details, onDetails: next => { saved = next; setDetails(next); } }); }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => act(async () => renderer.unmount()));
  await tap(renderer, 'Детали поездки');
  assert.equal(button(renderer, 'С питомцем'), undefined);
  assert.ok(button(renderer, 'Заказ другому человеку'));
  await tap(renderer, 'Комментарий водителю');
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('У ворот'));
  assert.equal(button(renderer, 'Закрыть'), undefined, 'editor closes through the common sheet handle/backdrop');
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  assert.equal(saved.comment, '');
  await tap(renderer, 'Комментарий водителю');
  assert.equal(renderer.root.findByType('TextInput').props.value, '');
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('У ворот'));
  await tap(renderer, 'Готово');
  assert.equal(saved.comment, 'У ворот');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1);
  await tap(renderer, 'Свернуть детали поездки');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  assert.ok(textOf(renderer.root).includes('A'));
  assert.ok(textOf(renderer.root).includes('B'));
  await tap(renderer, 'Способы оплаты'); await tap(renderer, 'Готово');
  assert.equal(booked, 0);
  await tap(renderer, 'Заказать'); assert.equal(booked, 1);
});
test('dismissing a nested booking panel returns to the previous panel', async t => {
  let renderer;
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [{ id: 'eco', name: 'Эконом', description: 'Город' }], tariffId: 'eco', quote: { price: 100 }, quotes: { eco: { price: 100 } }, language: 'ru', details: emptyRideDetails, onDetails() {}, onAddress() {}, onTariff() {}, onSwap() {}, onRefresh() {}, onHeight() {}, onBook() {} };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));

  await tap(renderer, 'Детали поездки');
  await tap(renderer, 'Комментарий водителю');
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1, 'a backdrop, swipe or hardware back returns to details');
  assert.equal(renderer.root.findAllByType('TextInput').length, 0);

  await tap(renderer, 'Способы оплаты');
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1, 'payment returns to details');
  await tap(renderer, 'Свернуть детали поездки');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
});

test('taxi map controls follow the booking summary across nested panels, address search and unmount', async () => {
  let renderer;
  const visibility = [];
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [{ id: 'eco', name: 'Эконом' }], tariffId: 'eco',
    quote: { price: 100 }, quotes: { eco: { price: 100 } }, language: 'ru', details: emptyRideDetails,
    onDetails() {}, onAddress() {}, onTariff() {}, onSwap() {}, onHeight() {}, onBook() {},
    onMapControlsVisibleChange: visible => visibility.push(visible) };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  try {
    assert.equal(visibility.at(-1), true);
    await tap(renderer, 'Детали поездки');
    assert.equal(visibility.at(-1), false, 'details hide the map exit and focus controls');
    await tap(renderer, 'Комментарий водителю');
    await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
    await tap(renderer, 'Способы оплаты');
    await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
    assert.equal(visibility.at(-1), false, 'returning from an editor or payment to details keeps controls hidden');
    await tap(renderer, 'Свернуть детали поездки');
    assert.equal(visibility.at(-1), true);
    await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, hidden: true })));
    assert.equal(visibility.at(-1), false, 'address search suspends summary controls');
    await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, hidden: false, mapMoving: true })));
    assert.equal(visibility.at(-1), true, 'moving the map preserves controls so they can travel with the summary');
  } finally { await act(async () => renderer.unmount()); }
  assert.equal(visibility.at(-1), false, 'a removed summary releases map controls');
});

test('app hides booking overlay controls without suppressing active rides, delivery or driver controls', () => {
  const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  const visit = node => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'passengerControlsVisible') expression = node.initializer.expression.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(expression, 'the real TaxiMap receives control visibility from App');
  const defaults = { driver: false, page: 'home', service: 'taxi', order: null, addressField: null, drawer: false, chat: false, mapSelection: null, bookingMapControlsVisible: true };
  const visible = overrides => vm.runInNewContext(expression, { ...defaults, ...overrides });
  assert.equal(visible({ bookingMapControlsVisible: false }), false, 'nested taxi panels hide the exit and focus controls');
  assert.equal(visible({ bookingMapControlsVisible: false, mapSelection: 'pickup' }), true, 'pickup map selection retains its back control');
  assert.equal(visible({ bookingMapControlsVisible: false, mapSelection: 'dropoff' }), true, 'destination map selection retains its back control');
  assert.equal(visible({ bookingMapControlsVisible: false, order: { id: 'ride' } }), true, 'an active client ride keeps its map controls');
  assert.equal(visible({ bookingMapControlsVisible: false, service: 'delivery' }), true, 'delivery keeps its existing map controls');
  assert.equal(visible({ driver: true, bookingMapControlsVisible: false }), true, 'driver map controls are independent of the client summary');
  for (const overlay of [{ addressField: 'dropoff' }, { drawer: true }, { chat: true }, { page: 'settings' }]) {
    assert.equal(visible(overlay), false);
    assert.equal(visible({ service: 'delivery', ...overlay }), false);
    assert.equal(visible({ order: { id: 'ride' }, ...overlay }), false);
  }
});

test('another passenger can be entered or picked and restored in booking details', async t => {
  let saved = emptyRideDetails, renderer;
  function Probe() {
    const [details, setDetails] = React.useState(emptyRideDetails);
    return React.createElement(BookingPanel, { pickup: point('A'), dropoff: point('B'), tariffs: [], tariffId: '', quote: null, quotes: {}, language: 'ru', details, onDetails: next => { saved = next; setDetails(next); }, onAddress() {}, onTariff() {}, onSwap() {}, onRefresh() {}, onHeight() {}, onBook() {} });
  }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => act(async () => renderer.unmount()));
  await tap(renderer, 'Детали поездки');
  await tap(renderer, 'Заказ другому человеку');
  await act(async () => renderer.root.findByProps({ testID: 'passenger-name' }).props.onChangeText('Айдана'));
  await act(async () => renderer.root.findByProps({ testID: 'passenger-phone' }).props.onChangeText('+996700123456'));
  await tap(renderer, 'Готово');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.passenger)), { name: 'Айдана', phone: '+996700123456' });
  assert.ok(textOf(renderer.root).includes('Айдана · +996700123456'));

  pickedContact = { name: 'Бек', phoneNumbers: [{ number: '+996555123456' }] };
  await tap(renderer, 'Заказ другому человеку');
  await tap(renderer, 'Выбрать из контактов');
  assert.equal(renderer.root.findByProps({ testID: 'passenger-phone' }).props.value, '+996555123456');
  await tap(renderer, 'Готово');
  assert.deepEqual(JSON.parse(JSON.stringify(saved.passenger)), { name: 'Бек', phone: '+996555123456' });
  await tap(renderer, 'Заказ другому человеку');
  await tap(renderer, 'Убрать пассажира');
  assert.equal(saved.passenger, null);
  pickedContact = null;
});
test('booking panels leave in sequence before the next surface opens', async t => {
  deferSheetExit = true;
  pendingSheetExits = [];
  let renderer;
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [{ id: 'eco', name: 'Эконом', description: 'Город' }], tariffId: 'eco', quote: { price: 100 }, quotes: { eco: { price: 100 } }, language: 'ru', details: emptyRideDetails, onDetails() {}, onAddress() {}, onTariff() {}, onSwap() {}, onRefresh() {}, onHeight() {}, onBook() {} };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  t.after(async () => { deferSheetExit = false; pendingSheetExits = []; await act(async () => renderer.unmount()); });
  const finishSheet = async () => { const finish = pendingSheetExits.shift(); assert.ok(finish); await act(async () => finish()); };

  await tap(renderer, 'Детали поездки');
  assert.equal(renderer.root.findByType('AnimatedView').props.pointerEvents, 'none', 'the base panel is gone before details appear');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1);
  await tap(renderer, 'Комментарий водителю');
  assert.equal(renderer.root.findAllByType('TextInput').length, 0, 'editor must wait for details to leave');
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true);
  await finishSheet();
  assert.equal(renderer.root.findAllByType('TextInput').length, 1);
  await tap(renderer, 'Готово');
  assert.equal(renderer.root.findAllByType('TextInput').length, 1, 'editor leaves before details return');
  await finishSheet();
  assert.equal(renderer.root.findAllByType('TextInput').length, 0);
  await tap(renderer, 'Свернуть детали поездки');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1, 'details remains mounted during exit');
  await finishSheet();
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  assert.equal(renderer.root.findByType('AnimatedView').props.pointerEvents, 'auto');
});

test('address search opens only after the booking panel has moved down', async t => {
  let renderer;
  const opened = [];
  const props = { pickup: point('A'), dropoff: null, tariffs: [], tariffId: '', quote: null, quotes: {}, language: 'ru', details: emptyRideDetails, onDetails() {}, onAddress: field => opened.push(field), onTariff() {}, onSwap() {}, onRefresh() {}, onHeight() {}, onBook() {} };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  t.after(async () => { deferRootExit = false; pendingRootExits = []; await act(async () => renderer.unmount()); });
  deferRootExit = true;
  await tap(renderer, 'Куда едем?');
  assert.deepEqual(opened, []);
  assert.equal(pendingRootExits.length, 1);
  await act(async () => pendingRootExits.shift()());
  assert.deepEqual(opened, ['dropoff']);
});
test('map movement leaves a small taxi home edge, restores it, and preserves route controls', async t => {
  let renderer;
  const props = { pickup: point('A'), dropoff: null, tariffs: [], tariffId: '', quote: null, quotes: {}, language: 'ru', details: emptyRideDetails, onDetails() {}, onAddress() {}, onTariff() {}, onSwap() {}, onHeight() {}, onBook() {} };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  const panel = () => renderer.root.findByProps({ testID: 'client-booking-panel' });
  const browse = () => renderer.root.findByProps({ testID: 'taxi-map-browse-surface' });
  await act(async () => panel().props.onLayout({ nativeEvent: { layout: { height: 170 } } }));
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, mapMoving: true })));
  assert.equal(browse().props.style.at(-1).evaluate().transform[0].translateY, 138);
  assert.equal(browse().props.pointerEvents, 'none');
  assert.equal(panel().props.accessibilityElementsHidden, true);
  assert.equal(panel().props.importantForAccessibility, 'no-hide-descendants');
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, mapMoving: false })));
  assert.equal(browse().props.style.at(-1).evaluate().transform[0].translateY, 0);
  assert.equal(panel().props.accessibilityElementsHidden, false);
  let synchronizedOffset = 110;
  const sharedOffset = { get: () => synchronizedOffset };
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, mapMoving: true, browseOffset: sharedOffset })));
  assert.equal(browse().props.style.at(-1).evaluate().transform[0].translateY, 110);
  synchronizedOffset = 52;
  assert.equal(browse().props.style.at(-1).evaluate().transform[0].translateY, 52, 'the sheet follows the shared map-button clock without a render');
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, dropoff: point('B'), mapMoving: true })));
  assert.equal(browse().props.style.at(-1).evaluate().transform[0].translateY, 0);
  await tap(renderer, 'Детали поездки');
  assert.equal(panel().props.accessibilityElementsHidden, true);
  assert.equal(panel().props.importantForAccessibility, 'no-hide-descendants');
});

test('active-order details replace the order summary and restore it after closing', async t => {
  deferSheetExit = true;
  pendingSheetExits = [];
  let renderer;
  const props = { order: { id: 'assigned', status: 'ASSIGNED', pickup: point('A'), dropoff: point('B'), price: 100 }, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() {}, onRating: async () => true, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => { deferSheetExit = false; pendingSheetExits = []; await act(async () => renderer.unmount()); });
  await tap(renderer, 'Детали поездки');
  assert.equal(renderer.root.findByType('AnimatedView').props.pointerEvents, 'none');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1);
  await tap(renderer, 'Готово');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1);
  const finish = pendingSheetExits.shift();
  assert.ok(finish);
  await act(async () => finish());
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  assert.equal(renderer.root.findByType('AnimatedView').props.pointerEvents, 'auto');
});

test('driver comment panel replaces the order panel and restores it after its exit', async t => {
  deferSheetExit = true;
  pendingSheetExits = [];
  let renderer;
  const order = { id: 'driver-comment', status: 'ASSIGNED', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 1000, durationSeconds: 120, comment: 'У ворот' };
  const props = { order, user: { role: 'DRIVER', language: 'ru' }, offer: null, busy: false, coming: false, onAccept() {}, onRateClient: async () => true, onOnline() {}, onAction() {}, onChat() {}, onDone() {} };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => { deferSheetExit = false; pendingSheetExits = []; await act(async () => renderer.unmount()); });
  const root = () => renderer.root.findAllByType('AnimatedView').find(node => node.props.accessibilityElementsHidden !== undefined);
  await tap(renderer, 'Раскрыть детали поездки');
  await tap(renderer, 'Комментарий пассажира');
  assert.equal(root().props.pointerEvents, 'none');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 1);
  await tap(renderer, 'Готово');
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true);
  assert.equal(root().props.pointerEvents, 'none');
  const finish = pendingSheetExits.shift();
  assert.ok(finish);
  await act(async () => finish());
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  assert.equal(root().props.pointerEvents, 'box-none', 'the sheet envelope passes map taps through after restoring');
});

test('cancelled driver order closes by button or downward pull and has no expand arrow', async t => {
  let renderer;
  const closed = [];
  const order = { id: 'cancelled-driver-order', status: 'CANCELLED', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 1000, durationSeconds: 120 };
  const props = { order, user: { role: 'DRIVER', language: 'ru' }, offer: null, busy: false, coming: false, onAccept() {}, onRateClient: async () => true, onOnline() {}, onAction() {}, onChat() {}, onDone(id) { closed.push(id); } };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('Icon').filter(node => ['chevron-up', 'chevron-down'].includes(node.props.name)).length, 0);
  assert.equal(renderer.root.findAllByType('ScrollView').length, 0, 'cancelled order panel cannot scroll');
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-terminal-summary' })), /A.*B.*100/);
  await tap(renderer, 'К новым заказам');
  assert.deepEqual(closed, [order.id]);
  const gesture = renderer.root.findByType('GestureDetector').props.gesture;
  assert.ok(gesture);
  await act(async () => { gesture.handlers.onStart(); gesture.handlers.onUpdate({ translationY: 90 }); gesture.handlers.onEnd({ velocityY: 1000 }, true); });
  assert.deepEqual(closed, [order.id, order.id]);
});

test('missing ride and delivery quotes wait for automatic pricing without a refresh button', async t => {
  let ride, delivery, refreshes = 0, bookings = 0;
  const common = { pickup: point('A'), dropoff: point('B'), quote: null, quotes: {}, calculating: true, busy: false,
    onAddress() {}, onSwap() {}, onRefresh() { refreshes++; }, onBook() { bookings++; }, onHeight() {} };
  await act(async () => {
    ride = create(React.createElement(BookingPanel, { ...common, tariffs: [{ id: 'eco', name: 'Эконом' }], tariffId: 'eco',
      quoteError: '', language: 'ru', details: emptyRideDetails, onDetails() {}, onTariff() {} }));
    delivery = create(React.createElement(DeliveryPanel, { ...common, tariffs: [{ id: 'car', kind: 'DELIVERY_CAR', name: 'Доставка' }],
      selectedKind: 'DELIVERY_CAR', details: emptyDeliveryDetails, onDetails() {}, onKind() {} }));
  });
  t.after(async () => act(async () => { ride.unmount(); delivery.unmount(); }));
  for (const panel of [ride, delivery]) {
    assert.match(textOf(panel.root), /Считаем…/);
    assert.doesNotMatch(textOf(panel.root), /Обновить расчёт/);
    const action = panel.root.findAllByType('Pressable').find(node => /Считаем…/.test(textOf(node)));
    assert.equal(action.props.disabled, true);
  }
  assert.equal(refreshes, 0);
  assert.equal(bookings, 0);
  const previousPrice = { price: 100, distanceMeters: 900, durationSeconds: 180 };
  await act(async () => {
    ride.update(React.createElement(BookingPanel, { ...common, previewQuote: previousPrice,
      quotes: { eco: previousPrice }, tariffs: [{ id: 'eco', name: 'Эконом' }], tariffId: 'eco',
      quoteError: '', language: 'ru', details: emptyRideDetails, onDetails() {}, onTariff() {} }));
    delivery.update(React.createElement(DeliveryPanel, { ...common, previewQuote: previousPrice,
      quotes: { car: previousPrice }, tariffs: [{ id: 'car', kind: 'DELIVERY_CAR', name: 'Доставка' }],
      selectedKind: 'DELIVERY_CAR', details: emptyDeliveryDetails, onDetails() {}, onKind() {} }));
  });
  for (const panel of [ride, delivery]) {
    assert.match(textOf(panel.root), /100/);
    const action = panel.root.findAllByType('Pressable').find(node => /Обновляем цену…/.test(textOf(node)));
    assert.equal(action.props.disabled, true);
    assert.doesNotMatch(textOf(panel.root), /Обновить расчёт|Обновить тарифы/);
  }
});

test('no pickup cars suppress every fare and block ordering in summary and details, then recover with availability', async t => {
  let renderer, bookings = 0;
  const currentQuote = { price: 187, distanceMeters: 1100, durationSeconds: 91 };
  const comfortQuote = { ...currentQuote, price: 249 };
  const props = { pickup: point('A'), dropoff: point('B'), quote: currentQuote, previewQuote: currentQuote,
    quotes: { eco: currentQuote, comfort: comfortQuote }, calculating: true, busy: false, pickupAvailability: 'unavailable',
    tariffs: [{ id: 'eco', name: 'Эконом' }, { id: 'comfort', name: 'Комфорт' }], tariffId: 'eco', language: 'ru',
    details: emptyRideDetails, onDetails() {}, onAddress() {}, onTariff() {}, onSwap() {}, onHeight() {}, onBook() { bookings++; } };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  for (const id of ['eco', 'comfort']) {
    assert.equal(textOf(renderer.root.findByProps({ testID: 'booking-tariff-price-' + id })), '—');
  }
  const tariffLabels = renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'radio').map(node => node.props.accessibilityLabel);
  assert.deepEqual(tariffLabels, ['Эконом, Нет машин', 'Комфорт, Нет машин']);
  assert.doesNotMatch(textOf(renderer.root), /187|249/);
  const assertUnavailable = async () => {
    for (const action of renderer.root.findAllByProps({ testID: 'book-ride' })) {
      assert.equal(action.props.disabled, true);
      assert.equal(action.props.accessibilityState.disabled, true);
      assert.equal(textOf(action), 'Нет машин');
      assert.equal(action.findAllByType('Spinner').length, 0, 'an unavailable fare does not display a pricing spinner');
      await act(async () => action.props.onPress());
    }
    assert.equal(bookings, 0, 'even a stale/direct handler cannot book while no cars are available');
  };
  await assertUnavailable();
  await tap(renderer, 'Детали поездки');
  assert.match(textOf(renderer.root.findByProps({ testID: 'booking-detail-price' })), /^— ·/);
  assert.doesNotMatch(textOf(renderer.root), /187|249/);
  await assertUnavailable();
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, pickupAvailability: 'available', calculating: false })));
  assert.match(textOf(renderer.root.findByProps({ testID: 'booking-detail-price' })), /^187 ·/);
  const expandedAction = renderer.root.findByType('BottomPanel').findByProps({ testID: 'book-ride' });
  assert.equal(expandedAction.props.disabled, false);
  assert.equal(textOf(expandedAction), 'Заказать');
  await act(async () => expandedAction.props.onPress());
  assert.equal(bookings, 1);
  await tap(renderer, 'Свернуть детали поездки');
  assert.equal(textOf(renderer.root.findByProps({ testID: 'booking-tariff-price-eco' })), '187');
  assert.equal(textOf(renderer.root.findByProps({ testID: 'booking-tariff-price-comfort' })), '249');
  assert.equal(renderer.root.findByProps({ testID: 'book-ride' }).props.disabled, false);
});

test('booking route and details use the shared rounded-up minute formatter', async t => {
  const formatterSource = fs.readFileSync(path.join(__dirname, '../src/ui.tsx'), 'utf8').match(/^export const mins = .*;$/m)?.[0];
  assert.ok(formatterSource, 'load the actual shared UI duration formatter');
  const formatterExports = {};
  vm.runInNewContext(ts.transpileModule(formatterSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: formatterExports });
  const previous = ui.mins;
  ui.mins = formatterExports.mins;
  let renderer;
  t.after(async () => { ui.mins = previous; if (renderer) await act(async () => renderer.unmount()); });
  assert.equal(ui.mins(61, 'ru'), '2 мин');
  assert.equal(ui.mins(91, 'ru'), '2 мин');
  const currentQuote = { price: 187, distanceMeters: 1100, durationSeconds: 91 };
  const props = { pickup: point('A'), dropoff: point('B'), quote: currentQuote, quotes: { eco: currentQuote },
    tariffs: [{ id: 'eco', name: 'Эконом' }], tariffId: 'eco', language: 'ru', details: emptyRideDetails,
    onDetails() {}, onAddress() {}, onTariff() {}, onSwap() {}, onHeight() {}, onBook() {} };
  await act(async () => { renderer = create(React.createElement(BookingPanel, props)); });
  assert.match(textOf(renderer.root.findByProps({ testID: 'booking-route-time' })), /2 мин в пути$/);
  await tap(renderer, 'Детали поездки');
  assert.match(textOf(renderer.root.findByProps({ testID: 'booking-detail-price' })), /2 мин в пути$/);
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, routeDurationSeconds: 121 })));
  assert.match(textOf(renderer.root.findByProps({ testID: 'booking-detail-price' })), /^187 · ≈ 3 мин в пути$/,
    'the selected quote keeps its fare while both surfaces use the same marker route duration');
  await tap(renderer, 'Свернуть детали поездки');
  assert.match(textOf(renderer.root.findByProps({ testID: 'booking-route-time' })), /3 мин в пути$/);
  await act(async () => renderer.update(React.createElement(BookingPanel, { ...props, routeDurationSeconds: NaN })));
  assert.match(textOf(renderer.root.findByProps({ testID: 'booking-route-time' })), /2 мин в пути$/,
    'a missing or invalid map estimate falls back to the valid quote duration');
});

test('assigned driver sees and calls the selected passenger while chat stays with the booking client', async t => {
  openedUrl = '';
  let renderer;
  const order = { id: 'guest', status: 'ASSIGNED', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 1000, durationSeconds: 120, client: { id: 'owner', phone: '+996700000000' }, passenger: { name: 'Айдана', phone: '+996555123456' } };
  const props = { order, user: { role: 'DRIVER', language: 'ru' }, offer: null, busy: false, coming: false, onAccept() {}, onRateClient: async () => true, onOnline() {}, onAction() {}, onChat() {}, onDone() {} };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.ok(textOf(renderer.root).includes('Айдана'));
  assert.ok(button(renderer, 'Чат с заказчиком'));
  await tap(renderer, 'Позвонить пассажиру');
  assert.equal(openedUrl, 'tel:+996555123456');
});

test('client trip panel omits the generic live-tracking banner', async t => {
  let renderer;
  const order = { id: 'assigned-with-driver', status: 'ASSIGNED', pickup: point('A'), dropoff: point('B'), price: 100, driver: { name: 'Азамат', phone: '+996700000000', driverProfile: { carPlate: '01 KG 777 AAA', carColor: 'Белый', carMake: 'Toyota Camry' } } };
  const props = { order, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() {}, onRating: async () => true, onHeight() {}, driverPosition: { latitude: 42.87, longitude: 74.59 }, approach: { distanceMeters: 300, durationSeconds: 90 } };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.doesNotMatch(textOf(renderer.root), /Ваш водитель на карте|в реальном времени|Ожидаем сигнал GPS|Обновляем положение водителя/);
  assert.equal(renderer.root.findByProps({ testID: 'client-vehicle-plate' }).props.accessibilityLabel, 'Номер автомобиля 01 KG 777 AAA');
  assert.match(textOf(renderer.root.findByProps({ testID: 'client-vehicle-plate' })), /01.*KG.*777 AAA/s);
});

test('trip contacts retain current driver, passenger and order actions across stages and themes', async t => {
  let renderer, chats = 0;
  const order = { id: 'live-contact-order', status: 'ASSIGNED', kind: 'RIDE', pickup: point('Pickup'), dropoff: point('Destination'), price: 130,
    driver: { id: 'real-driver', name: 'Current driver', phone: '+996555654321', driverProfile: { carPlate: '08 452 BCH', carMake: 'Hyundai Sonata', carColor: 'Серый', rating: 4.9 } },
    client: { id: 'current-client', phone: '+996700987654' }, passenger: { name: 'Other passenger', phone: '+996555112233' } };
  const props = { order, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat: () => { chats++; }, onDone() {}, onRating: async () => true, onHeight() {} };
  t.after(async () => { darkTheme = false; await act(async () => renderer?.unmount()); });
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  assert.match(textOf(renderer.root), /Водитель выехал к вам.*Водитель направляется к месту подачи.*08.*452 BCH.*Hyundai Sonata.*Current driver.*4\.9/s);
  for (const status of ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS']) {
    await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props, order: { ...order, status } })));
    await tap(renderer, 'Позвонить'); assert.equal(openedUrl, 'tel:+996555654321');
    await tap(renderer, 'Чат');
  }
  assert.equal(chats, 3);
  const clientPaths = renderer.root.findAllByType('Path').map(n => n.props.d);
  assert.equal(clientPaths.length, 2);
  await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props, order: { ...order, driver: { ...order.driver, phone: '' } } })));
  assert.equal(button(renderer, 'Позвонить').props.disabled, true);
  darkTheme = true;
  await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, user: { role: 'DRIVER', language: 'ru' }, onAccept() {}, onRateClient: async () => true, onOnline() {} })));
  const driverPaths = renderer.root.findAllByType('Path');
  assert.deepEqual(driverPaths.map(n => n.props.d), clientPaths, 'the same outlines render for each side');
  assert.ok(driverPaths.every(n => n.props.stroke === '#FFFFFF'), 'outlines remain visible in dark mode');
  await tap(renderer, 'Позвонить пассажиру'); assert.equal(openedUrl, 'tel:+996555112233');
  await tap(renderer, 'Чат с заказчиком'); assert.equal(chats, 4);
});

test('client plate keeps the region separate and waiting matches the clock-and-fare card in both themes', async t => {
  assert.deepEqual(JSON.parse(JSON.stringify(splitKyrgyzPlate('01 KG 777 AAA'))), { region: '01', registration: '777 AAA' });
  assert.deepEqual(JSON.parse(JSON.stringify(splitKyrgyzPlate('01 777 AAA'))), { region: '01', registration: '777 AAA' });
  assert.equal(splitKyrgyzPlate('CUSTOM 7'), null);
  let renderer;
  const order = { id: 'arrived-with-waiting', status: 'ARRIVED', pickup: point('A'), dropoff: point('B'), price: 90,
    waiting: { arrivedAt: new Date(Date.now() - 70_000).toISOString(), graceMinutes: 1, freeMinutes: 5, pricePerMinute: 2 },
    driver: { name: 'Азамат', phone: '+996700000000', driverProfile: { carPlate: '01 KG 777 AAA', carColor: 'Белый', carMake: 'Toyota Camry' } } };
  const props = { order, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() {}, onRating: async () => true, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => { darkTheme = false; await act(async () => renderer.unmount()); });
  const card = () => renderer.root.findByProps({ testID: 'client-waiting-card' });
  assert.match(textOf(card()), /Бесплатное ожидание.*Затем 2.*90/s);
  assert.equal(card().findAllByType('Icon').some(node => node.props.name === 'time-outline'), true);
  assert.equal(card().props.style[0].flexDirection, 'row');
  darkTheme = true;
  await act(async () => renderer.update(React.createElement(ClientTripPanel, props)));
  assert.equal(card().props.style[1].backgroundColor, '#242424');
  assert.equal(renderer.root.findByProps({ testID: 'client-vehicle-plate' }).props.style[1].backgroundColor, '#242424');
});

test('client renders old Kyrgyz plates with a red flag and keeps other formats unchanged', async t => {
  assert.equal(splitOldKyrgyzPlate('B777AE'), 'B 777 AE');
  assert.equal(splitOldKyrgyzPlate('В 777 АЕ'), 'В 777 АЕ');
  assert.equal(splitOldKyrgyzPlate('01 KG 777 AAA'), null);
  assert.equal(splitOldKyrgyzPlate('CUSTOM 7'), null);
  let renderer;
  const order = { id: 'old-plate', status: 'ARRIVED', pickup: point('A'), dropoff: point('B'), price: 90,
    driver: { name: 'Азамат', driverProfile: { carPlate: 'B777AE', carColor: 'Белый', carMake: 'Toyota Camry' } } };
  const props = { order, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() {}, onRating: async () => true, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => { darkTheme = false; await act(async () => renderer.unmount()); });
  const plate = () => renderer.root.findByProps({ testID: 'client-vehicle-plate' });
  assert.match(textOf(plate()), /B 777 AE/);
  assert.equal(plate().props.accessibilityLabel, 'Номер автомобиля B777AE');
  const flag = renderer.root.findByProps({ testID: 'client-old-plate-flag' }).findByType('Image');
  assert.equal(flag.props.accessibilityLabel, 'Флаг Кыргызстана');
  assert.equal(flag.props.style.borderRadius, 2);
  assert.equal(flag.props.style.width / flag.props.style.height, 1.6);
  darkTheme = true;
  await act(async () => renderer.update(React.createElement(ClientTripPanel, props)));
  assert.equal(plate().props.style[1].backgroundColor, '#242424');
  assert.match(textOf(plate()), /B 777 AE/);
  await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props,
    order: { ...order, driver: { ...order.driver, driverProfile: { ...order.driver.driverProfile, carPlate: 'CUSTOM 7' } } } })));
  assert.equal(renderer.root.findAllByProps({ testID: 'client-old-plate-flag' }).length, 0);
  assert.match(textOf(plate()), /CUSTOM 7/);
});
test('cancelling confirms, then completion shows rating and thanks only after feedback saves', async t => {
  let renderer, done = 0; const actions = [], ratings = [];
  const props = { order: { id: 'test', status: 'SEARCHING', pickup: point('A'), dropoff: point('B'), price: 100 }, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction: x => actions.push(x), onChat() {}, onDone() { done++; }, onRating: async (score, comment) => { ratings.push({ score, comment }); return true; }, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  await tap(renderer, 'Отменить заказ'); assert.deepEqual(actions, []);
  await tap(renderer, 'Продолжить ожидание'); assert.deepEqual(actions, []);
  await tap(renderer, 'Отменить заказ');
  const confirms = renderer.root.findByType('BottomPanel').findAllByType('Pressable');
  await act(async () => confirms.find(n => textOf(n) === 'Отменить заказ').props.onPress());
  assert.deepEqual(actions, ['cancel']);
  await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props, order: { ...props.order, status: 'COMPLETED' } })));
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  assert.ok(textOf(renderer.root).includes('Заказ успешно'));
  assert.ok(textOf(renderer.root).includes('Atlas'));
  await tap(renderer, 'Оценить поездку');
  assert.ok(textOf(renderer.root).includes('Как прошла ваша поездка'));
  await tap(renderer, 'Оценка 4');
  await tap(renderer, 'Отличный водитель');
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('  Было комфортно  '));
  await tap(renderer, 'Отправить');
  assert.deepEqual(ratings, [{ score: 4, comment: 'Отличный водитель · Было комфортно' }]);
  assert.ok(textOf(renderer.root).includes('Спасибо'));
  assert.equal(renderer.root.findAllByType('SuccessCelebration').some(node => node.props.variant === 'thankYou'), true);
  assert.equal(done, 0);
  await tap(renderer, 'Отлично');
  assert.equal(done, 1);
});

test('failed feedback stays editable and can be sent again', async t => {
  let renderer, attempts = 0;
  const props = { order: { id: 'completed', status: 'COMPLETED', pickup: point('A'), dropoff: point('B'), price: 100 }, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() {}, onRating: async () => ++attempts > 1, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  await tap(renderer, 'Оценить поездку');
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('Хорошая поездка'));
  await tap(renderer, 'Отправить');
  assert.ok(textOf(renderer.root).includes('Оцените поездку'));
  assert.equal(renderer.root.findByType('TextInput').props.value, 'Хорошая поездка');
  await tap(renderer, 'Отправить');
  assert.ok(textOf(renderer.root).includes('Спасибо'));
  assert.equal(attempts, 2);
});

test('client trip, completion, rating and thanks use dark surfaces when selected', async t => {
  darkTheme = true;
  let renderer;
  const order = { id: 'dark-client', status: 'ASSIGNED', pickup: point('A'), dropoff: point('B'), price: 100 };
  const props = { order, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() {}, onRating: async () => true, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => { darkTheme = false; await act(async () => renderer.unmount()); });
  assert.equal(Object.assign({}, ...renderer.root.findByType('AnimatedView').props.style).backgroundColor, '#111111');
  await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props, order: { ...order, status: 'COMPLETED' } })));
  const header = renderer.root.findByProps({ testID: 'client-completion-drag' }).findAllByType('View').find(node => Array.isArray(node.props.style) && node.props.style.some(style => style?.backgroundColor === '#111111'));
  assert.ok(header, 'completion heading uses the selected dark surface');
  assert.equal(renderer.root.findByType('ScrollView').props.style.backgroundColor, '#111111');
  assert.equal(button(renderer, 'Оценить поездку').props.style({ pressed: false })[1].backgroundColor, '#FFFFFF');
  await tap(renderer, 'Оценить поездку');
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star' && node.props.color === '#FFFFFF').length, 5);
  assert.equal(renderer.root.findByType('TextInput').props.style[1].color, '#FFFFFF');
  await tap(renderer, 'Отправить');
  const card = renderer.root.findAllByType('AnimatedView').find(node => Array.isArray(node.props.style) && node.props.style[0]?.minHeight === 540);
  assert.equal(card.props.style[1].backgroundColor, '#111111');
});

test('driver accepts an offer by button and keeps active stage sliders visible while details collapse', async t => {
  let renderer; const accepted = [], actions = [], ratings = [], closedOrders = []; let done = 0;
  const offer = { id: 'offer', status: 'SEARCHING', pickup: point('A'), dropoff: point('B'), price: 321, distanceMeters: 4800, durationSeconds: 720, tariff: { name: 'Эконом' }, clientRating: 4.75, searchExpiresAt: new Date(Date.now() + 30000).toISOString() };
  const approach = { route: { distanceMeters: 2500, durationSeconds: 420 } };
  const props = { user: { role: 'DRIVER', language: 'ru', driverProfile: { verified: true, online: true } }, order: null, offer, approach, busy: false, coming: false, navigation: { progress: { remainingSeconds: 60, remainingMeters: 490, arrived: false }, gpsStatus: '', loading: false }, onAccept: x => accepted.push(x.id), onRateClient: async score => { ratings.push(score); return true; }, onAction: x => actions.push(x), onOnline() {}, onChat() {}, onDone(id) { done++; closedOrders.push(id); } };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('ScrollView').length, 0, 'offer details fit their content without scrolling');
  assert.equal(button(renderer, 'Позвонить пассажиру'), undefined, 'an unaccepted offer has no private contact');
  assert.equal(button(renderer, 'Пропустить'), undefined, 'skip lives above the map');
  assert.doesNotMatch(textOf(renderer.root), /Новый заказ/);
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-offer-approach' })), /2500\s*·\s*420.*Средняя подача.*Эконом/s, 'pickup distance, duration and tags lead the offer panel');
  assert.doesNotMatch(textOf(renderer.root), /До клиента|До отправителя|Осталось|Взять заказ|Маршрут поездки|Время поездки|4800|720/);
  assert.doesNotMatch(textOf(renderer.root), /прибытие ≈/, 'offer omits the arrival chip');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-offer-approach' }).length, 1);
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0, 'offer starts compact to leave room for the map');
  assert.equal(routeLetters(renderer), 'АБ', 'compact offer includes both route addresses');
  assert.equal(renderer.root.findByProps({ testID: 'driver-route-pins' }).children.length, 2, 'offer contains only the two address rows, without a connector between them');
  assert.equal(textOf(renderer.root.findByProps({ testID: 'driver-route-pickup' })), 'АA');
  assert.equal(textOf(renderer.root.findByProps({ testID: 'driver-route-dropoff' })), 'БB');
  assert.ok(renderer.root.findByProps({ testID: 'driver-route-pins' }).findAllByType('Text').filter(node => ['A', 'B'].includes(textOf(node))).every(node => node.props.numberOfLines === 2));
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-stage-slider' }).length, 0, 'offer acceptance does not require sliding');
  assertOfferFareOnlyInButton(renderer, offer.price);
  await tap(renderer, 'Раскрыть детали поездки');
  assert.equal(renderer.root.findAllByType('ScrollView').length, 0, 'expanded offer also grows to fit its addresses');
  assert.equal(routeLetters(renderer), 'АБ');
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-offer-approach' })), /2500\s*·\s*420.*Средняя подача.*Эконом/s, 'expanded offer preserves pickup metrics and tags');
  assert.doesNotMatch(textOf(renderer.root), /прибытие ≈/, 'expanded offer also omits the arrival chip');
  assert.doesNotMatch(textOf(renderer.root), /Маршрут поездки|Время поездки|4800|720|Осталось/);
  assertOfferFareOnlyInButton(renderer, offer.price);
  assert.match(textOf(renderer.root), /Пассажир.*4,75/s);
  assert.doesNotMatch(textOf(renderer.root), /Кресло/);
  await tap(renderer, 'Свернуть детали поездки');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0);
  await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, busy: true })));
  assert.equal(button(renderer, 'Принять').props.disabled, true, 'busy state reaches the offer button');
  await tap(renderer, 'Принять'); assert.deepEqual(accepted, [], 'busy offer cannot be accepted');
  await act(async () => renderer.update(React.createElement(DriverPanel, props)));
  await tap(renderer, 'Принять'); assert.deepEqual(accepted, ['offer'], 'a button tap accepts the current offer');
  async function status(value, stageBusy = false) { await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, busy: stageBusy, offer: null, order: { ...offer, status: value, client: { name: 'Жылдыз', phone: '+996700000001', photoUrl: 'https://example.test/client.jpg' } } }))); }
  await status('ASSIGNED');
  assert.doesNotMatch(textOf(renderer.root), /Жылдыз/);
  assert.match(textOf(renderer.root), /Пассажир/);
  assert.equal(renderer.root.findAllByType('Avatar').length, 0, 'driver never sees client photo or initials');
  assert.ok(renderer.root.findAllByType('Icon').some(node => node.props.name === 'person' && node.props.color === 'white'));
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0, 'navigation leaves space for the map on assignment');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-metrics' }).length, 1);
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-current-destination' }).length, 0, 'pickup address is reserved for expanded details');
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-trip-metrics' })), /490 м.*до клиента.*прибытие ≈/s);
  assert.doesNotMatch(textOf(renderer.root), /4800|Маршрут поездки|321|мин|осталось|A|B/, 'compact pickup keeps trip details, price and countdown hidden');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-compact-summary' }).length, 0);
  assert.ok(button(renderer, 'Позвонить пассажиру'));
  assert.ok(button(renderer, 'Чат с пассажиром'));
  await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, offer: null,
    order: { ...offer, status: 'ASSIGNED', client: { name: 'Жылдыз' } },
    navigation: { position: point('Водитель'), progress: null, gpsStatus: '', loading: true } })));
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-trip-metrics' })), /≈125 м.*до клиента/s);
  assert.equal(renderer.root.findAll(node => node.props.accessibilityLabel === 'Приехал').length, 1);
  await tap(renderer, 'Раскрыть детали поездки');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 1);
  assert.equal(routeLetters(renderer), 'АБ');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-current-destination' }).length, 0, 'expanded route shows the pickup address only once');
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-trip-details' })), /A.*B.*321/s);
  assert.doesNotMatch(textOf(renderer.root.findByProps({ testID: 'driver-trip-details' })), /4800|720|мин|Время поездки/, 'expanded pickup shows price and addresses without a second trip-duration metric');
  await tap(renderer, 'Отменить заказ'); await tap(renderer, 'Назад'); assert.deepEqual(actions, []);
  await sliderGesture(renderer, 'Приехал', { dx: 15, vx: 2 }); assert.deepEqual(actions, [], 'a short fast flick is not a stage confirmation');
  await sliderGesture(renderer, 'Приехал', { dx: 207 }); assert.deepEqual(actions, [], 'less than 72% returns the thumb');
  await sliderGesture(renderer, 'Приехал', { dx: 208 }); assert.deepEqual(actions, ['arrive']);
  await sliderGesture(renderer, 'Приехал', { dx: 304 }); assert.deepEqual(actions, ['arrive'], 'completed stage slider must not dispatch twice');
  await status('ASSIGNED', true); await slide(renderer, 'Приехал'); assert.deepEqual(actions, ['arrive'], 'busy request blocks duplicate swipes');
  await status('ASSIGNED'); await slide(renderer, 'Приехал'); assert.deepEqual(actions, ['arrive', 'arrive'], 'failed request resets the thumb for a retry');
  await status('ARRIVED');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-route-pins' }).length, 0);
  assert.equal(button(renderer, 'Отменить заказ'), undefined);
  await tap(renderer, 'Раскрыть детали поездки');
  assert.ok(button(renderer, 'Отменить заказ'));
  assert.equal(routeLetters(renderer), 'АБ');
  await slide(renderer, 'Начать поездку'); assert.deepEqual(actions, ['arrive', 'arrive', 'start']);
  await status('IN_PROGRESS');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-metrics' }).length, 0);
  await tap(renderer, 'Раскрыть детали поездки');
  assert.match(textOf(renderer.root), /490 м.*до цели/s);
  assert.equal(routeLetters(renderer), 'АБ');
  assert.ok(button(renderer, 'Отменить заказ'));
  await slide(renderer, 'Завершить поездку'); assert.deepEqual(actions, ['arrive', 'arrive', 'start', 'complete']);
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0, 'the deliberate completion slider is the confirmation');
  await status('COMPLETED');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-completion' }).length, 1);
  assert.equal(renderer.root.findAllByType('SuccessCelebration').length, 1, 'driver reuses the client success animation');
  assert.match(textOf(renderer.root), /Заказ успешно.*Atlas.*Откуда.*A.*Куда.*B.*Общий путь.*4800.*Расчётное время в пути.*720.*Наличные.*Эконом.*321/s);
  assert.equal(button(renderer, 'Отправить'), undefined);
  await tap(renderer, 'Оценить пассажира');
  assert.match(textOf(renderer.root), /Как всё прошло/);
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star-outline').length, 5, 'all stars begin empty');
  assert.ok(button(renderer, 'Пропустить'));
  assert.equal(button(renderer, 'Отправить'), undefined);
  await tap(renderer, 'Оценка 4');
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star').length, 4);
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star-outline').length, 1);
  assert.equal(button(renderer, 'Пропустить'), undefined);
  await tap(renderer, 'Отправить');
  assert.deepEqual(ratings, [4]);
  assert.equal(done, 1, 'successful rating closes the completed order');
  assert.deepEqual(closedOrders, ['offer'], 'the close applies only to the order that was rated');
  assert.doesNotMatch(textOf(renderer.root), /Заказ успешно/, 'completion summary does not reopen after rating');
  await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, offer: null, order: null })));
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-completion' }).length, 0);
  assert.match(textOf(renderer.root), /Ищем заказы рядом.*Новый заказ появится здесь/s);
});

test('driver can skip feedback; a failed rating stays selected for retry', async t => {
  let renderer, done = 0, attempts = 0;
  const order = { id: 'driver-completed', status: 'COMPLETED', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 200, durationSeconds: 60, actualDurationSeconds: 420 };
  const props = { user: { role: 'DRIVER', language: 'ru' }, order, offer: null, busy: false, coming: false, onAccept() {}, onRateClient: async () => ++attempts > 1, onOnline() {}, onAction() {}, onChat() {}, onDone() { done++; } };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.match(textOf(renderer.root), /Время в пути420/);
  await tap(renderer, 'Оценить пассажира');
  assert.ok(button(renderer, 'Пропустить'));
  assert.equal(attempts, 0);
  await tap(renderer, 'Оценка 3');
  await tap(renderer, 'Отправить');
  assert.equal(attempts, 1);
  assert.match(textOf(renderer.root), /Как всё прошло/);
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star').length, 3, 'failure retains the selected score');
  await tap(renderer, 'Отправить');
  assert.equal(attempts, 2);
  assert.equal(done, 1);
  assert.doesNotMatch(textOf(renderer.root), /Заказ успешно/);

  await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, order: { ...order, id: 'driver-skip' } })));
  await tap(renderer, 'Оценить пассажира');
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star-outline').length, 5);
  await tap(renderer, 'Пропустить');
  assert.equal(done, 2);
  assert.equal(attempts, 2, 'skipping never submits a rating');
});

test('pulling a review panel down restores the previous completion panel', async t => {
  const order = { id: 'swipe-review', status: 'COMPLETED', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 200, durationSeconds: 60 };
  let clientClosed = 0, driverClosed = 0, client, driver;
  await act(async () => {
    client = create(React.createElement(ClientTripPanel, { order, user: { role: 'CLIENT', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() { clientClosed++; }, onRating: async () => true, onHeight() {} }));
    driver = create(React.createElement(DriverPanel, { order, user: { role: 'DRIVER', language: 'ru' }, offer: null, busy: false, coming: false, onAccept() {}, onRateClient: async () => true, onOnline() {}, onAction() {}, onChat() {}, onDone() { driverClosed++; } }));
  });
  t.after(async () => act(async () => { client.unmount(); driver.unmount(); }));
  await tap(client, 'Оценить поездку');
  await tap(driver, 'Оценить пассажира');
  const handle = renderer => renderer.root.findByType('GestureDetector').props.gesture;
  const pull = async (renderer, distance, velocity = 0) => act(async () => {
    const gesture = handle(renderer);
    gesture.handlers.onStart(); gesture.handlers.onUpdate({ translationY: distance });
    gesture.handlers.onEnd({ velocityY: velocity }, true);
  });
  assert.ok(handle(client));
  assert.ok(handle(driver));
  await pull(client, 30);
  assert.equal(clientClosed, 0);
  await pull(client, 80, 1000);
  await pull(driver, 80, 1000);
  assert.equal(clientClosed, 0);
  assert.equal(driverClosed, 0);
  assert.ok(button(client, 'Оценить поездку'));
  assert.ok(button(driver, 'Оценить пассажира'));
  await tap(client, 'Закрыть');
  await tap(driver, 'Пропустить оценку');
  assert.equal(clientClosed, 1);
  assert.equal(driverClosed, 1);
});

test('saved driver feedback opens only the completion summary', async t => {
  let renderer;
  const order = { id: 'already-rated', status: 'COMPLETED', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 200, durationSeconds: 60, driverRating: 5 };
  const props = { user: { role: 'DRIVER', language: 'ru' }, order, offer: null, busy: false, coming: false, onAccept() {}, onRateClient: async () => { throw Error('rating was already saved'); }, onOnline() {}, onAction() {}, onChat() {}, onDone() {} };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('SuccessCelebration').length, 1);
  assert.equal(button(renderer, 'Оценить пассажира'), undefined);
  assert.equal(button(renderer, 'Пропустить'), undefined);
  assert.ok(button(renderer, 'Закрыть'));
});

test('dark driver order and completion sheets keep their rating controls legible', async t => {
  darkTheme = true;
  let renderer;
  const order = { id: 'dark-driver', status: 'SEARCHING', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 200, durationSeconds: 60 };
  const props = { user: { role: 'DRIVER', language: 'ru' }, order: null, offer: order, busy: false, coming: false, onAccept() {}, onRateClient: async () => true, onOnline() {}, onAction() {}, onChat() {}, onDone() {} };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); darkTheme = false; });
  const offerSheet = renderer.root.findAllByType('View').find(node => node.props.testID === 'driver-offer-sheet');
  assert.ok(offerSheet);
  assert.equal(offerSheet.props.style.find(style => style?.backgroundColor === '#111111')?.backgroundColor, '#111111');
  await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, offer: null, order: { ...order, status: 'COMPLETED' } })));
  const completionHeader = renderer.root.findByProps({ testID: 'driver-completion-drag' }).findAllByType('View').find(node => node.props.style?.backgroundColor === '#111111');
  assert.ok(completionHeader, 'completion heading uses the dark surface');
  assert.equal(renderer.root.findByType('ScrollView').props.style.backgroundColor, '#111111');
  await tap(renderer, 'Оценить пассажира');
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star-outline' && node.props.color === '#777777').length, 5);
  assert.ok(button(renderer, 'Пропустить'));
  await tap(renderer, 'Оценка 3');
  assert.equal(renderer.root.findAllByType('Icon').filter(node => node.props.name === 'star' && node.props.color === '#FFFFFF').length, 3);
  const send = button(renderer, 'Отправить');
  assert.equal(send.props.style({ pressed: false })[0].backgroundColor, '#FFFFFF');
  assert.ok(button(renderer, 'Отправить'));
});

test('cancelled client trip has separate retry and full reset actions', async t => {
  let renderer, retry = 0, reset = 0;
  const order = { id: 'cancelled-trip', status: 'CANCELLED', pickup: point('A'), dropoff: point('B'), price: 100, tariff: { name: 'Стандарт' } };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, {
    order, user: { role: 'CLIENT', language: 'ru' }, busy: false, coming: false,
    onAction() {}, onChat() {}, onDone() { retry++; }, onReset() { reset++; }, onRating: async () => true, onHeight() {},
  })); });
  t.after(async () => act(async () => renderer.unmount()));
  await tap(renderer, 'Заказать снова');
  assert.equal(retry, 1);
  assert.equal(reset, 0);
  await act(async () => renderer.update(React.createElement(ClientTripPanel, {
    order: { ...order, id: 'another-cancelled-trip' }, user: { role: 'CLIENT', language: 'ru' }, busy: false, coming: false,
    onAction() {}, onChat() {}, onDone() { retry++; }, onReset() { reset++; }, onRating: async () => true, onHeight() {},
  })));
  await tap(renderer, 'Закрыть');
  assert.equal(reset, 1);
});

test('client cancellation uses the red 3D modal, never the no-driver or completion content', async t => {
  for (const language of ['ru', 'ky']) for (const kind of ['RIDE', 'DELIVERY_CAR', 'DELIVERY_TRUCK']) for (const dark of [false, true]) {
    darkTheme = dark;
    let renderer;
    const order = { id: `${language}-${kind}-${dark}`, kind, status: 'CANCELLED', pickup: point('Улица Ленина, 10'), dropoff: point('Школа № 8'), price: 9057 };
    await act(async () => { renderer = create(React.createElement(ClientTripPanel, {
      order, user: { role: 'CLIENT', language }, busy: false, onAction() {}, onChat() {}, onDone() {}, onReset() {}, onRating: async () => true, onHeight() {},
    })); });
    const text = textOf(renderer.root);
    assert.match(text, language === 'ky' ? /Буюртма жокко чыгарылды/ : /Заказ отменён/);
    assert.doesNotMatch(text, /Водитель не найден|Айдоочу табылган жок|успешно|9057/);
    assert.equal(renderer.root.findAllByType('SuccessCelebration').length, 0);
    assert.equal(renderer.root.findByProps({ testID: 'order-cancelled-illustration' }).props.source, 'order-cancelled-red-3d.webp');
    const sheet = renderer.root.findByProps({ testID: 'client-order-end-sheet' });
    assert.equal(sheet.props.accessibilityViewIsModal, true);
    assert.equal(sheet.props.style[1].backgroundColor, dark ? '#111111' : '#FFFFFF');
    assert.ok(button(renderer, language === 'ky' ? 'Кайра буюртма берүү' : 'Заказать снова'));
    assert.ok(button(renderer, language === 'ky' ? 'Жабуу' : 'Закрыть'));
    await act(async () => renderer.unmount());
  }
  darkTheme = false;
});

test('search cancellation replaces its confirmation only after the authoritative status arrives', async t => {
  let renderer;
  const actions = [], heights = [];
  const props = { order: { id: 'search-cancel', status: 'SEARCHING', pickup: point('A'), dropoff: point('B'), price: 100 }, user: { role: 'CLIENT', language: 'ru' }, busy: false,
    onAction: action => actions.push(action), onChat() {}, onDone() {}, onReset() {}, onRating: async () => true, onHeight: height => heights.push(height) };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  await tap(renderer, 'Отменить заказ');
  const confirmation = renderer.root.findByType('BottomPanel').findAllByType('Pressable').find(node => textOf(node) === 'Отменить заказ');
  assert.ok(confirmation);
  await act(async () => confirmation.props.onPress());
  assert.deepEqual(actions, ['cancel']);
  assert.equal(renderer.root.findAllByProps({ testID: 'client-order-end-modal' }).length, 0);
  await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props, order: { ...props.order, status: 'CANCELLED' } })));
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0, 'old cancellation confirmation is unmounted');
  assert.equal(renderer.root.findAllByProps({ testID: 'client-trip-panel' }).length, 0, 'old summary cannot show underneath the modal');
  const sheet = renderer.root.findByProps({ testID: 'client-order-end-sheet' });
  await act(async () => sheet.props.onLayout({ nativeEvent: { layout: { height: 450 } } }));
  assert.equal(heights.at(-1), 450);
  assert.equal(renderer.root.findByType('GestureDetector').props.gesture.config.enabled, true);
});

test('an exhausted search stays distinct from cancellation', async t => {
  let renderer;
  const props = { order: { id: 'no-driver', status: 'NO_DRIVER', pickup: point('A'), dropoff: point('B'), price: 100 }, user: { role: 'CLIENT', language: 'ru' }, busy: false,
    onAction() {}, onChat() {}, onDone() {}, onReset() {}, onRating: async () => true, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.match(textOf(renderer.root), /Водитель не найден.*нет свободных водителей/);
  assert.doesNotMatch(textOf(renderer.root), /Заказ отменён/);
  await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props, order: { ...props.order, status: 'CANCELLED' } })));
  assert.match(textOf(renderer.root), /Заказ отменён/);
  assert.doesNotMatch(textOf(renderer.root), /Водитель не найден/);
});

test('terminal modal blocks busy actions, closes once and handles Android back', async t => {
  for (const intent of ['retry', 'close', 'back', 'drag']) {
    let renderer, retries = 0, closed = 0;
    const props = { order: { id: `cancel-${intent}`, status: 'CANCELLED', pickup: point('A'), dropoff: point('B'), price: 100 }, user: { role: 'CLIENT', language: 'ru' }, busy: true,
      onAction() {}, onChat() {}, onDone() { retries++; }, onReset() { closed++; }, onRating: async () => true, onHeight() {} };
    await act(async () => { renderer = create(React.createElement(ClientTripPanel, props)); });
    await act(async () => renderer.root.findByProps({ testID: 'client-order-end-sheet' }).props.onLayout({ nativeEvent: { layout: { height: 450 } } }));
    assert.equal(button(renderer, 'Заказать снова').props.disabled, true);
    assert.equal(renderer.root.findByType('GestureDetector').props.gesture.config.enabled, false);
    await act(async () => { assert.equal(hardwareBackHandler(), true); });
    assert.equal(closed, 0);
    await act(async () => renderer.update(React.createElement(ClientTripPanel, { ...props, busy: false })));
    if (intent === 'back') await act(async () => { hardwareBackHandler(); hardwareBackHandler(); });
    else if (intent === 'drag') await act(async () => {
      const pan = renderer.root.findByType('GestureDetector').props.gesture;
      pan.handlers.onStart(); pan.handlers.onUpdate({ translationY: 180 }); pan.handlers.onEnd({ velocityY: 900 }, true);
    });
    else {
      const action = intent === 'retry' ? button(renderer, 'Заказать снова') : renderer.root.findByProps({ testID: 'client-order-end-close' });
      await act(async () => { action.props.onPress(); action.props.onPress(); });
    }
    assert.equal(retries, intent === 'retry' ? 1 : 0);
    assert.equal(closed, intent === 'retry' ? 0 : 1);
    await act(async () => renderer.unmount());
  }
});

test('legacy driver trip panel also masks client name and photo', async t => {
  let renderer;
  const order = { id: 'legacy-assigned', status: 'ASSIGNED', pickup: point('A'), dropoff: point('B'), price: 100, client: { name: 'Жылдыз', phone: '+996700000001', photoUrl: 'https://example.test/client.jpg' } };
  const props = { order, user: { role: 'DRIVER', language: 'ru' }, busy: false, onAction() {}, onChat() {}, onDone() {}, onRating() {}, coming: false };
  await act(async () => { renderer = create(React.createElement(TripPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.match(textOf(renderer.root), /Пассажир/);
  assert.doesNotMatch(textOf(renderer.root), /Жылдыз/);
  assert.equal(renderer.root.findAllByType('Avatar').length, 0);
  assert.ok(renderer.root.findAllByType('Icon').some(node => node.props.name === 'person' && node.props.color === 'white'));
});

test('skip is an independent map control and pickup distance thresholds are exact', async t => {
  assert.equal(pickupCategory(999), 'Близкая подача');
  assert.equal(pickupCategory(1000), 'Средняя подача');
  assert.equal(pickupCategory(3000), 'Средняя подача');
  assert.equal(pickupCategory(3001), 'Дальняя подача');
  const skipped = [];
  const offer = { id: 'next-offer' };
  let renderer;
  await act(async () => { renderer = create(React.createElement(DriverOfferSkip, { offer, busy: false, language: 'ru', onSkip: item => skipped.push(item.id) })); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findByProps({ testID: 'driver-offer-skip' }).props.accessibilityLabel, 'Пропустить');
  await tap(renderer, 'Пропустить');
  assert.deepEqual(skipped, ['next-offer']);
  await act(async () => renderer.update(React.createElement(DriverOfferSkip, { offer, busy: true, language: 'ru', onSkip: item => skipped.push(item.id) })));
  assert.equal(button(renderer, 'Пропустить').props.disabled, true);
});

test('driver navigation keeps only the turn cue above the map', async t => {
  let renderer;
  const navigation = { progress: { maneuverDistance: 30, remainingMeters: 490, remainingSeconds: 60, offRouteMeters: 0, stepIndex: 0, arrived: false, instruction: 'Поверните направо' }, route: { steps: [{ maneuver: { type: 'turn', modifier: 'right' } }] }, loading: false, error: '', gpsStatus: '', voiceEnabled: true, voiceError: '', followDriver: true, toggleVoice() {}, setFollowDriver() {}, retry() {} };
  await act(async () => { renderer = create(React.createElement(DriverNavigation, { navigation, top: 90, onLocation() {} })); });
  t.after(async () => act(async () => renderer.unmount()));
  const cue = renderer.root.findByProps({ testID: 'driver-navigation' });
  assert.equal(cue.props.style[0].width, 250);
  assert.match(textOf(cue), /30 м/);
  assert.doesNotMatch(textOf(cue), /490 м|1 мин|прибытие/);
  assert.equal(button(renderer, 'Голосовые подсказки'), undefined);
  assert.equal(button(renderer, 'Проверить голос'), undefined);
});

test('dark driver navigation keeps the turn cue and GPS notice readable', async t => {
  darkTheme = true;
  const navigation = { progress: { maneuverDistance: 30, offRouteMeters: 0, stepIndex: 0, arrived: false, instruction: 'Поверните налево' }, route: { steps: [{ maneuver: { type: 'turn', modifier: 'left' } }] }, loading: false, error: '', gpsStatus: 'Проверяем GPS', voiceEnabled: true, voiceError: '', followDriver: false, toggleVoice() {}, setFollowDriver() {}, retry() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(DriverNavigation, { navigation, top: 90, onLocation() {} })); });
  t.after(async () => { await act(async () => renderer.unmount()); darkTheme = false; });
  const turn = renderer.root.findAllByType('View').find(node => Array.isArray(node.props.style) && node.props.style[0]?.width === 52);
  assert.equal(turn.props.style[1].backgroundColor, '#FFFFFF');
  const distance = renderer.root.findAllByType('Text').find(node => textOf(node) === '—');
  assert.equal(distance.props.style[1].color, '#FFFFFF');
  assert.ok(renderer.root.findAllByType('Path').some(node => node.props.stroke === '#050505'));
  const notice = button(renderer, 'Проверить местоположение');
  assert.equal(notice.props.style[1].backgroundColor, '#1D1D1D');
  assert.equal(button(renderer, 'Показать водителя'), undefined, 'recenter belongs in the map corner, not under navigation instructions');
});

test('delivery redesign has two price choices, a payment selector and only three details', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/DeliveryPanel.tsx'), 'utf8');
  assert.match(source, /title=\{t\('Доставка'\)\}/);
  assert.match(source, /title=\{t\('Грузовой'\)\}/);
  assert.doesNotMatch(source, />Курьер</);
  assert.doesNotMatch(source, /d\.handle|Тип кузова|Грузчики|Что нужно доставить/);
  assert.match(source, /accessibilityLabel=\{t\('Способы оплаты'\)\}/);
  assert.match(source, /cash-outline" color=\{colors\.blue\}/);
  assert.match(source, /surface === 'payment'/);
  assert.match(source, /Запланировать поездку/);
  assert.match(source, /От двери до двери/);
  assert.match(source, /Комментарий водителю/);
  assert.match(source, /serviceImageFrame: \{ width: '100%', height: 68/);
  assert.match(source, /service: \{ flex: 1, minHeight: 124/);
  assert.match(source, /truckImage: \{ width: 112, height: 112 \}/);
  assert.doesNotMatch(source, /scaleX: 1\.38/);
  assert.doesNotMatch(source, /deliveryMark/);
  assert.match(source, /car-economy\.webp/);
  assert.doesNotMatch(source, /delivery-van-blue\.png/);
  assert.doesNotMatch(source, /taxi-yellow\.png/);
  assert.match(source, /backgroundColor: colors\.blue/);
  assert.match(source, /accessibilityLabel=\{tr\(language\)\('Поменять адреса местами'\)\}/);
  assert.doesNotMatch(source, /surface === 'details' && <BottomPanel expanded/);
});

test('delivery payment and simplified details open from the new main panel', async t => {
  let renderer;
  let swapped = 0;
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [
    { id: 'delivery-car', kind: 'DELIVERY_CAR', name: 'Доставка', minimumPrice: 120 },
    { id: 'delivery-truck', kind: 'DELIVERY_TRUCK', name: 'Грузовой', minimumPrice: 450 },
  ], selectedKind: 'DELIVERY_TRUCK', quote: { price: 520 }, quotes: { 'delivery-car': { price: 140 }, 'delivery-truck': { price: 520 } }, calculating: false, busy: false, details: emptyDeliveryDetails, onDetails() {}, onKind() {}, onAddress() {}, onSwap() { swapped++; }, onBook() {}, onRefresh() {}, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(DeliveryPanel, props)); });
  t.after(async () => act(async () => renderer.unmount()));
  assert.match(textOf(renderer.root), /Доставка.*140.*Грузовой.*520/);
  assert.doesNotMatch(textOf(renderer.root), /Курьер/);
  await tap(renderer, 'Поменять адреса местами');
  assert.equal(swapped, 1);
  await tap(renderer, 'Способы оплаты');
  assert.match(textOf(renderer.root), /Наличные.*Оплата водителю после поездки/);
  assert.equal(button(renderer, 'Закрыть'), undefined, 'payment has no extra X button');
  await tap(renderer, 'Готово');
  await tap(renderer, 'Параметры доставки');
  assert.equal(renderer.root.findByType('BottomPanel').props.expanded, undefined);
  assert.match(textOf(renderer.root), /Запланировать поездку.*От двери до двери.*Комментарий водителю/);
  assert.doesNotMatch(textOf(renderer.root), /Тип кузова|Грузчики|Что нужно доставить/);
});

test('delivery waits for each outgoing panel and preserves saved comments across return and payment', async t => {
  let renderer, saved = emptyDeliveryDetails;
  function Probe() {
    const [details, setDetails] = React.useState(emptyDeliveryDetails);
    return React.createElement(DeliveryPanel, { pickup: point('A'), dropoff: point('B'), tariffs: [],
      selectedKind: 'DELIVERY_CAR', quote: { price: 100 }, quotes: {}, details,
      onDetails: next => { saved = next; setDetails(next); }, onKind() {}, onAddress() {}, onSwap() {}, onBook() {}, onHeight() {} });
  }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => { deferRootExit = false; deferSheetExit = false; pendingRootExits = []; pendingSheetExits = []; await act(async () => renderer.unmount()); });
  deferRootExit = true;
  await tap(renderer, 'Параметры доставки');
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0, 'details cannot mount before the summary leaves');
  await tap(renderer, 'Параметры доставки');
  assert.equal(pendingRootExits.length, 1, 'repeated taps do not enqueue duplicate panels');
  await act(async () => pendingRootExits.shift()());
  deferRootExit = false;
  assert.equal(renderer.root.findByProps({ testID: 'client-delivery-panel' }).props.pointerEvents, 'none');
  deferSheetExit = true;
  await tap(renderer, 'Комментарий водителю');
  assert.equal(renderer.root.findAllByType('TextInput').length, 0, 'the editor waits for details to leave');
  await act(async () => pendingSheetExits.shift()());
  await act(async () => renderer.root.findByProps({ testID: 'delivery-comment' }).props.onChangeText('  Забрать у двери  '));
  await tap(renderer, 'Готово');
  assert.equal(saved.comment, 'Забрать у двери');
  assert.equal(renderer.root.findAllByType('TextInput').length, 1, 'the editor remains mounted during its exit');
  await act(async () => pendingSheetExits.shift()());
  assert.equal(renderer.root.findAllByType('TextInput').length, 0);
  await tap(renderer, 'Способы оплаты');
  await act(async () => pendingSheetExits.shift()());
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  assert.ok(button(renderer, 'Комментарий водителю'), 'swiping payment down returns to details');
  await tap(renderer, 'Комментарий водителю');
  await act(async () => pendingSheetExits.shift()());
  assert.equal(renderer.root.findByType('TextInput').props.value, 'Забрать у двери');
  await act(async () => renderer.root.findByType('TextInput').props.onChangeText('Не сохранять'));
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  assert.equal(saved.comment, 'Забрать у двери', 'swipe dismissal discards an unsaved edit');
});

test('delivery waits for summary exit before address picker and resumes when it closes', async t => {
  let renderer, address = null, registered;
  const props = { pickup: point('A'), dropoff: point('B'), tariffs: [], selectedKind: 'DELIVERY_CAR', quote: { price: 100 }, quotes: {},
    details: emptyDeliveryDetails, onDetails() {}, onKind() {}, onAddress: field => { address = field; },
    registerAddressOpener: open => { registered = open; }, onSwap() {}, onBook() {}, onHeight() {} };
  await act(async () => { renderer = create(React.createElement(DeliveryPanel, props)); });
  t.after(async () => { deferRootExit = false; pendingRootExits = []; await act(async () => renderer.unmount()); });
  deferRootExit = true;
  await act(async () => registered('dropoff'));
  assert.equal(address, null);
  await act(async () => pendingRootExits.shift()());
  assert.equal(address, 'dropoff');
  deferRootExit = false;
  await act(async () => renderer.update(React.createElement(DeliveryPanel, { ...props, hidden: true })));
  assert.equal(renderer.root.findAllByProps({ testID: 'client-delivery-panel' }).length, 0);
  await act(async () => renderer.update(React.createElement(DeliveryPanel, props)));
  assert.equal(renderer.root.findByProps({ testID: 'client-delivery-panel' }).props.pointerEvents, 'auto');
});

test('delivery comment stays outside scroll and collapsed details; hidden root releases map inset', async t => {
  let renderer;
  const heights = [];
  const offer = { id: 'delivery-comment', kind: 'DELIVERY_CAR', status: 'SEARCHING', pickup: point('A'), dropoff: point('B'), price: 100, distanceMeters: 1000, durationSeconds: 120, tariff: { name: 'Доставка' }, comment: 'Коробка кийим', deliveryDetails: { goodsDescription: 'Доставка', doorToDoor: true } };
  const props = { order: null, offer, user: { role: 'DRIVER', language: 'ru' }, busy: false, coming: false, onHeight: height => heights.push(height), onAccept() {}, onRateClient: async () => true, onOnline() {}, onAction() {}, onChat() {}, onDone() {} };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const root = () => renderer.root.findAllByType('AnimatedView').find(node => node.props.accessibilityElementsHidden !== undefined);
  await act(async () => renderer.root.findAllByType('View').find(node => node.props.testID === 'driver-offer-sheet').props.onLayout({ nativeEvent: { layout: { height: 500 } } }));
  assert.equal(heights.at(-1), 500);
  await tap(renderer, 'Раскрыть детали поездки');
  assert.equal(renderer.root.findByProps({ testID: 'driver-trip-details' }).findAllByProps({ testID: 'driver-client-comment' }).length, 0);
  assert.equal(renderer.root.findAllByType('Text').filter(node => textOf(node) === 'Доставка').length, 1);
  assert.match(textOf(renderer.root), /От двери до двери/);
  await tap(renderer, 'Свернуть детали поездки');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0);
  assert.equal(routeLetters(renderer), 'АБ', 'collapsed delivery offer keeps both addresses');
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-route-pins' })), /АAБB/);
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-offer-approach' })), /Доставка/);
  assertOfferFareOnlyInButton(renderer, offer.price);
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-client-comment' })), /Коробка кийим/);
  const sheetGesture = renderer.root.findAllByType('PanGestureHandler').find(node => node.props.enabled && node.props.activeOffsetY);
  await act(async () => sheetGesture.props.onHandlerStateChange({ nativeEvent: { state: 5, translationY: -85, velocityY: -200 } }));
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 1);
  await act(async () => sheetGesture.props.onHandlerStateChange({ nativeEvent: { state: 5, translationY: 85, velocityY: 200 } }));
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0);
  await tap(renderer, 'Комментарий заказчика');
  assert.equal(heights.at(-1), 0);
  assert.match(textOf(renderer.root.findByType('BottomPanel')), /Комментарий заказчика/);
  await tap(renderer, 'Готово');
  assert.equal(heights.at(-1), 500);
});

test('narrow offer keeps the action visible and shows full addresses when expanded', async t => {
  windowDimensions = { width: 320, height: 568 };
  let renderer;
  const offer = { id: 'narrow-offer', status: 'SEARCHING', pickup: point('улица Ленина, 13, Шамалды-Сай'),
    dropoff: point('улица Чынгыза Айтматова, 4, Шамалды-Сай'), price: 90, distanceMeters: 240,
    durationSeconds: 60, tariff: { name: 'Стандарт' }, clientRating: 4.23 };
  const props = { order: null, offer, user: { role: 'DRIVER', language: 'ru' }, busy: false, coming: false,
    approach: { route: { distanceMeters: 88, durationSeconds: 60 } }, onAccept() {}, onRateClient: async () => true,
    onOnline() {}, onAction() {}, onChat() {}, onDone() {} };
  await act(async () => { renderer = create(React.createElement(DriverPanel, props)); });
  t.after(async () => { await act(async () => renderer.unmount()); windowDimensions = { width: 412, height: 914 }; });
  assert.equal(renderer.root.findAllByType('ScrollView').length, 0);
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0);
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-offer-approach' })), /88 м\s*·\s*60.*Близкая подача.*Стандарт/s);
  assert.match(textOf(renderer.root), /Ленина.*Чынгыза Айтматова.*Пассажир.*4,23.*90.*Принять/s);
  assert.doesNotMatch(textOf(renderer.root), /До клиента|До отправителя|Маршрут поездки|Время поездки|Взять заказ|240/);
  const compactAddresses = renderer.root.findByProps({ testID: 'driver-route-pins' }).findAllByType('Text').filter(node => textOf(node).startsWith('улица '));
  assert.equal(compactAddresses.length, 2);
  assert.ok(compactAddresses.every(node => node.props.numberOfLines === 2), 'both compact addresses are limited to two lines');
  assertOfferFareOnlyInButton(renderer, offer.price);
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-stage-slider' }).length, 0);
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-panel-handle' }).length, 0, 'new offers have no top handle');
  assert.equal(renderer.root.findByProps({ testID: 'driver-sheet-header-toggle' }).props.accessibilityState.expanded, false, 'header remains an accessible way to reveal full addresses');
  await tap(renderer, 'Раскрыть детали поездки');
  const details = renderer.root.findByProps({ testID: 'driver-trip-details' });
  assert.equal(details.type, 'View', 'expanded offer measures its content rather than a fixed scroll viewport');
  const addressNodes = details.findAllByType('Text').filter(node => textOf(node).startsWith('улица '));
  assert.equal(addressNodes.length, 2);
  assert.ok(addressNodes.every(node => node.props.numberOfLines === undefined), 'both addresses can wrap fully');
  assert.equal(textOf(details.findByProps({ testID: 'driver-route-pickup' })), `А${offer.pickup.address}`);
  assert.equal(textOf(details.findByProps({ testID: 'driver-route-dropoff' })), `Б${offer.dropoff.address}`, 'destination stays attached to its own letter regardless of wrapping');
  assert.match(textOf(details), /Ленина.*Чынгыза Айтматова/s);
  assert.doesNotMatch(textOf(details), /Маршрут поездки|Время поездки|240|90/);
  assert.match(textOf(renderer.root.findByProps({ testID: 'driver-offer-approach' })), /88 м\s*·\s*60.*Близкая подача.*Стандарт/s);
  assertOfferFareOnlyInButton(renderer, offer.price);
  assert.ok(button(renderer, 'Принять'), 'expanded details keep the accept button visible');
  assert.equal(details.findAllByProps({ testID: 'driver-offer-accept' }).length, 0, 'accept remains outside the expandable details');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-stage-slider' }).length, 0);
  await tap(renderer, 'Свернуть детали поездки');
  assert.equal(renderer.root.findAllByProps({ testID: 'driver-trip-details' }).length, 0);
});

// The footer must remain usable while overflowing information scrolls independently.
test('client map panels constrain information without scrolling away the primary action', async t => {
  const actions = [];
  const heights = [];
  const common = { pickup: point('A'), dropoff: point('B'), tariffs: [{ id: 'eco', name: 'Эконом', kind: 'DELIVERY_CAR' }],
    quote: { price: 100 }, quotes: { eco: { price: 100 } }, calculating: false, busy: false, language: 'ru',
    onAddress() {}, onSwap() {}, onHeight: value => heights.push(value), onBook: () => actions.push('book') };
  const cases = [
    [BookingPanel, { ...common, tariffId: 'eco', details: emptyRideDetails, onDetails() {}, onTariff() {} }, 'booking', 'Заказать'],
    [DeliveryPanel, { ...common, selectedKind: 'DELIVERY_CAR', details: emptyDeliveryDetails, onDetails() {}, onKind() {} }, 'delivery', 'Заказать доставку'],
    [ClientTripPanel, { order: { id: 'arrived', status: 'ARRIVED', pickup: point('A'), dropoff: point('B'), price: 100 },
      user: { language: 'ru' }, onHeight: common.onHeight, onAction: value => actions.push(value), onChat() {}, onDone() {}, onRating: async () => true }, 'trip', 'Я выхожу'],
  ];
  for (const [Component, props, kind, actionLabel] of cases) {
    let renderer;
    await act(async () => { renderer = create(React.createElement(Component, props)); });
    try {
      const panel = renderer.root.findByProps({ testID: `client-${kind}-panel` });
      const scroll = renderer.root.findByProps({ testID: `client-${kind}-content` });
      assert.equal(Object.assign({}, ...panel.props.style).maxHeight, '52%', 'cap follows the actual container, not physical pixels');
      assert.equal(scroll.type, 'ScrollView');
      assert.equal(scroll.props.style.flexShrink, 1);
      assert.equal(scroll.props.nestedScrollEnabled, true);
      assert.equal(scroll.findAllByType('Pressable').some(node => textOf(node) === actionLabel), false);
      await tap(renderer, actionLabel);
      for (const height of [285, 430]) await act(async () => panel.props.onLayout({ nativeEvent: { layout: { height } } }));
      assert.deepEqual(heights.slice(-2), [285, 430], 'map camera receives actual resized panel height');
      if (kind === 'delivery') assert.equal(panel.props.onMoveShouldSetPanResponder, undefined, 'delivery swipe opener cannot intercept content scrolling');
      if (kind === 'booking') assert.ok(scroll.findAllByType('ScrollView').some(node => node.props.horizontal), 'tariff selection remains horizontally scrollable');
    } finally { await act(async () => renderer.unmount()); }
  }
  assert.deepEqual(actions, ['book', 'book', 'coming']);
});


test('narrow driver waiting and travelling panels keep contacts and confirmation outside expandable details', async t => {
  windowDimensions = { width: 320, height: 568 };
  let renderer, chats = 0;
  const actions = [], heights = [];
  const props = { user: { role: 'DRIVER', language: 'ru' }, busy: false, coming: false, onChat() { chats++; },
    onAction: action => actions.push(action), onHeight: height => heights.push(height), onOnline() {}, onAccept() {}, onDone() {}, onRateClient: async () => true,
    backgroundReady: false, onBackground() {},
    navigation: { progress: { remainingSeconds: 60, remainingMeters: 490 }, position: point('car') } };
  const order = { id: 'compact-ride', status: 'ARRIVED', pickup: point('Pickup address'), dropoff: point('Destination address'),
    passenger: { name: 'Очень длинное имя пассажира для узкого экрана', phone: '+996700123456' }, clientRating: 4.23,
    price: 90, basePrice: 90, distanceMeters: 4800, durationSeconds: 720, tariff: { name: 'Эконом' }, comment: 'Домофон 23',
    waiting: { arrivedAt: new Date(Date.now()).toISOString(), graceMinutes: 1, freeMinutes: 5, pricePerMinute: 10 } };
  await act(async () => { renderer = create(React.createElement(DriverPanel, { ...props, order })); });
  t.after(async () => { await act(async () => renderer.unmount()); windowDimensions = { width: 412, height: 914 }; });
  const find = id => renderer.root.findByProps({ testID: id });
  const absent = id => assert.equal(renderer.root.findAllByProps({ testID: id }).length, 0);
  const handle = () => find('driver-panel-handle');
  const panelGesture = () => renderer.root.findAllByType('PanGestureHandler').find(node => node.props.activeOffsetY && node.props.enabled);
  const checkCompact = () => { for (const id of ['driver-trip-details', 'driver-trip-metrics', 'driver-compact-summary', 'driver-client-comment', 'driver-current-destination', 'driver-cancel-order']) absent(id); };
  checkCompact();
  assert.equal(find('driver-panel-surface').props.pointerEvents, 'box-none', 'transparent sheet envelope passes taps to the map');
  assert.equal(handle().props.accessibilityState.expanded, false);
  assert.match(textOf(find('driver-passenger-row')), /Очень длинное имя.*4,23/s);
  assert.equal(find('driver-passenger-row').findAllByType('Text')[0].props.numberOfLines, undefined, 'long names wrap instead of truncating');
  const call = button(renderer, 'Позвонить пассажиру');
  const callStyle = call.props.style({ pressed: false })[0];
  assert.ok(callStyle.width >= 44 && callStyle.height >= 44);
  await tap(renderer, 'Позвонить пассажиру'); assert.equal(openedUrl, 'tel:+996700123456');
  await tap(renderer, 'Чат с заказчиком'); assert.equal(chats, 1);
  assert.match(textOf(find('driver-waiting-row')), /Ожидание начнётся через.*мин бесплатно после начала.*90/s);
  assert.equal(textOf(renderer.root).match(/90/g).length, 1, 'waiting total is shown once');
  assert.equal(button(renderer, 'Отменить заказ'), undefined);
  assert.equal(panelGesture().props.failOffsetX[1], 12, 'vertical panel gesture gives way to horizontal slider travel');
  const label = find('driver-stage-slider').findByType('AnimatedText');
  assert.equal(label.props.numberOfLines, undefined, 'confirmation label may wrap on a narrow screen');
  const labelStyle = Object.assign({}, ...label.props.style);
  assert.equal(labelStyle.textAlign, 'center');
  assert.ok(labelStyle.marginHorizontal > 0, 'equal space beside the text keeps its center aligned with the track');
  assert.equal(labelStyle.marginLeft, undefined);
  assert.equal(labelStyle.marginRight, undefined);
  assert.equal(labelStyle.includeFontPadding, false, 'Android font padding must not shift the baseline');
  await act(async () => handle().props.onPress());
  assert.equal(find('driver-panel-surface').props.pointerEvents, 'box-none', 'the map stays touchable after opening');
  assert.match(textOf(find('driver-trip-details')), /Ожидайте пассажира.*Эконом.*Pickup address.*Destination address/s);
  assert.equal(find('driver-trip-details').type, 'View', 'waiting details take their natural height');
  assert.equal(find('driver-trip-details').findAllByType('ScrollView').length, 0);
  assert.ok(button(renderer, 'Отменить заказ'));
  assert.equal(find('driver-trip-details').findAllByProps({ testID: 'driver-stage-slider' }).length, 0);
  await act(async () => panelGesture().props.onHandlerStateChange({ nativeEvent: { state: 5, translationY: 70, velocityY: 0 } }));
  checkCompact();
  await slide(renderer, 'Начать поездку'); assert.deepEqual(actions, ['start']);
  for (const [elapsed, title, price] of [[61, 'Бесплатное ожидание', 90], [361, 'Платное ожидание', 100]]) {
    await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, order: { ...order,
      waiting: { ...order.waiting, arrivedAt: new Date(Date.now() - elapsed * 1000).toISOString() } } })));
    assert.match(textOf(find('driver-waiting-row')), new RegExp(title));
    assert.match(textOf(find('driver-waiting-row')), new RegExp(String(price)));
  }
  await act(async () => renderer.update(React.createElement(DriverPanel, { ...props, order: { ...order, status: 'IN_PROGRESS' } })));
  checkCompact(); absent('driver-waiting-row');
  assert.equal(find('driver-panel-surface').props.pointerEvents, 'box-none');
  assert.doesNotMatch(textOf(renderer.root), /Поездка началась|Эконом|Pickup address|Destination address|490|90/);
  await act(async () => panelGesture().props.onHandlerStateChange({ nativeEvent: { state: 5, translationY: -70, velocityY: 0 } }));
  assert.match(textOf(find('driver-trip-details')), /Поездка началась.*490 м.*прибытие.*Эконом.*Pickup address.*Destination address/s);
  assert.equal(find('driver-trip-details').type, 'View', 'route details take their natural height');
  assert.equal(find('driver-trip-details').findAllByType('ScrollView').length, 0);
  assert.ok(find('driver-stage-slider'));
  await act(async () => handle().props.onPress()); checkCompact();
  await slide(renderer, 'Завершить поездку'); assert.deepEqual(actions, ['start', 'complete']);
});
