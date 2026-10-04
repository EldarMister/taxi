const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const colors = { ink: '#111318', muted: '#8A9099', blue: '#087FFF', surface: '#FFFFFF', line: '#ddd', white: '#fff' };
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const dish = { id: 'dish', name: 'Очень длинное название блюда с несколькими словами и дополнениями', price: 300, portion: '250 г', imageKey: 'burger', available: true, optionIds: ['small', 'large', 'box'] };
const options = [{ id: 'small', name: 'Маленькая', price: 10 }, { id: 'large', name: 'Большая', price: 20 }, { id: 'box', name: 'Упаковка', price: 30, priceScope: 'PER_ITEM' }];
const restaurant = { id: 'restaurant', dishes: [dish], options };

function harness({ reduced = false, realSheet = false, width = 320 } = {}) {
  const shared = [], animations = [], backListeners = [], jsCalls = [];
  let photoRenders = 0;
  const native = Object.fromEntries(['View', 'Text', 'Image', 'Pressable', 'ScrollView', 'TextInput', 'ActivityIndicator'].map(name => [name, name]));
  native.StyleSheet = { create: value => value, flatten, absoluteFill: { position: 'absolute' }, absoluteFillObject: { position: 'absolute' } };
  native.useWindowDimensions = () => ({ width, height: 800 });
  native.BackHandler = { addEventListener: (_name, fn) => { backListeners.push(fn); return { remove: () => backListeners.splice(backListeners.indexOf(fn), 1) }; } };
  const node = name => props => React.createElement(name, props, props.children);
  const reanimated = {
    default: { View: 'AnimatedView', ScrollView: 'AnimatedScrollView' },
    useSharedValue: value => { const ref = React.useRef(); if (!ref.current) { ref.current = { value }; shared.push(ref.current); } return ref.current; },
    useAnimatedStyle: fn => fn(), useAnimatedScrollHandler: fn => event => fn(event.nativeEvent ?? event),
    cancelAnimation: () => {}, runOnJS: fn => (...args) => { jsCalls.push(args); return fn(...args); }, Easing: { bezier: () => 'sheet-curve' },
    withTiming: (value, config, callback) => { animations.push({ type: 'timing', value, config, callback }); return value; },
    withSpring: (value, config, callback) => { animations.push({ type: 'spring', value, config, callback }); return value; },
  };
  reanimated.__esModule = true;
  const makeGesture = () => {
    const gesture = { callbacks: {}, config: {} };
    for (const key of ['activeOffsetY', 'failOffsetX', 'manualActivation', 'blocksExternalGesture']) gesture[key] = value => { gesture.config[key] = value; return gesture; };
    for (const key of ['onTouchesDown', 'onTouchesMove', 'onTouchesUp', 'onStart', 'onUpdate', 'onEnd', 'onFinalize']) gesture[key] = callback => { gesture.callbacks[key] = callback; return gesture; };
    return gesture;
  };
  const modules = {};
  function load(file) {
    if (modules[file]) return modules[file];
    const exports = {}; modules[file] = exports;
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(code, { exports, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame() {}, require: id => {
      if (id === 'react' || id === 'react/jsx-runtime') return require(id);
      if (id === 'react-native') return native;
      if (id === 'react-native-reanimated') return reanimated;
      if (id === 'react-native-gesture-handler') return { Gesture: { Pan: makeGesture, Native: makeGesture }, GestureDetector: node('GestureDetector') };
      if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }) };
      if (id === '@expo/vector-icons') return { Ionicons: 'Icon' };
      if (id === 'expo-linear-gradient') return { LinearGradient: node('LinearGradient') };
      if (id === '../design/motion') return { SpringPressable: node('SpringPressable'), Reveal: node('Reveal'), useMotionPreference: () => reduced };
      if (id === '../design/tokens') return { palette: { ...colors, canvas: '#f7f7f5' }, radii: { small: 12, large: 22 } };
      if (id === '../design/typography') return { fonts: {} };
      if (id === '../design/theme') return { useTheme: () => ({ palette: { ...colors, background: '#f7f7f5', elevated: '#eee', accent: colors.blue, accentText: '#fff' } }) };
      if (id === '../BottomPanel') return { BottomPanel: node('BottomPanel') };
      if (id === './foodTheme') return { useFoodColors: () => colors, useFoodStyles: value => value };
      if (id === './i18n') return { useFoodT: () => value => value, useFoodLanguage: () => 'ru' };
      if (id === './assets') return { foodImage: () => 'image' };
      if (id === './FoodPhoto') return { FoodPhoto: props => { photoRenders++; return React.createElement('Image', { ...props, source: 'image' }); } };
      if (id === './NumberTicker') return { NumberTicker: node('NumberTicker') };
      if (id === './components') return { money: value => `${value} сом`, foodColors: colors, FoodButton: node('FoodButton'), FoodFavoriteButton: node('FoodFavoriteButton'), FoodHeader: node('FoodHeader'), FoodIconButton: node('FoodIconButton') };
      if (id === './DishSheet' && !realSheet) return { DishSheet: props => React.createElement('DishSheet', props, props.children, props.footer) };
      if (/\.(jpg|png|webp)$/.test(id)) return 'image';
      if (id.startsWith('./')) return load(`${id.slice(2)}.${fs.existsSync(path.join(__dirname, '../src/food', `${id.slice(2)}.tsx`)) ? 'tsx' : 'ts'}`);
      throw new Error(`Unexpected dependency ${id}`);
    } });
    return exports;
  }
  return { load, shared, animations, backListeners, jsCalls, getPhotoRenders: () => photoRenders };
}

