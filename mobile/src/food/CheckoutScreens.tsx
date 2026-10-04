import React, { useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui';
import { BottomPanel } from '../BottomPanel';
import { SpringPressable } from '../design/motion';
import { fonts } from '../design/typography';
import { palette } from '../design/tokens';
import { useTheme } from '../design/theme';
import { FoodIconButton, money } from './components';
import { FoodPhoto } from './FoodPhoto';
import { cartLineKey, cartSummary, MAX_FOOD_QUANTITY } from './cart';
import { NumberTicker } from './NumberTicker';
import { FoodSwitch } from './FoodSwitch';
import { FoodDeliveryStatus } from './FoodDeliveryStatus';
import type { CartLine, FoodCatalog, FoodDish, FoodRestaurant } from './types';
import { useFoodT } from './i18n';
import { shortAddress } from '../address';
import { formatCheckoutComment, type CheckoutDetails } from './checkoutDetails';
export type { CheckoutDetails } from './checkoutDetails';
export type CheckoutCart = { restaurantId: string; restaurant?: FoodRestaurant; lines: CartLine[]; restaurantComment?: string; cutleryCount?: number };

function useCheckoutColors() {
  const theme = useTheme();
  return theme.isDark ? {
    background: theme.palette.background, surface: theme.palette.surface,
    soft: theme.palette.elevated, ink: theme.palette.ink, muted: theme.palette.muted,
    line: theme.palette.line, green: '#69C89B', primary: palette.blue, buttonInk: '#FFFFFF',
  } : {
    background: '#F5F4F2', surface: '#FFFFFF', soft: '#F5F4F2',
    ink: '#262626', muted: '#9B9B98', line: '#DEDEDC', green: '#258F61',
    primary: palette.blue, buttonInk: '#FFFFFF',
  };
}

function PrimaryButton({ label, onPress, disabled, busy, arrow = false }: {
  label: string; onPress: () => void; disabled?: boolean; busy?: boolean; arrow?: boolean;
}) {
  const c = useCheckoutColors();
  return <SpringPressable accessibilityRole="button" accessibilityLabel={label}
    accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={!!disabled || !!busy}
    onPress={onPress} pressScale={.985} containerStyle={{ alignSelf: 'stretch' }} style={[s.primaryButton, { backgroundColor: c.primary }]}>
    {busy && <ActivityIndicator color={c.buttonInk} />}
    <Text style={[s.buttonLabel, { color: c.buttonInk }]}>{label}</Text>
    {arrow && <Icon name="chevron-forward-circle" color={c.buttonInk} size={24} />}
  </SpringPressable>;
}

function QuantityControl({ value, onDecrease, onIncrease, name, maximum = MAX_FOOD_QUANTITY, unavailable = false }: {
  value: number; onDecrease: () => void; onIncrease: () => void; name: string; maximum?: number; unavailable?: boolean;
}) {
  const c = useCheckoutColors();
  return <View style={[s.stepper, { backgroundColor: c.soft }]} accessibilityRole="adjustable" accessibilityLabel={`${name}: ${value}`}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Уменьшить ${name}`} disabled={value === 0} onPress={onDecrease} style={s.stepButton}>
      <Icon name="remove" size={23} color={value === 0 ? c.muted : c.ink} />
    </Pressable>
    <NumberTicker value={value} style={[s.quantity, { color: c.ink }]} height={22} />
    <Pressable accessibilityRole="button" accessibilityLabel={`Увеличить ${name}`} accessibilityState={{ disabled: unavailable || value >= maximum }} disabled={unavailable || value >= maximum} onPress={onIncrease} style={s.stepButton}>
      <Icon name="add" size={23} color={unavailable || value >= maximum ? c.muted : c.ink} />
    </Pressable>
  </View>;
}

function CommentEditor({ label, value, onSave, onClose, phone = false }: {
  label: string; value: string; onSave: (value: string) => void; onClose: () => void; phone?: boolean;
}) {
  const c = useCheckoutColors();
  const t = useFoodT();
  const [draft, setDraft] = useState(value);
  const [closing, setClosing] = useState(false);
  const save = () => { onSave(draft.trim()); Keyboard.dismiss(); setClosing(true); };
  return <BottomPanel label={t('Закрыть')} closeRequested={closing} onClose={() => { Keyboard.dismiss(); onClose(); }}>
    <View style={[s.commentSheet, { backgroundColor: c.surface }]}>
      <TextInput autoFocus accessibilityLabel={label} value={draft} onChangeText={setDraft}
        placeholder={label} placeholderTextColor={c.muted} multiline={!phone}
        keyboardType={phone ? 'phone-pad' : 'default'} maxLength={phone ? 30 : 200}
        returnKeyType={phone ? 'done' : 'default'} onSubmitEditing={phone ? save : undefined}
        textAlignVertical="top" style={[s.commentInput, { color: c.ink, borderBottomColor: c.primary }]} />
      <PrimaryButton label={t('Готово')} onPress={save} />
    </View>
  </BottomPanel>;
}

export function CartScreen({ restaurant, lines, carts, onSelectRestaurant, checkoutInvalid, onDeliveryInfo, onBack, onClear, onQuantity, onQuantityDelta, onCheckout, onAddRecommendation, onDish, onRestaurant, details, onDetails }: {
  restaurant?: FoodRestaurant; lines: CartLine[]; onBack: () => void; onClear: () => void;
  onQuantity: (key: string, quantity: number) => void; onRemoveOption: (id: string) => void; onCheckout: () => void;
  onAddRecommendation?: (dish: FoodDish) => void; onQuantityDelta?: (key: string, delta: number) => void;
  onDish?: (dish: FoodDish) => void; onRestaurant?: () => void;
  details?: CheckoutDetails; onDetails?: (value: CheckoutDetails) => void;
  carts?: CheckoutCart[]; onSelectRestaurant?: (id: string) => void; checkoutInvalid?: boolean; onDeliveryInfo?: () => void;
}) {
  const t = useFoodT();
  const c = useCheckoutColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [editingComment, setEditingComment] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [localComment, setLocalComment] = useState('');
  const [localCutlery, setLocalCutlery] = useState(0);
  const [measuredFooterHeight, setMeasuredFooterHeight] = useState(0);
  const summary = cartSummary(restaurant, lines);
  const missing = lines.filter(line => !summary.items.some(item => cartLineKey(item) === cartLineKey(line)));
  const recommendations = restaurant?.dishes.filter(dish => dish.available && !lines.some(line => line.dishId === dish.id) && (!search.trim() || dish.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))) || [];
  const cardWidth = (width - 48) / 3;
  const cutleryCount = details?.cutleryCount ?? localCutlery;
  const restaurantComment = details?.restaurantComment ?? localComment;
  const updateCutlery = (count: number) => {
    const next = Math.min(20, Math.max(0, count));
    if (details && onDetails) onDetails({ ...details, cutleryCount: next });
    else setLocalCutlery(next);
  };
  const checkoutDisabled = !!checkoutInvalid || summary.invalid || !summary.count || !restaurant || restaurant.isOpen === false || summary.subtotal < restaurant.minimumOrder;
  const restaurantTabs = (carts?.length ? carts : restaurant ? [{ restaurantId: restaurant.id, restaurant, lines }] : []).filter(cart => cart.lines.length > 0);
  const singleRestaurant = !!lines.length && !!restaurant && restaurantTabs.length === 1;
  const originalSubtotal = summary.items.reduce((total, item) => total + item.total + Math.max(0, (item.dish.originalPrice ?? item.dish.price) - item.dish.price) * item.quantity, 0);
  const hasDiscount = originalSubtotal > summary.subtotal;
  const footerHeight = measuredFooterHeight || 76 + insets.bottom;
  return <SafeAreaView style={[s.screen, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
    <View style={{ flex: 1 }} accessibilityElementsHidden={editingComment} importantForAccessibility={editingComment ? 'no-hide-descendants' : 'auto'}>
      <View style={[s.header, { backgroundColor: c.surface }]}>
        <FoodIconButton name="arrow-back" label={t('Назад')} onPress={onBack} color={c.ink} />
        {singleRestaurant ? <Pressable accessibilityRole="button" accessibilityLabel={`${t('Открыть')} ${restaurant.name}`} onPress={onRestaurant || onBack} style={s.singleRestaurantHeader}>
          <View style={s.singleRestaurantNameRow}><Text style={[s.singleRestaurantName, { color: c.ink }]} numberOfLines={1}>{restaurant.name}</Text><Icon name="chevron-forward-circle" size={14} color={c.ink} /></View>
          <Text style={[s.singleRestaurantMeta, { color: c.muted }]} numberOfLines={1}><Text style={{ color: hasDiscount ? c.green : c.ink }}>{money(summary.subtotal)}</Text>{hasDiscount && <Text style={s.oldSubtotal}> {money(originalSubtotal)}</Text>}{` · ${restaurant.isOpen === false ? t('Сейчас закрыто') : `${restaurant.etaMin}–${restaurant.etaMax} ${t('мин')}`}`}</Text>
        </Pressable> : <Text style={[s.headerTitle, { color: c.ink }]}>{t('Корзина')}</Text>}
        <View style={s.headerActions}>
          {!!lines.length && <FoodIconButton name={searchOpen ? 'close' : 'search-outline'} label={t('Поиск блюд')} onPress={() => { setSearchOpen(!searchOpen); setSearch(''); }} color={c.ink} />}
          <FoodIconButton name="trash-outline" label={t('Очистить корзину')} onPress={onClear} disabled={!lines.length} color={c.ink} />
        </View>
      </View>
      {lines.length ? <>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: footerHeight + 92, backgroundColor: c.surface }}>
          <View style={[s.cartTopCard, { backgroundColor: c.surface }]}>
            {restaurantTabs.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.restaurantTabs}>{restaurantTabs.map(cart => {
              const selected = cart.restaurantId === restaurant?.id;
              const total = cartSummary(cart.restaurant, cart.lines);
              return <Pressable key={cart.restaurantId} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={cart.restaurant?.name || t('Меню обновляется')} onPress={() => selected ? (onRestaurant || onBack)() : onSelectRestaurant?.(cart.restaurantId)} style={[s.restaurantChip, { borderColor: selected ? c.ink : c.line, borderWidth: selected ? 1.7 : 1 }]}>
                <View style={s.inline}><Text style={[s.restaurantName, { color: c.ink }]} numberOfLines={1}>{cart.restaurant?.name || t('Меню обновляется')}</Text>{selected && <Icon name="chevron-forward-circle" size={15} color={c.ink} />}</View>
                <Text style={[s.restaurantMeta, { color: c.muted }]}><Text style={{ color: c.ink }}>{money(total.subtotal)}</Text>{cart.restaurant ? ` · ${cart.restaurant.etaMin}–${cart.restaurant.etaMax} ${t('мин')}` : ''}</Text>
              </Pressable>;
            })}</ScrollView>}
            {summary.items.map(item => {
              const key = cartLineKey(item);
              const allDishQuantity = lines.filter(line => line.dishId === item.dishId).reduce((total, line) => total + line.quantity, 0);
              const changeQuantity = (delta: number) => onQuantityDelta ? onQuantityDelta(key, delta) : onQuantity(key, item.quantity + delta);
              return <View key={key} style={s.cartRow}>
                <FoodPhoto imageKey={item.dish.id} imageUrl={item.dish.imageUrl} fallbackKey={item.dish.imageKey} style={[s.cartImage, { backgroundColor: c.soft }]} />
                <View style={s.cartItemCopy}>
                  <Text numberOfLines={2} style={[s.itemName, { color: c.ink }]}>{item.dish.name}</Text>
                  {!!item.options.length && <Text numberOfLines={2} style={[s.smallMuted, { color: c.muted }]}>{item.options.map(option => option.name).join(', ')}</Text>}
                  <Text style={[s.cartItemPrice, { color: c.ink }]}>{money(item.total)}<Text style={[s.smallMuted, { color: c.muted }]}> · {item.dish.portion}</Text></Text>
                  {!item.dish.available && <Text style={s.errorText}>{t('Нет в наличии')}</Text>}
                </View>
                <QuantityControl value={item.quantity} name={item.dish.name} onDecrease={() => changeQuantity(-1)} onIncrease={() => changeQuantity(1)} unavailable={restaurant?.isOpen === false || !item.dish.available || allDishQuantity >= MAX_FOOD_QUANTITY} />
              </View>;
            })}
            {missing.map(line => <View key={cartLineKey(line)} style={s.cartRow}><Text style={[s.errorText, { flex: 1 }]}>{t('Блюдо больше недоступно')}</Text><Pressable accessibilityRole="button" onPress={() => onQuantity(cartLineKey(line), 0)}><Text style={[s.itemName, { color: c.ink }]}>{t('Удалить')}</Text></Pressable></View>)}
          </View>
          <View style={{ backgroundColor: c.background }}><View style={[s.cartOptions, { backgroundColor: c.surface }]}>
            <View style={[s.cutleryControl, { backgroundColor: c.soft }]}><Icon name="restaurant" size={22} color={c.ink} /><View style={[s.verticalRule, { backgroundColor: c.line }]} /><QuantityControl name={t('Приборы')} value={cutleryCount} onDecrease={() => updateCutlery(cutleryCount - 1)} onIncrease={() => updateCutlery(cutleryCount + 1)} /></View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Комментарий ресторану')} onPress={() => setEditingComment(true)} style={[s.restaurantComment, { backgroundColor: c.soft }]}>
              <Icon name="options-outline" size={24} color={c.ink} /><View style={[s.verticalRule, { backgroundColor: c.line }]} />
              <Text style={[s.commentLabel, { color: restaurantComment ? c.ink : c.muted }]} numberOfLines={2}>{restaurantComment || t('Комментарий ресторану')}</Text><Icon name="chevron-forward" size={18} color={c.ink} />
            </Pressable>
          </View></View>
          <View style={{ backgroundColor: c.background }}><View style={[s.recommendationSection, { backgroundColor: c.surface }]}>
            <Text style={[s.sectionTitle, { color: c.ink }]}>{t('Что-то ещё?')}</Text>
            {searchOpen && <TextInput autoFocus accessibilityLabel={t('Поиск блюд')} placeholder={t('Поиск блюд')} placeholderTextColor={c.muted} value={search} onChangeText={setSearch} style={[s.search, { color: c.ink, backgroundColor: c.soft }]} />}
            <View style={s.recommendationGrid}>{recommendations.map(dish => {
              const discount = dish.originalPrice && dish.originalPrice > dish.price ? Math.round((1 - dish.price / dish.originalPrice) * 100) : 0;
              return <View key={dish.id} style={[s.recommendationCard, { width: cardWidth }]}>
              <View>
                <Pressable accessibilityRole={onDish ? 'button' : undefined} accessibilityLabel={onDish ? `${t('Открыть')} ${dish.name}` : undefined} disabled={!onDish} onPress={() => onDish?.(dish)}>
                  <FoodPhoto imageKey={dish.id} imageUrl={dish.imageUrl} fallbackKey={dish.imageKey} style={[s.recommendationImage, { width: cardWidth, height: cardWidth / .88, backgroundColor: c.soft }]} />
                </Pressable>
                {!!discount && <View style={[s.discountBadge, { backgroundColor: c.green }]}><Text style={s.discountLabel}>−{discount}%</Text></View>}
                <Pressable accessibilityRole="button" accessibilityLabel={`${t('Добавить')} ${dish.name}`} disabled={!onAddRecommendation || restaurant?.isOpen === false} onPress={() => onAddRecommendation?.(dish)} style={[s.recommendationAdd, { backgroundColor: c.surface }]}><Icon name="add" size={26} color={restaurant?.isOpen === false ? c.muted : c.ink} /></Pressable>
              </View>
              <Text style={[s.recommendationPrice, { color: discount ? c.green : c.ink }]}>{money(dish.price)}</Text>
              {!!discount && <Text style={[s.recommendationOldPrice, { color: c.muted }]}>{money(dish.originalPrice!)}</Text>}
              <Text style={[s.recommendationName, { color: c.ink }]} numberOfLines={3}>{dish.name}</Text>
              <Text style={[s.recommendationPortion, { color: c.muted }]} numberOfLines={2}>{dish.portion}{dish.calories != null ? ` · ${dish.calories} ${t('ккал')}` : ''}</Text>
              {!!dish.reviewCount && dish.ratingPercent != null ? <View style={s.recommendationRating}><Icon name="thumbs-up" size={12} color={c.ink} /><Text style={[s.recommendationRatingText, { color: c.ink }]}>{dish.ratingPercent}% ({dish.reviewCount})</Text></View> : !!dish.badge && <Text style={[s.recommendationRatingText, { color: c.ink, marginLeft: 4 }]}>{dish.badge}</Text>}
            </View>})}</View>
            {!recommendations.length && <Text style={[s.emptyRecommendations, { color: c.muted }]}>{search.trim() ? t('Ничего не найдено') : t('Все любимые блюда уже в корзине')}</Text>}
          </View></View>
          {summary.invalid && <Text style={[s.errorText, s.cartError]}>{t('Состав меню изменился. Уберите недоступные блюда.')}</Text>}
          {!!restaurant && summary.subtotal < restaurant.minimumOrder && <Text style={[s.errorText, s.cartError]}>{t('Минимальный заказ')} — {money(restaurant.minimumOrder)}</Text>}
        </ScrollView>
        <View style={[s.checkoutFloating, { bottom: footerHeight + 8 }]}><PrimaryButton label={t('К оплате')} arrow onPress={onCheckout} disabled={checkoutDisabled} /></View>
        <View onLayout={event => setMeasuredFooterHeight(event.nativeEvent.layout.height)} style={[s.deliveryFooter, { backgroundColor: c.surface, paddingHorizontal: 12, paddingBottom: Math.max(16, insets.bottom), minHeight: 76 + insets.bottom }]}>
          {restaurant && <FoodDeliveryStatus restaurant={restaurant} subtotal={summary.subtotal} subtotalBeforeDiscount={summary.subtotalBeforeDiscount} onPress={onDeliveryInfo} />}
        </View>
      </> : <View style={[s.empty, { backgroundColor: c.surface }]}><Icon name="bag-handle-outline" size={56} color={c.ink} /><Text style={[s.emptyTitle, { color: c.ink }]}>{t('В корзине пока пусто')}</Text><Text style={[s.emptyCopy, { color: c.muted }]}>{t('Добавьте любимые блюда из меню ресторана.')}</Text><PrimaryButton label={t('Выбрать блюда')} onPress={onBack} /></View>}
    </View>
    {editingComment && <CommentEditor label={t('Комментарий ресторану')} value={restaurantComment} onClose={() => setEditingComment(false)} onSave={restaurantComment => { if (details && onDetails) onDetails({ ...details, restaurantComment }); else setLocalComment(restaurantComment); }} />}
  </SafeAreaView>;
}

export function CheckoutScreen({ restaurant, lines, carts, paymentMethods, details, onDetails, onBack, onSubmit, onChangeAddress, recipientPhone, busy, error }: {
  restaurant: FoodRestaurant; lines: CartLine[]; paymentMethods: FoodCatalog['paymentMethods']; details: CheckoutDetails;
  onDetails: (value: CheckoutDetails) => void; onBack: () => void; onSubmit: () => void; onChangeAddress?: () => void;
  recipientPhone?: string; busy: boolean; error: string;
  carts?: CheckoutCart[];
}) {
  const t = useFoodT();
  const c = useCheckoutColors();
  const insets = useSafeAreaInsets();
  const [editor, setEditor] = useState<'courier' | 'phone' | null>(null);
  const [totalExpanded, setTotalExpanded] = useState(false);
  const paymentList = useRef<ScrollView>(null);
  const checkoutCarts = carts?.length ? carts : [{ restaurantId: restaurant.id, restaurant, lines, restaurantComment: details.restaurantComment, cutleryCount: details.cutleryCount }];
  const totals = checkoutCarts.map(cart => cartSummary(cart.restaurant, cart.lines, 'DELIVERY'));
  const summary = totals.reduce((result, value) => ({ count: result.count + value.count, subtotal: result.subtotal + value.subtotal, deliveryFee: result.deliveryFee + value.deliveryFee, total: result.total + value.total, invalid: result.invalid || value.invalid }), { count: 0, subtotal: 0, deliveryFee: 0, total: 0, invalid: false });
  const addressValid = shortAddress(details.address).length >= 5;
  const paymentAvailable = paymentMethods.some(method => method.id === details.paymentMethod && method.available);
  const minimumReached = checkoutCarts.every((cart, index) => cart.restaurant && totals[index].subtotal >= cart.restaurant.minimumOrder);
  const closedRestaurants = checkoutCarts.filter(cart => cart.restaurant?.isOpen === false);
  const commentValid = checkoutCarts.every(cart => formatCheckoutComment({ ...details, restaurantComment: cart.restaurantComment, cutleryCount: cart.cutleryCount }).length <= 500);
  const phone = details.recipientPhone ?? recipientPhone ?? '';
  const methods = [
    { id: 'ONLINE' as const, name: 'QR', icon: 'qr-code-outline' as const },
    { id: 'CARD' as const, name: 'Картой', icon: 'card-outline' as const },
    { id: 'CASH' as const, name: 'Наличными', icon: 'cash-outline' as const },
  ];
  const detailFields = [
    { key: 'entrance' as const, label: 'Подъезд' }, { key: 'floor' as const, label: 'Этаж' },
    { key: 'apartment' as const, label: 'Квартира' }, { key: 'intercom' as const, label: 'Домофон' },
  ];
  return <SafeAreaView style={[s.screen, { backgroundColor: c.background }]} edges={['top', 'left', 'right']}>
    <View style={{ flex: 1 }} accessibilityElementsHidden={!!editor} importantForAccessibility={editor ? 'no-hide-descendants' : 'auto'}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" enabled={Platform.OS === 'ios'}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={s.checkoutContent}>
          <View style={[s.checkoutTopCard, { backgroundColor: c.surface }]}>
            <View style={s.checkoutHeader}>
              <FoodIconButton name="arrow-back" label={t('Назад')} onPress={onBack} disabled={busy} busy={busy} color={c.ink} />
            </View>
          </View>
          {checkoutCarts.length > 1 && <View style={[s.checkoutSection, { backgroundColor: c.surface }]}>{checkoutCarts.map((cart, index) => <View key={cart.restaurantId} style={s.batchRestaurantRow}><View style={{ flex: 1 }}><Text style={[s.restaurantName, { color: c.ink }]}>{cart.restaurant?.name || t('Меню обновляется')}</Text><Text style={[s.restaurantMeta, { color: c.muted }]}>{totals[index].count} {t('товаров')}{cart.restaurant ? ` · ${cart.restaurant.etaMin}–${cart.restaurant.etaMax} ${t('мин')}` : ''}</Text></View><Text style={[s.restaurantName, { color: c.ink }]}>{money(totals[index].total)}</Text></View>)}</View>}
          <View style={[s.checkoutSection, { backgroundColor: c.surface }]}>
            <Text style={[s.sectionTitle, { color: c.ink, marginBottom: 8 }]}>{t('Куда')}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Изменить адрес доставки')} disabled={busy || !onChangeAddress} onPress={onChangeAddress} style={s.detailRow}>
              <Icon name="home" size={23} color={c.ink} /><Text style={[s.detailText, { color: c.ink }]}>{shortAddress(details.address) || t('Укажите адрес')}</Text><Icon name="chevron-forward" size={21} color={c.ink} />
            </Pressable>
            <View style={[s.rowRule, { backgroundColor: c.line }]} />
            <View style={s.addressFields}>{detailFields.map(field => <TextInput key={field.key} accessibilityLabel={t(field.label)} editable={!busy} placeholder={t(field.label)} placeholderTextColor={c.muted} value={details[field.key] || ''} onChangeText={value => onDetails({ ...details, [field.key]: value })} maxLength={20} style={[s.addressField, { color: c.ink, borderBottomColor: c.line }]} />)}</View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Комментарий курьеру')} disabled={busy} onPress={() => setEditor('courier')} style={s.detailRow}>
              <Icon name="chatbubble-outline" size={23} color={c.muted} /><Text numberOfLines={2} style={[s.detailText, { color: details.comment ? c.ink : c.muted }]}>{details.comment || t('Комментарий курьеру')}</Text><Icon name="chevron-forward" size={21} color={c.ink} />
            </Pressable>
            <View style={[s.rowRule, { backgroundColor: c.line }]} />
            <Pressable accessibilityRole="button" accessibilityLabel={t('Телефон получателя')} disabled={busy} onPress={() => setEditor('phone')} style={s.detailRow}>
              <Icon name="call" size={22} color={c.ink} /><View style={{ flex: 1 }}><Text style={[s.phoneLabel, { color: c.muted }]}>{t('Телефон получателя')}</Text><Text style={[s.phoneValue, { color: c.ink }]}>{phone || t('Указать телефон')}</Text></View><Icon name="chevron-forward" size={21} color={c.ink} />
            </Pressable>
            <View style={[s.rowRule, { backgroundColor: c.line }]} />
            <View style={s.detailRow}><Icon name="exit" size={23} color={c.ink} /><Text style={[s.detailText, { color: c.ink }]}>{t('Оставить у двери')}</Text><FoodSwitch accessibilityLabel={t('Оставить у двери')} disabled={busy} value={!!details.leaveAtDoor} onValueChange={leaveAtDoor => onDetails({ ...details, leaveAtDoor })} /></View>
          </View>
          <View style={[s.paymentSection, { backgroundColor: c.surface }]}>
            <Text style={[s.sectionTitle, { color: c.ink, paddingHorizontal: 16, marginBottom: 8 }]}>{t('Оплата')}</Text>
            <View style={[s.paymentHint, { backgroundColor: c.soft }]}><Icon name="qr-code" size={29} color={c.green} /><View style={{ flex: 1 }}><Text style={[s.paymentHintTitle, { color: c.ink }]}>{t('Выберите способ оплаты')}</Text><Text style={[s.paymentHintCopy, { color: c.ink }]}>{t('Как вам удобно оплатить заказ')}</Text></View></View>
            <ScrollView ref={paymentList} horizontal showsHorizontalScrollIndicator={false} onContentSizeChange={() => paymentList.current?.scrollTo({ x: Math.max(0, methods.findIndex(method => method.id === details.paymentMethod)) * 140, animated: false })} contentContainerStyle={s.paymentList}>{methods.map(method => {
              const available = paymentMethods.some(item => item.id === method.id && item.available);
              const selected = method.id === details.paymentMethod;
              return <Pressable key={method.id} accessibilityRole="radio" accessibilityLabel={`${t(method.name)}${available ? '' : `, ${t('Пока недоступно')}`}`} accessibilityState={{ checked: selected, disabled: busy || !available }} disabled={busy || !available} onPress={() => onDetails({ ...details, paymentMethod: method.id })} style={[s.paymentCard, { backgroundColor: c.soft, borderColor: selected ? c.ink : 'transparent' }]}>
                <Icon name={method.icon} size={25} color={available ? c.ink : c.muted} />
                <View><Text style={[s.paymentLabel, { color: available ? c.ink : c.muted }]}>{t(method.name)}</Text>{!available && <Text style={[s.unavailableText, { color: c.muted }]}>{t('Пока недоступно')}</Text>}</View>
              </Pressable>;
            })}</ScrollView>
            {!minimumReached && checkoutCarts.filter((cart, index) => cart.restaurant && totals[index].subtotal < cart.restaurant.minimumOrder).map(cart => <Text key={cart.restaurantId} style={[s.errorText, s.checkoutError]}>{cart.restaurant!.name}: {t('Минимальный заказ')} — {money(cart.restaurant!.minimumOrder)}</Text>)}
            {closedRestaurants.map(cart => <Text key={cart.restaurantId} style={[s.errorText, s.checkoutError]}>{cart.restaurant!.name}: {t('Сейчас закрыто')}</Text>)}
            {!commentValid && <Text style={[s.errorText, s.checkoutError]}>{t('Сократите комментарии и детали адреса до 500 символов.')}</Text>}
            {!!error && <Text accessibilityRole="alert" style={[s.errorText, s.checkoutError]}>{error}</Text>}
          </View>
        </ScrollView>
        <View style={[s.checkoutFooter, { backgroundColor: c.surface, paddingBottom: Math.max(16, insets.bottom) }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Показать состав суммы')} accessibilityState={{ expanded: totalExpanded }} onPress={() => setTotalExpanded(!totalExpanded)} style={s.totalRow}><View style={s.inline}><Text style={[s.totalTitle, { color: c.ink }]}>{t('Всего')}</Text><Icon name={totalExpanded ? 'chevron-down-circle' : 'chevron-forward-circle'} size={18} color={c.ink} /></View><NumberTicker value={summary.total} format={money} style={[s.totalValue, { color: c.green }]} height={30} /></Pressable>
          {totalExpanded && <View style={s.totalBreakdown}><View style={s.breakdownRow}><Text style={[s.smallMuted, { color: c.muted }]}>{t('Товары')}</Text><Text style={[s.smallMuted, { color: c.ink }]}>{money(summary.subtotal)}</Text></View><View style={s.breakdownRow}><Text style={[s.smallMuted, { color: c.muted }]}>{t('Доставка')}</Text><Text style={[s.smallMuted, { color: c.ink }]}>{summary.deliveryFee ? money(summary.deliveryFee) : t('Бесплатно')}</Text></View></View>}
          <PrimaryButton label={details.paymentMethod === 'CASH' ? t('Заказать') : t('Оплатить')} onPress={onSubmit} busy={busy} disabled={!summary.count || summary.invalid || !addressValid || !paymentAvailable || !minimumReached || !commentValid || closedRestaurants.length > 0} />
        </View>
      </KeyboardAvoidingView>
    </View>
    {editor && <CommentEditor label={t(editor === 'phone' ? 'Телефон получателя' : 'Комментарий курьеру')} phone={editor === 'phone'} value={editor === 'phone' ? phone : details.comment} onClose={() => setEditor(null)} onSave={value => onDetails({ ...details, ...(editor === 'phone' ? { recipientPhone: value } : { comment: value }) })} />}
  </SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  headerTitle: { position: 'absolute', left: 98, right: 98, textAlign: 'center', fontFamily: fonts.regular, fontSize: 16 },
  singleRestaurantHeader: { flex: 1, minHeight: 52, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 6, gap: 1 },
  singleRestaurantNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, maxWidth: '100%' },
  singleRestaurantName: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  singleRestaurantMeta: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  oldSubtotal: { textDecorationLine: 'line-through' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  cartTopCard: { paddingHorizontal: 16, paddingTop: 3, paddingBottom: 10, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  restaurantChip: { alignSelf: 'flex-start', maxWidth: '100%', borderWidth: 1.7, borderRadius: 17, paddingHorizontal: 11, paddingVertical: 9, marginBottom: 12 },
  restaurantTabs: { gap: 8, paddingRight: 16 },
  batchRestaurantRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  restaurantName: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  restaurantMeta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  cartRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, minHeight: 82 },
  cartImage: { width: 66, height: 66, borderRadius: 15 },
  cartItemCopy: { flex: 1, gap: 4 },
  itemName: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 17 },
  cartItemPrice: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17 },
  smallMuted: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  stepper: { height: 34, flexDirection: 'row', alignItems: 'center', borderRadius: 12 },
  stepButton: { width: 31, height: 40, alignItems: 'center', justifyContent: 'center' },
  quantity: { minWidth: 20, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 13 },
  cartOptions: { marginTop: 4, paddingHorizontal: 16, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 24 },
  cutleryControl: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 17, paddingLeft: 12, paddingRight: 2, minHeight: 48 },
  verticalRule: { width: 1, height: 25 },
  restaurantComment: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, minHeight: 48, borderRadius: 17 },
  commentLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 11, lineHeight: 15 },
  recommendationSection: { marginTop: 4, borderRadius: 24, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 20 },
  sectionTitle: { fontFamily: 'FoodDisplayBold', fontSize: 25, lineHeight: 31, letterSpacing: -.5, marginBottom: 14 },
  recommendationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, rowGap: 22 },
  recommendationCard: { paddingBottom: 4 },
  recommendationImage: { borderRadius: 20 },
  recommendationAdd: { position: 'absolute', bottom: 6, right: 6, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  recommendationPrice: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 20, marginTop: 8, paddingHorizontal: 4 },
  recommendationOldPrice: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textDecorationLine: 'line-through', paddingHorizontal: 4 },
  discountBadge: { position: 'absolute', top: 9, left: 9, borderRadius: 7, paddingHorizontal: 6, paddingVertical: 3 },
  discountLabel: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  recommendationRating: { flexDirection: 'row', alignItems: 'center', gap: 3, marginHorizontal: 4, marginTop: 3 },
  recommendationRatingText: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 15 },
  recommendationName: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 15, paddingHorizontal: 4, marginTop: 2 },
  recommendationPortion: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, paddingHorizontal: 4, marginTop: 2 },
  emptyRecommendations: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20, paddingVertical: 20 },
  search: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, fontFamily: fonts.regular, fontSize: 15, marginBottom: 14 },
  checkoutFloating: { position: 'absolute', right: 12, minWidth: 130 },
  primaryButton: { minHeight: 54, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 22, paddingVertical: 13 },
  buttonLabel: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  deliveryFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', paddingTop: 9, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: 6 },
  deliveryPill: { borderRadius: 18, paddingHorizontal: 9, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  deliveryPillText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 13 },
  deliveryCaption: { fontFamily: fonts.regular, fontSize: 12 },
  errorText: { color: '#C74747', fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  cartError: { paddingHorizontal: 18, paddingVertical: 10 },
  empty: { flex: 1, padding: 28, justifyContent: 'center', gap: 20, alignItems: 'center' },
  emptyTitle: { fontFamily: fonts.bold, fontSize: 23, textAlign: 'center' },
  emptyCopy: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  commentSheet: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 10 },
  commentInput: { minHeight: 52, height: 52, outlineWidth: 0, borderBottomWidth: 2, paddingTop: 10, paddingBottom: 13, paddingHorizontal: 0, marginBottom: 20, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22 },
  checkoutContent: { gap: 4, paddingBottom: 8 },
  checkoutTopCard: { borderRadius: 24 },
  checkoutHeader: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 },
  checkoutSection: { borderRadius: 24, paddingHorizontal: 16, paddingTop: 13, paddingBottom: 6 },
  detailRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 17, paddingVertical: 7 },
  detailText: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  rowRule: { height: StyleSheet.hairlineWidth, marginLeft: 40 },
  addressFields: { flexDirection: 'row', flexWrap: 'wrap', columnGap: '4%' },
  addressField: { width: '48%', minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 11, paddingHorizontal: 0, fontFamily: fonts.regular, fontSize: 15 },
  phoneLabel: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  phoneValue: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  paymentSection: { borderRadius: 24, paddingTop: 13, paddingBottom: 12 },
  paymentHint: { marginHorizontal: 16, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 17, marginBottom: 13 },
  paymentHintTitle: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 17 },
  paymentHintCopy: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  paymentList: { paddingHorizontal: 12, gap: 8 },
  paymentCard: { width: 132, minHeight: 84, justifyContent: 'space-between', padding: 10, borderRadius: 17, borderWidth: 1.7 },
  paymentLabel: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  unavailableText: { fontFamily: fonts.regular, fontSize: 10, marginTop: 2 },
  checkoutError: { marginTop: 10, paddingHorizontal: 16 },
  checkoutFooter: { paddingHorizontal: 12, paddingTop: 9, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: 9 },
  totalTitle: { fontFamily: 'FoodDisplayBold', fontSize: 25, letterSpacing: -.4 },
  totalValue: { fontFamily: fonts.bold, fontSize: 21, letterSpacing: -.6 },
  totalBreakdown: { paddingHorizontal: 4, marginBottom: 12, gap: 5 },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
