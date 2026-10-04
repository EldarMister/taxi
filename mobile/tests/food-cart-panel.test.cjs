const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { act, create } = require('react-test-renderer');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const source = fs.readFileSync(path.join(__dirname, '../src/food/CheckoutScreens.tsx'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;

const colors = { ink: '#111318', muted: '#8A9099', blue: '#087FFF', surface: '#F1F1EF', white: '#FFFFFF' };
const dishes = [
  { id: 'plov', name: 'Плов', price: 380, portion: '1 порция', available: true, optionIds: [] },
  { id: 'samsa', name: 'Самса', price: 180, portion: '1 штука', available: true, optionIds: [] },
];
const restaurant = { id: 'halva', name: 'Халва', dishes, options: [], deliveryFee: 0, minimumOrder: 0, etaMin: 35, etaMax: 45 };
// Keep real pricing/availability checks in native component tests, including
// independent delivery thresholds and equal dish ids at different restaurants.
function loadFoodLogic(file) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: id => {
    if (id === './dishOptions') return loadFoodLogic('dishOptions.ts');
    if (id === './promotions') return loadFoodLogic('promotions.ts');
    throw new Error(`Unexpected logic dependency ${id}`);
  } });
  return exports;
}
const cartLogic = loadFoodLogic('cart.ts');

function loadCheckoutDetails() {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food/checkoutDetails.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports });
  return exports;
}

function loadScreens(file = 'CheckoutScreens.tsx') {
  const exports = {};
  const moduleCode = file === 'CheckoutScreens.tsx' ? code : ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/food', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(moduleCode, { exports, require: id => {
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return {
      Image: 'Image', Keyboard: { dismiss() {} }, KeyboardAvoidingView: 'KeyboardAvoidingView',
      Platform: { OS: 'android' }, Pressable: 'Pressable', ScrollView: 'ScrollView', Switch: 'Switch', ActivityIndicator: 'ActivityIndicator',
      StyleSheet: { create: styles => styles, hairlineWidth: 1 }, Text: 'Text', TextInput: 'TextInput', View: 'View',
      useWindowDimensions: () => ({ height: 850, width: 390 }),
    };
    if (id === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ top: 24, bottom: 24 }) };
    if (id === '../ui') return { Icon: 'Icon' };
    if (id === '@expo/vector-icons') return { Ionicons: 'Icon' };
    if (id === '../BottomPanel') return { BottomPanel: props => React.createElement('BottomPanel', props, props.children) };
    if (id === '../design/motion') return { Reveal: props => props.children, SpringPressable: props => React.createElement('SpringPressable', props, props.children) };
    if (id === '../design/tokens') return { palette: { ...colors, canvas: '#F7F7F5', line: '#E7E7E3', blueSoft: '#E8F2FF' }, radii: { small: 12, medium: 16, large: 22, hero: 28 } };
    if (id === '../design/typography') return { fonts: { regular: 'regular', medium: 'medium', semibold: 'semibold', bold: 'bold', black: 'black' } };
    if (id === './components') return {
      FoodButton: props => React.createElement('FoodButton', props), FoodHeader: () => null,
      FoodIconButton: props => React.createElement('FoodIconButton', props), foodColors: colors,
      money: value => `${value} сом`,
    };
    if (id === './foodTheme') return { useFoodColors: () => colors, useFoodStyles: styles => styles };
    if (id === '../design/theme') return { useTheme: () => ({ isDark: false, palette: { ...colors, elevated: '#F1F1EF', accent: colors.blue, accentText: '#FFFFFF' } }) };
    if (id === './assets') return { foodImage: () => 'dish-image' };
    if (id === './FoodPhoto') return { FoodPhoto: props => React.createElement('Image', props) };
    if (id === './FoodSwitch') return { FoodSwitch: props => React.createElement('FoodSwitch', props) };
    if (id === './FoodDeliveryStatus') return loadScreens('FoodDeliveryStatus.tsx');
    if (id === './cart') return cartLogic;
    if (id === './promotions') return loadFoodLogic('promotions.ts');
    if (id === './NumberTicker') return { NumberTicker: props => React.createElement('NumberTicker', props) };
    if (id === './i18n') return { useFoodT: () => value => value };
    if (id === '../address') return { shortAddress: value => value };
    if (id === './checkoutDetails') return loadCheckoutDetails();
    throw new Error(`Unexpected import ${id}`);
  } }, { filename: 'CheckoutScreens.tsx' });
  return exports;
}