test('card photo, two-line title and footer keep the same bounds at 0, 1, 20 and after image loading', async () => {
  const h = harness(); const { DishCard } = h.load('DishCard.tsx');
  const props = { dish, width: 134, format: 'grid', onOpen() {}, onIncrease() {}, onDecrease() {} };
  let renderer;
  await act(async () => { renderer = create(React.createElement(DishCard, props)); });
  const bounds = () => ({ card: flatten(renderer.root.findByProps({ testID: 'dish-card-dish' }).props.style), photo: flatten(renderer.root.findByProps({ testID: 'dish-photo-frame' }).props.style), footer: flatten(renderer.root.findByProps({ testID: 'dish-card-footer' }).props.style) });
  const before = bounds();
  assert.equal(before.card.height, undefined, 'grid cards follow their content instead of reserving blank space'); assert.equal(before.photo.height, 134); assert.equal(before.footer.height, 38);
  assert.equal(before.footer.top, 88, 'the count control overlays the bottom of the square photo');
  assert.equal(renderer.root.findAllByType('Text').find(node => node.props.children === dish.name).props.numberOfLines, 2);
  assert.ok(renderer.root.findByProps({ testID: 'dish-photo-placeholder' }));
  assert.equal(renderer.root.findAllByType('NumberTicker').length, 0, 'a static menu price must not mount digit reels');
  await act(async () => renderer.root.findByType('Image').props.onLoad());
  assert.equal(renderer.root.findAllByProps({ testID: 'dish-photo-placeholder' }).length, 0);
  for (const quantity of [1, 20, 0]) {
    await act(async () => renderer.update(React.createElement(DishCard, { ...props, quantity })));
    assert.deepEqual(bounds(), before);
  }
  await act(async () => renderer.unmount());
});

test('quantity controls are siblings of the dish link and do not open it', async () => {
  const h = harness(); const { DishCard, dishCardSize } = h.load('DishCard.tsx');
  let opened = 0, added = 0, removed = 0, renderer;
  assert.equal(dishCardSize(164, 'horizontal').height, 298);
  assert.equal(dishCardSize(200, 'grid').height, 311);
  await act(async () => { renderer = create(React.createElement(DishCard, { dish, quantity: 1, onOpen: () => opened++, onIncrease: () => added++, onDecrease: () => removed++ })); });
  const buttons = renderer.root.findAllByType('SpringPressable');
  await act(async () => { buttons.find(node => node.props.accessibilityLabel.startsWith('Увеличить')).props.onPress(); buttons.find(node => node.props.accessibilityLabel.startsWith('Уменьшить')).props.onPress(); });
  assert.deepEqual([opened, added, removed], [0, 1, 1]);
  await act(async () => renderer.unmount());
});

test('catalog basket overlays the list and restaurant price pill retains delivery access and sticky navigation', async () => {
  const h = harness(); const { RestaurantsScreen, RestaurantScreen } = h.load('CatalogScreens.tsx');
  const merchant = { ...restaurant, name: 'Меню', rating: 4.8, reviewCount: 100, cuisine: 'Бургеры', categories: [], dishes: [{ ...dish, category: 'Бургеры' }], menuCategories: ['Бургеры'], etaMin: 20, etaMax: 30, deliveryFee: 100, discountPercent: 30 };
  let opened = 0, deliveryOpened = 0, favoritesOpened = 0;
  const props = { restaurants: [merchant], onBack() {}, onRestaurant() {}, onFavorites() { favoritesOpened++; }, favoriteCount: 2, onCart() { opened++; }, onDeliveryInfo() { deliveryOpened++; }, cartCount: 1, cartTotal: 400,
    cartRestaurant: merchant, cartLines: [{ dishId: dish.id, quantity: 1, optionIds: [] }] };
  let renderer;
  await act(async () => { renderer = create(React.createElement(RestaurantsScreen, props)); });
  const favoritesButton = renderer.root.findAllByType('FoodIconButton').find(node => node.props.label === 'Избранное: 2');
  assert.equal(favoritesButton.props.name, 'heart-outline');
  await act(async () => favoritesButton.props.onPress());
  assert.equal(favoritesOpened, 1);
  const cartButton = renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel?.startsWith('Открыть корзину'));
  assert.equal(cartButton.props.accessibilityLabel, 'Открыть корзину, 1 товаров · 400 сом');
  assert.equal(cartButton.findByType('Text').props.children.join(''), 'Корзины · 1');
  assert.equal(flatten(cartButton.props.style).minHeight, 58);
  assert.equal(flatten(cartButton.props.style).backgroundColor, '#087FFF');
  assert.equal(flatten(cartButton.props.style).borderRadius, 18);
  await act(async () => cartButton.props.onPress());
  assert.equal(opened, 1);
  const dock = renderer.root.findAllByType('View').find(node => flatten(node.props.style).position === 'absolute' && flatten(node.props.style).bottom === 0);
  assert.equal(flatten(dock.props.style).bottom, 0);
  assert.equal(flatten(dock.props.style).paddingBottom, 24);
  assert.equal(flatten(dock.props.style).paddingHorizontal, 8);
  const list = renderer.root.findAllByType('ScrollView').find(node => !node.props.horizontal);
  assert.ok(flatten(list.props.contentContainerStyle).paddingBottom >= 100);
  await act(async () => renderer.update(React.createElement(RestaurantsScreen, { ...props, cartLines: [{ dishId: dish.id, quantity: 2, optionIds: [] }] })));
  const changedButton = renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel?.startsWith('Открыть корзину'));
  assert.equal(changedButton.props.accessibilityLabel, 'Открыть корзину, 2 товаров · 700 сом');
  await act(async () => renderer.update(React.createElement(RestaurantsScreen, { ...props, cartRestaurantCount: 2 })));
  assert.equal(renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel?.startsWith('Открыть корзину')).findByType('Text').props.children.join(''), 'Корзины · 2');
  await act(async () => renderer.update(React.createElement(RestaurantsScreen, { ...props, cartLines: [] })));
  assert.equal(renderer.root.findAllByType('SpringPressable').filter(node => node.props.accessibilityLabel?.startsWith('Открыть корзину')).length, 0);
  await act(async () => renderer.update(React.createElement(RestaurantScreen, { ...props, restaurant: merchant, onDish() {}, onAdd() {}, onDecrease() {}, favorite: false, onFavorite() {} })));
  const serviceSummary = renderer.root.findByProps({ testID: 'restaurant-service-summary' });
  assert.equal(serviceSummary.findAllByType('ScrollView').length, 0);
  assert.equal(serviceSummary.findAllByType('Text').some(node => String(node.props.children).includes('ряд блюд')), false);
  assert.equal(serviceSummary.findAllByType('Text').some(node => node.props.children === 'Доставка 100 сом'), true);
  const offerBadge = serviceSummary.findByProps({ accessibilityLabel: 'Акции: −30%' });
  assert.equal(flatten(offerBadge.props.style).paddingVertical, 4);
  assert.equal(flatten(offerBadge.props.style).height, undefined);
  const pill = renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel?.startsWith('Открыть корзину'));
  assert.equal(pill.findByType('NumberTicker').props.value, 400);
  assert.equal(flatten(pill.props.containerStyle).position, 'absolute');
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Подробные условия доставки' }).props.onPress());
  assert.equal(deliveryOpened, 1);
  assert.equal(renderer.root.findAllByProps({ testID: 'restaurant-sticky-header' }).length, 0);
  await act(async () => renderer.root.findByProps({ testID: 'restaurant-menu' }).props.onScroll({ nativeEvent: { contentOffset: { y: 400 } } }));
  assert.equal(renderer.root.findByProps({ testID: 'restaurant-sticky-header' }).findAllByProps({ accessibilityRole: 'tab' }).length, 1);
  await act(async () => renderer.root.findByProps({ testID: 'restaurant-menu' }).props.onScroll({ nativeEvent: { contentOffset: { y: 0 } } }));
  assert.equal(renderer.root.findAllByProps({ testID: 'restaurant-sticky-header' }).length, 0);
  await act(async () => renderer.update(React.createElement(RestaurantScreen, { ...props, restaurant: { ...merchant, deliveryFee: 0 }, onDish() {}, onAdd() {}, onDecrease() {}, favorite: false, onFavorite() {} })));
  const freeDelivery = renderer.root.findByProps({ testID: 'restaurant-service-summary' }).findByProps({ accessibilityLabel: 'Условия доставки' });
  assert.equal(freeDelivery.findByType('Text').props.children, 'Бесплатная доставка');
  await act(async () => freeDelivery.props.onPress());
  assert.equal(deliveryOpened, 2);
  await act(async () => renderer.root.findByProps({ accessibilityLabel: 'Отзывы о ресторане' }).props.onPress());
  assert.ok(renderer.root.findByProps({ testID: 'restaurant-reviews-panel' }));
  assert.equal(renderer.root.findByType('BottomPanel').props.label, 'Закрыть отзывы ресторана');
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  const infoButton = renderer.root.findAllByType('FoodIconButton').find(node => node.props.label === 'Информация о ресторане');
  await act(async () => infoButton.props.onPress());
  assert.equal(renderer.root.findByType('BottomPanel').props.label, 'Закрыть информацию о ресторане');
  await act(async () => renderer.unmount());
});