test('reference cart scrolls full screen and keeps live quantity and recommendation actions', async () => {
  const { CartScreen } = loadScreens();
  const changes = [];
  const added = [];
  let checkedOut = 0;
  let openedRestaurant = 0;
  const props = { restaurant, lines: [{ dishId: 'plov', optionIds: [], quantity: 1 }], onBack() {}, onClear() {}, onQuantity() {}, onQuantityDelta: (key, delta) => changes.push([key, delta]), onRemoveOption() {}, onCheckout: () => checkedOut++, onRestaurant: () => openedRestaurant++, onAddRecommendation: dish => added.push(dish.id) };
  let renderer;
  await act(async () => { renderer = create(React.createElement(CartScreen, props)); });
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0, 'the cart is a full screen; only comments open a sheet');
  assert.equal(renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'tab').length, 0, 'a single restaurant needs no basket switcher');
  await act(async () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Открыть Халва').props.onPress());
  assert.equal(openedRestaurant, 1, 'the compact restaurant title still opens its menu');
  const body = () => renderer.root.findAllByType('ScrollView').find(node => !node.props.horizontal);
  assert.equal(body().props.style?.height, undefined, 'long carts use the whole available scrolling area');
  assert.ok(body().props.contentContainerStyle.paddingBottom > 100, 'the floating dock does not cover the last dish');
  const checkout = () => renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === 'К оплате');
  assert.equal(checkout().props.disabled, false);
  await act(async () => checkout().props.onPress());
  assert.equal(checkedOut, 1);
  const step = () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Увеличить Плов');
  await act(async () => step().props.onPress());
  assert.deepEqual(changes, [['plov:', 1]], 'rapid changes use the latest-cart delta callback');
  await act(async () => renderer.update(React.createElement(CartScreen, { ...props, lines: [{ ...props.lines[0], quantity: 2 }] })));
  assert.equal(renderer.root.findAllByType('NumberTicker')[0].props.value, 2);
  const recommendation = renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Добавить Самса');
  await act(async () => recommendation.props.onPress());
  assert.deepEqual(added, ['samsa']);
  await act(async () => renderer.update(React.createElement(CartScreen, { ...props, lines: [{ ...props.lines[0], quantity: 20 }] })));
  assert.equal(step().props.disabled, true, 'the shared quantity cap still applies');
  await act(async () => renderer.unmount());
});

test('order instructions preserve legacy retry signatures and every new checkout detail', () => {
  const { formatCheckoutComment } = loadCheckoutDetails();
  const legacy = { fulfillment: 'DELIVERY', address: 'Бишкек, Ленина 10', comment: '  Позвоните у подъезда  ', paymentMethod: 'CASH' };
  assert.equal(formatCheckoutComment(legacy), legacy.comment.trim(), 'an existing pending request keeps its exact comment and idempotency signature');
  const formatted = formatCheckoutComment({ ...legacy, entrance: '2', floor: '4', apartment: '15', intercom: '15#', cutleryCount: 0, restaurantComment: 'Без лука', recipientPhone: '+996700123456', leaveAtDoor: true });
  for (const instruction of ['Подъезд: 2', 'Этаж: 4', 'Квартира: 15', 'Домофон: 15#', 'Приборы: 0', 'Ресторану: Без лука', 'Телефон получателя: +996700123456', 'Оставить у двери', 'Курьеру: Позвоните у подъезда']) assert.ok(formatted.includes(instruction), instruction);
  assert.ok(formatCheckoutComment({ ...legacy, restaurantComment: 'я'.repeat(501) }).length > 500, 'formatting never silently truncates user instructions');
});