const catalogMerchant = (id, category, extra = {}) => ({ ...restaurant, id, name: `Ресторан ${id}`, rating: 4.8, reviewCount: 100,
  cuisine: category, categories: [category], imageKey: 'burger', etaMin: 20, etaMax: 30, deliveryFee: 100,
  dishes: [{ ...dish, id: `${id}-dish`, category, name: id === 'sushi' ? 'Ролл с угрём' : 'Чизбургер' }], ...extra });
const catalogProps = restaurants => ({ restaurants, onBack() {}, onRestaurant() {}, onFavorites() {}, favoriteCount: 0,
  onCart() {}, onDeliveryInfo() {}, cartCount: 0, cartTotal: 0 });
const restaurantIds = root => root.findAllByType('View').filter(node => node.props.testID?.startsWith('restaurant-card-')).map(node => node.props.testID.replace('restaurant-card-', ''));

test('menu scroll crosses to JS only at section/header boundaries and does not rerender dish photographs', async () => {
  const h = harness();
  const { RestaurantScreen } = h.load('CatalogScreens.tsx');
  const merchant = catalogMerchant('burger', 'Бургеры', { menuCategories: ['Бургеры', 'Напитки'], dishes: [
    { ...dish, id: 'burger', category: 'Бургеры' }, { ...dish, id: 'drink', category: 'Напитки' },
  ] });
  const props = { ...catalogProps([merchant]), restaurant: merchant, onDish() {}, onAdd() {}, onDecrease() {}, onFavorite() {}, favorite: false };
  let renderer;
  await act(async () => { renderer = create(React.createElement(RestaurantScreen, props)); });
  await act(async () => {
    renderer.root.findByProps({ testID: 'restaurant-menu-section-Бургеры' }).props.onLayout({ nativeEvent: { layout: { y: 50 } } });
    renderer.root.findByProps({ testID: 'restaurant-menu-section-Напитки' }).props.onLayout({ nativeEvent: { layout: { y: 400 } } });
  });
  const photosBeforeScroll = h.getPhotoRenders();
  const scroll = y => renderer.root.findByProps({ testID: 'restaurant-menu' }).props.onScroll({ nativeEvent: { contentOffset: { y } } });
  await act(async () => { for (let y = 0; y < 200; y += 5) scroll(y); });
  assert.equal(h.jsCalls.length, 0, 'ordinary scrolling is fully handled on the UI thread');
  await act(async () => scroll(300));
  assert.equal(h.jsCalls.length, 2, 'only the changed sticky header and category notify React');
  assert.equal(h.getPhotoRenders(), photosBeforeScroll, 'category selection does not rerender the menu grid');
  await act(async () => { for (let y = 310; y < 700; y += 5) scroll(y); });
  assert.equal(h.jsCalls.length, 2);
  await act(async () => renderer.unmount());
});

test('restaurant filters keep drafts until apply, discard cancelled changes and reset removed categories', async () => {
  const { RestaurantsScreen } = harness().load('CatalogScreens.tsx');
  const merchants = [catalogMerchant('burger', 'Бургеры'), catalogMerchant('sushi', 'Суши')];
  const props = catalogProps(merchants);
  let renderer;
  await act(async () => { renderer = create(React.createElement(RestaurantsScreen, props)); });
  const icon = label => renderer.root.findAllByType('FoodIconButton').find(node => node.props.label === label);
  await act(async () => icon('Фильтры').props.onPress());
  const panel = () => renderer.root.findByType('BottomPanel');
  const choice = name => panel().findAllByType('Pressable').find(node => node.props.accessibilityLabel === name);
  const action = name => panel().findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === name));
  await act(async () => choice('Суши').props.onPress());
  assert.equal(choice('Суши').props.accessibilityState.checked, true);
  assert.deepEqual(restaurantIds(renderer.root), ['burger', 'sushi'], 'draft filters do not change the catalog before applying');
  await act(async () => action('Применить').props.onPress());
  assert.deepEqual(restaurantIds(renderer.root), ['sushi']);
  assert.equal(panel().props.closeRequested, true);
  await act(async () => panel().props.onClose());
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  await act(async () => icon('Фильтры: 1').props.onPress());
  await act(async () => { choice('Суши').props.onPress(); choice('Бургеры').props.onPress(); });
  await act(async () => panel().props.onClose());
  assert.deepEqual(restaurantIds(renderer.root), ['sushi']);
  await act(async () => renderer.root.findAllByType('Pressable').find(node => node.findAllByType('Text').some(text => text.props.children === 'Сбросить')).props.onPress());
  assert.deepEqual(restaurantIds(renderer.root), ['burger', 'sushi']);
  assert.equal(renderer.root.findAllByType('TextInput').length, 0, 'the reference catalog keeps search inside the restaurant menu');
  const categoryRail = () => renderer.root.findByProps({ testID: 'restaurant-categories' });
  await act(async () => categoryRail().findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Суши').props.onPress());
  assert.deepEqual(restaurantIds(renderer.root), ['sushi']);
  await act(async () => renderer.update(React.createElement(RestaurantsScreen, { ...props, restaurants: [merchants[0]] })));
  assert.deepEqual(restaurantIds(renderer.root), ['burger']);
  assert.ok(icon('Фильтры'));
  assert.equal(categoryRail().findAllByType('Pressable').length, 1);
  await act(async () => renderer.unmount());
});