test('cart saves cutlery and restaurant instructions through shared checkout details', async () => {
  const { CartScreen } = loadScreens();
  let details = { fulfillment: 'DELIVERY', address: 'Бишкек, Ленина 10', comment: '', paymentMethod: 'CASH' };
  let renderer;
  const props = { restaurant, lines: [{ dishId: 'plov', optionIds: [], quantity: 1 }], onBack() {}, onClear() {}, onQuantity() {}, onRemoveOption() {}, onCheckout() {}, onDetails: value => { details = value; } };
  await act(async () => { renderer = create(React.createElement(CartScreen, { ...props, details })); });
  const press = label => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
  await act(async () => press('Увеличить Приборы').props.onPress());
  assert.equal(details.cutleryCount, 1);
  await act(async () => renderer.update(React.createElement(CartScreen, { ...props, details })));
  await act(async () => press('Комментарий ресторану').props.onPress());
  const input = () => renderer.root.findByType('TextInput');
  assert.equal(input().props.autoFocus, true);
  await act(async () => input().props.onChangeText('Без лука'));
  await act(async () => renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === 'Готово').props.onPress());
  assert.equal(details.restaurantComment, 'Без лука');
  assert.equal(details.cutleryCount, 1, 'editing restaurant instructions preserves other checkout details');
  assert.equal(renderer.root.findByType('BottomPanel').props.closeRequested, true, 'save lets the bottom sheet complete its exit');
  await act(async () => renderer.root.findByType('BottomPanel').props.onClose());
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0);
  await act(async () => renderer.unmount());
});

test('checkout opens the shared map, preserves destination details, and guards payment', async () => {
  const { CheckoutScreen } = loadScreens();
  let details = { fulfillment: 'DELIVERY', address: 'Бишкек, Ленина 10', comment: '', paymentMethod: 'CASH' };
  let openedAddress = 0;
  let submitted = 0;
  const props = { restaurant, lines: [{ dishId: 'plov', optionIds: [], quantity: 1 }], paymentMethods: [{ id: 'CASH', available: true }, { id: 'CARD', available: false }], onDetails: value => { details = value; }, onBack() {}, onSubmit: () => submitted++, onChangeAddress: () => openedAddress++, busy: false, error: '' };
  let renderer;
  await act(async () => { renderer = create(React.createElement(CheckoutScreen, { ...props, details })); });
  const press = label => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === label);
  await act(async () => press('Изменить адрес доставки').props.onPress());
  assert.equal(openedAddress, 1);
  assert.equal(renderer.root.findAllByType('BottomPanel').length, 0, 'address selection belongs to the shared map, not a free-text popup');
  const entrance = renderer.root.findAllByType('TextInput').find(node => node.props.accessibilityLabel === 'Подъезд');
  await act(async () => entrance.props.onChangeText('2'));
  assert.equal(details.entrance, '2');
  assert.equal(details.address, 'Бишкек, Ленина 10');
  await act(async () => renderer.root.findByType('FoodSwitch').props.onValueChange(true));
  assert.equal(details.leaveAtDoor, true, 'the custom delivery switch writes into persisted checkout details');
  const payments = renderer.root.findAllByType('Pressable').filter(node => node.props.accessibilityRole === 'radio');
  assert.equal(payments.find(node => node.props.accessibilityLabel.startsWith('Картой')).props.disabled, true);
  assert.equal(payments.find(node => node.props.accessibilityLabel === 'Наличными').props.accessibilityState.checked, true);
  const submit = () => renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === 'Заказать');
  assert.equal(submit().props.disabled, false);
  await act(async () => submit().props.onPress());
  assert.equal(submitted, 1);
  await act(async () => renderer.update(React.createElement(CheckoutScreen, { ...props, details, busy: true })));
  assert.equal(submit().props.disabled, true);
  assert.equal(press('Изменить адрес доставки').props.disabled, true);
  assert.equal(renderer.root.findByType('FoodSwitch').props.disabled, true);
  await act(async () => renderer.update(React.createElement(CheckoutScreen, { ...props, details: { ...details, comment: 'я'.repeat(501) } })));
  assert.equal(submit().props.disabled, true, 'instructions must fit the order API without silent truncation');
  await act(async () => renderer.update(React.createElement(CheckoutScreen, { ...props, details: { ...details, address: '' } })));
  assert.equal(submit().props.disabled, true, 'a delivery address remains required');
  await act(async () => renderer.unmount());
});