test('configured restaurant promotions use live data and favorite actions are independent of restaurant links', async () => {
  const { RestaurantsScreen } = harness().load('CatalogScreens.tsx');
  const merchant = catalogMerchant('burger', 'Бургеры', { deliveryFee: 0, discountPercent: 12 });
  const promotions = [
    { id: 'food', title: 'Наше актуальное предложение', subtitle: 'Из текущих данных', active: true, actionType: 'RESTAURANT', restaurantId: merchant.id, imageKey: 'burger' },
    { id: 'static', title: 'Информация', subtitle: '', active: true, actionType: 'NONE', imageKey: 'burger' },
    { id: 'hidden', title: 'Скрытая акция', subtitle: '', active: false, actionType: 'FOOD' },
    { id: 'missing', title: 'Удалённый ресторан', subtitle: '', active: true, actionType: 'RESTAURANT', restaurantId: 'missing' },
  ];
  const opened = [], toggled = [], banners = [];
  const props = { ...catalogProps([merchant]), banners: promotions, onBanner: value => banners.push(value), onRestaurant: value => opened.push(value),
    onToggleFavorite: value => toggled.push(value), favoriteIds: [merchant.id] };
  let renderer;
  await act(async () => { renderer = create(React.createElement(RestaurantsScreen, props)); });
  const promo = renderer.root.findByProps({ testID: 'restaurant-promotions' }).findAllByType('SpringPressable');
  assert.equal(promo.length, 1, 'only active advertisements linked to a current restaurant appear');
  await act(async () => promo[0].props.onPress());
  assert.equal(banners[0], promotions[0]);
  const card = renderer.root.findByProps({ testID: 'restaurant-card-burger' });
  const heart = card.findAllByType('Pressable').find(node => node.props.accessibilityLabel?.includes('избранн'));
  assert.equal(heart.props.accessibilityState.selected, true);
  await act(async () => heart.props.onPress());
  assert.deepEqual(opened, []); assert.equal(toggled[0], merchant);
  await act(async () => card.findAllByType('Pressable').find(node => node.props.accessibilityLabel?.startsWith('Открыть')).props.onPress());
  assert.equal(opened[0], merchant); assert.equal(toggled.length, 1);
  assert.equal(card.findAllByType('Text').some(node => Array.isArray(node.props.children) && node.props.children.join('') === '−12%'), true);
  assert.equal(card.findAllByType('Text').some(node => node.props.children === 'Бесплатная доставка'), true);
  await act(async () => renderer.update(React.createElement(RestaurantsScreen, { ...props, restaurants: [{ ...merchant, deliveryFee: 100, discountPercent: 0, rating: 0 }], banners: [], favoriteIds: [] })));
  const changed = renderer.root.findByProps({ testID: 'restaurant-card-burger' });
  assert.equal(changed.findAllByType('Text').some(node => node.props.children === 'Бесплатная доставка'), false);
  assert.equal(changed.findAllByType('Icon').some(node => node.props.name === 'star'), false);
  assert.equal(changed.findAllByType('Pressable').find(node => node.props.accessibilityLabel?.includes('избранн')).props.accessibilityState.selected, false);
  assert.equal(renderer.root.findAllByProps({ testID: 'restaurant-promotions' }).length, 0);
  await act(async () => renderer.unmount());
});

test('demo advertisements open their merchant, never advertise live merchants without a campaign, and yield to configured creative', async () => {
  const { RestaurantAdvertisements } = harness().load('RestaurantAdvertisements.tsx');
  const sushi = catalogMerchant('sushi-roll', 'Суши', { isDemo: true });
  const chicken = catalogMerchant('kfc', 'Курица', { isDemo: true });
  const plov = catalogMerchant('halva', 'Плов', { isDemo: true });
  // Use a known campaign id so the live merchant check cannot pass merely because its id is unknown.
  const liveMerchant = catalogMerchant('halva', 'Плов', { isDemo: false });
  const opened = [], clickedBanners = [];
  const props = { restaurants: [sushi, liveMerchant, chicken, plov], banners: [], width: 361,
    onRestaurant: value => opened.push(value), onBanner: value => clickedBanners.push(value) };
  let renderer;
  await act(async () => { renderer = create(React.createElement(RestaurantAdvertisements, props)); });
  const campaigns = renderer.root.findAllByType('SpringPressable');
  assert.equal(campaigns.length, 3);
  for (const campaign of campaigns) {
    assert.equal(flatten(campaign.props.style).width, 115);
    assert.equal(flatten(campaign.props.style).height, 115);
  }
  await act(async () => { campaigns[0].props.onPress(); campaigns[1].props.onPress(); campaigns[2].props.onPress(); });
  assert.deepEqual(opened, [sushi, chicken, plov]);
  assert.deepEqual(clickedBanners, []);
  await act(async () => renderer.update(React.createElement(RestaurantAdvertisements, { ...props, restaurants: [liveMerchant] })));
  assert.equal(renderer.toJSON(), null, 'live merchants have no synthetic advertising');
  const creative = { id: 'merchant-campaign', title: 'Обед в Халве', subtitle: 'Меню ресторана', active: true,
    actionType: 'RESTAURANT', restaurantId: liveMerchant.id, imageUrl: 'https://images.test/merchant-creative.jpg' };
  await act(async () => renderer.update(React.createElement(RestaurantAdvertisements, { ...props, banners: [creative] })));
  const configured = renderer.root.findAllByType('SpringPressable');
  assert.equal(configured.length, 1, 'configured creative replaces all demo fallback campaigns');
  assert.equal(flatten(configured[0].props.style).width, 361);
  assert.equal(flatten(configured[0].props.style).height, 361 / 2.04);
  assert.equal(configured[0].props.accessibilityLabel, 'Обед в Халве. Меню ресторана');
  await act(async () => configured[0].props.onPress());
  assert.deepEqual(clickedBanners, [creative]);
  assert.deepEqual(opened, [sushi, chicken, plov]);
  const three = [creative, { ...creative, id: 'campaign-two', sortOrder: 1 }, { ...creative, id: 'campaign-three', sortOrder: 2 }];
  await act(async () => renderer.update(React.createElement(RestaurantAdvertisements, { ...props, banners: three })));
  const small = renderer.root.findAllByType('SpringPressable');
  assert.equal(small.length, 3);
  for (const campaign of small) {
    assert.equal(flatten(campaign.props.style).width, 115);
    assert.equal(flatten(campaign.props.style).height, 115);
    assert.equal(campaign.findAllByType('Image').length, 1, 'the uploaded creative fills each tile');
    assert.equal(campaign.findAllByType('LinearGradient').length, 0, 'uploaded artwork is not overlaid with demo copy');
  }
  await act(async () => renderer.update(React.createElement(RestaurantAdvertisements, { ...props, banners: three.slice(0, 2) })));
  assert.equal(renderer.root.findAllByType('SpringPressable').length, 1, 'incomplete legacy sets never make a mixed-size rail');
  await act(async () => renderer.unmount());
});

test('restaurant photographs remain a single wide column on narrow and larger phones with safe touch areas', async () => {
  for (const width of [320, 430]) {
    const { RestaurantsScreen } = harness({ width }).load('CatalogScreens.tsx');
    let renderer;
    await act(async () => { renderer = create(React.createElement(RestaurantsScreen, { ...catalogProps([catalogMerchant('burger', 'Бургеры')]), onToggleFavorite() {} })); });
    const card = renderer.root.findByProps({ testID: 'restaurant-card-burger' });
    const photo = card.findAllByType('View').find(node => flatten(node.props.style).height === (width - 32) / 2.04);
    assert.ok(photo);
    assert.ok(flatten(photo.props.style).borderRadius >= 20);
    const favorite = card.findAllByType('Pressable').find(node => node.props.accessibilityLabel?.includes('избранн'));
    assert.equal(flatten(favorite.props.style).width, 40);
    assert.equal(flatten(favorite.props.style).height, 40);
    const imageLink = card.findAllByType('Pressable').find(node => flatten(node.props.style).width === width - 32);
    assert.ok(imageLink, 'the restaurant photograph spans the available column');
    assert.equal(flatten(renderer.root.findByType('SafeAreaView').props.style).backgroundColor, '#FFFFFF');
    await act(async () => renderer.unmount());
  }
});