test('restaurant cart tabs retain each restaurant quantity and target the currently selected cart', async () => {
  const { CartScreen } = loadScreens();
  const sushi = { ...restaurant, id: 'sushi', name: 'Азия суши', dishes: [{ ...dishes[0], name: 'Ролл', price: 450 }], deliveryFee: 90 };
  const carts = [
    { restaurantId: restaurant.id, restaurant, lines: [{ dishId: 'plov', optionIds: [], quantity: 2 }] },
    { restaurantId: sushi.id, restaurant: sushi, lines: [{ dishId: 'plov', optionIds: [], quantity: 3 }] },
  ];
  const before = JSON.stringify(carts), selected = [], changed = [], opened = [];
  let active = 0, renderer;
  const props = () => ({ restaurant: carts[active].restaurant, lines: carts[active].lines, carts,
    onSelectRestaurant: id => selected.push(id), onRestaurant: () => opened.push(carts[active].restaurantId),
    onBack() {}, onClear() {}, onQuantity() {}, onRemoveOption() {}, onCheckout() {},
    onQuantityDelta: (key, delta) => changed.push([carts[active].restaurantId, key, delta]),
  });
  await act(async () => { renderer = create(React.createElement(CartScreen, props())); });
  const tab = label => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityRole === 'tab' && node.props.accessibilityLabel === label);
  const dishQuantity = () => renderer.root.findAllByType('NumberTicker')[0].props.value;
  assert.equal(tab('Халва').props.accessibilityState.selected, true);
  assert.equal(tab('Азия суши').props.accessibilityState.selected, false);
  assert.equal(dishQuantity(), 2);
  await act(async () => tab('Азия суши').props.onPress());
  assert.deepEqual(selected, ['sushi']);
  assert.deepEqual(opened, [], 'switching to another restaurant does not open its menu');
  active = 1;
  await act(async () => renderer.update(React.createElement(CartScreen, props())));
  assert.equal(tab('Азия суши').props.accessibilityState.selected, true);
  assert.equal(dishQuantity(), 3);
  await act(async () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Увеличить Ролл').props.onPress());
  assert.deepEqual(changed, [['sushi', 'plov:', 1]], 'equal dish ids are changed only in the selected restaurant cart');
  await act(async () => tab('Халва').props.onPress());
  assert.deepEqual(selected, ['sushi', 'halva']);
  active = 0;
  await act(async () => renderer.update(React.createElement(CartScreen, props())));
  assert.equal(dishQuantity(), 2);
  assert.equal(JSON.stringify(carts), before, 'switching tabs never mutates either controlled basket');
  assert.equal(renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === 'К оплате').props.disabled, false);
  await act(async () => renderer.unmount());
});

test('cart delivery conditions open for paid and free delivery and follow the current threshold', async () => {
  const { CartScreen } = loadScreens();
  let opened = 0, renderer;
  const paid = { ...restaurant, deliveryFee: 90, freeDeliveryThreshold: 700 };
  const props = { restaurant: paid, lines: [{ dishId: 'plov', optionIds: [], quantity: 1 }],
    onBack() {}, onClear() {}, onQuantity() {}, onRemoveOption() {}, onCheckout() {}, onDeliveryInfo: () => opened++,
  };
  await act(async () => { renderer = create(React.createElement(CartScreen, props)); });
  const delivery = () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Подробные условия доставки');
  const text = () => delivery().findAllByType('Text').map(node => node.props.children).join(' | ');
  assert.equal(renderer.root.findAllByProps({ testID: 'food-free-delivery-progress' }).length, 1);
  assert.match(text(), /До бесплатной доставки осталось 320 сом/);
  assert.equal(delivery().props.disabled, false);
  await act(async () => delivery().props.onPress());
  await act(async () => renderer.update(React.createElement(CartScreen, { ...props, lines: [{ ...props.lines[0], quantity: 2 }] })));
  assert.match(text(), /Бесплатная доставка/);
  await act(async () => delivery().props.onPress());
  assert.equal(opened, 2, 'the same panel callback remains available when the order becomes free');
  await act(async () => renderer.update(React.createElement(CartScreen, { ...props, onDeliveryInfo: undefined })));
  assert.equal(delivery().props.disabled, true);
  await act(async () => renderer.unmount());
});