test('dish footer blocks required options, calculates scopes and rapid presses, and resets for a new dish', async () => {
  const h = harness(); const { DishScreen } = h.load('DishScreen.tsx');
  const configured = { ...dish, defaultOptionIds: [], optionGroups: [{ id: 'size', name: 'Размер', optionIds: ['small', 'large'], minSelected: 1, maxSelected: 1 }] };
  let added, renderer;
  const props = { dish: configured, restaurant, onBack() {}, onFavorite() {}, favorite: false, onAdd: (...args) => { added = args; args[3](); } };
  await act(async () => { renderer = create(React.createElement(DishScreen, props)); });
  const button = label => renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === label);
  assert.equal(button('Выберите модификации').props.disabled, true);
  await act(async () => button('Большая, плюс 20 сом').props.onPress());
  await act(async () => button('Упаковка, плюс 30 сом').props.onPress());
  const increase = button('Увеличить количество').props.onPress;
  await act(async () => { for (let i = 0; i < 4; i++) increase(); });
  const add = renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === 'Добавить в корзину 1630 сом');
  assert.ok(add); assert.equal(flatten(add.props.style).height, 56);
  const footer = renderer.root.findByProps({ testID: 'dish-fixed-footer' });
  assert.equal(flatten(footer.props.style).gap, 10);
  assert.equal(flatten(footer.props.style).paddingBottom, 24);
  assert.equal(renderer.root.findByType('DishSheet').props.footer.props.testID, 'dish-fixed-footer');
  let submissions = 0;
  props.onAdd = (...args) => { submissions++; added = args; args[3](); };
  await act(async () => renderer.update(React.createElement(DishScreen, props)));
  const submit = renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === 'Добавить в корзину 1630 сом').props.onPress;
  await act(async () => { submit(); submit(); });
  assert.equal(submissions, 1);
  assert.equal(added[1], 5); assert.deepEqual(Array.from(added[2]), ['large', 'box']);
  assert.equal(renderer.root.findByType('DishSheet').props.closeRequested, true);
  await act(async () => renderer.update(React.createElement(DishScreen, { ...props, dish: { ...configured, id: 'new' } })));
  assert.equal(button('Выберите модификации').props.disabled, true);
  assert.equal(button('Уменьшить количество').props.disabled, true);
  const plus = button('Увеличить количество').props.onPress;
  await act(async () => { for (let i = 0; i < 25; i++) plus(); });
  assert.equal(button('Увеличить количество').props.disabled, true);
  await act(async () => renderer.unmount());
});

test('sheet arbitrates scroll direction, short drags, flicks, back and reduced motion', async () => {
  for (const reduced of [false, true]) {
    const h = harness({ realSheet: true, reduced }); const { DishSheet } = h.load('DishSheet.tsx');
    let closed = 0, renderer;
    await act(async () => { renderer = create(React.createElement(DishSheet, { footer: React.createElement('Footer'), closeRequested: false, label: 'Закрыть', onClose: () => closed++ }, React.createElement('Content'))); });
    assert.equal(flatten(renderer.root.findByProps({ testID: 'dish-sheet' }).props.style).height, 736);
    assert.equal(h.animations[0].config.duration, reduced ? 120 : 420);
    const content = renderer.root.findAllByType('GestureDetector').find(node => node.props.gesture.config.manualActivation).props.gesture;
    let failed = 0, activated = 0;
    const manager = { fail: () => failed++, activate: () => activated++ };
    const touches = (x, y) => ({ allTouches: [{ absoluteX: x, absoluteY: y }] });
    content.callbacks.onTouchesDown(touches(0, 0)); content.callbacks.onTouchesMove(touches(30, 5), manager);
    assert.equal(failed, 1, 'horizontal add-ons must win');
    const scroll = renderer.root.findByProps({ testID: 'dish-sheet-scroll' });
    scroll.props.onScroll({ contentOffset: { y: 120 } });
    content.callbacks.onTouchesDown(touches(0, 0)); content.callbacks.onTouchesMove(touches(0, 30), manager);
    assert.equal(failed, 2, 'scrolled content must scroll instead of closing');
    scroll.props.onScroll({ contentOffset: { y: 0 } });
    content.callbacks.onTouchesDown(touches(0, 0)); content.callbacks.onTouchesMove(touches(0, 30), manager);
    assert.equal(activated, 1);
    content.callbacks.onStart(); content.callbacks.onUpdate({ translationY: 30 }); content.callbacks.onEnd({ velocityY: 10 });
    assert.equal(h.animations.at(-1).value, 0, 'a short slow drag restores the sheet');
    assert.equal(h.animations.at(-1).type, reduced ? 'timing' : 'spring');
    h.shared[1].value = 58; // Capture a panel halfway through its settle.
    content.callbacks.onStart(); content.callbacks.onUpdate({ translationY: 5 });
    assert.equal(h.shared[1].value, 63, 'a new drag continues from the current position');
    content.callbacks.onEnd({ velocityY: 0 });
    content.callbacks.onStart(); content.callbacks.onUpdate({ translationY: 35 }); content.callbacks.onEnd({ velocityY: 1100 });
    assert.equal(h.animations.at(-1).config.duration, reduced ? 120 : 360);
    assert.equal(closed, 0, 'route remains until exit finishes');
    await act(async () => h.animations.at(-1).callback(true));
    assert.equal(closed, 1);
    assert.equal(h.backListeners.length, 1);
    await act(async () => renderer.unmount());
    assert.equal(h.backListeners.length, 0);
  }
});