test('combined checkout includes each restaurant delivery fee and guards every restaurant', async () => {
  const { CheckoutScreen } = loadScreens();
  const first = { ...restaurant, deliveryFee: 80 };
  const second = { ...restaurant, id: 'sushi', name: 'Азия суши', dishes: [{ ...dishes[0], name: 'Ролл', price: 450 }], deliveryFee: 120 };
  const carts = [
    { restaurantId: first.id, restaurant: first, lines: [{ dishId: 'plov', optionIds: [], quantity: 2 }] },
    { restaurantId: second.id, restaurant: second, lines: [{ dishId: 'plov', optionIds: [], quantity: 3 }] },
  ];
  let submitted = 0, renderer;
  const props = { restaurant: first, lines: carts[0].lines, carts,
    details: { fulfillment: 'DELIVERY', address: 'Бишкек, Ленина 10', comment: '', paymentMethod: 'CASH' },
    paymentMethods: [{ id: 'CASH', available: true }], onDetails() {}, onBack() {}, onSubmit: () => submitted++, busy: false, error: '',
  };
  await act(async () => { renderer = create(React.createElement(CheckoutScreen, props)); });
  const submit = () => renderer.root.findAllByType('SpringPressable').find(node => node.props.accessibilityLabel === 'Заказать');
  const hasText = value => renderer.root.findAllByType('Text').some(node => node.props.children === value);
  assert.equal(renderer.root.findByType('NumberTicker').props.value, 2310, '760 + 80 and 1350 + 120 are charged together');
  assert.ok(hasText('Халва')); assert.ok(hasText('Азия суши'));
  assert.ok(hasText('840 сом')); assert.ok(hasText('1470 сом'));
  assert.equal(submit().props.disabled, false);
  await act(async () => submit().props.onPress());
  assert.equal(submitted, 1);
  await act(async () => renderer.root.findAllByType('Pressable').find(node => node.props.accessibilityLabel === 'Показать состав суммы').props.onPress());
  assert.ok(hasText('2110 сом')); assert.ok(hasText('200 сом'), 'the breakdown adds both restaurants delivery fees');
  await act(async () => renderer.update(React.createElement(CheckoutScreen, { ...props, carts: [carts[0], { ...carts[1], restaurant: { ...second, minimumOrder: 2000 } }] })));
  assert.equal(submit().props.disabled, true, 'the second restaurant minimum cannot be satisfied using the first restaurant subtotal');
  await act(async () => renderer.update(React.createElement(CheckoutScreen, { ...props, carts: [carts[0], { ...carts[1], restaurant: { ...second, dishes: [{ ...second.dishes[0], available: false }] } }] })));
  assert.equal(submit().props.disabled, true, 'an unavailable dish in a non-selected restaurant blocks the combined order');
  await act(async () => renderer.update(React.createElement(CheckoutScreen, { ...props, carts: [carts[0], { ...carts[1], restaurant: undefined }] })));
  assert.equal(submit().props.disabled, true, 'a removed restaurant cannot be submitted with another valid basket');
  await act(async () => renderer.update(React.createElement(CheckoutScreen, { ...props, carts: [carts[0], { ...carts[1], restaurantComment: 'я'.repeat(501) }] })));
  assert.equal(submit().props.disabled, true, 'each restaurant instruction must fit the API limit');
  await act(async () => renderer.unmount());
});
