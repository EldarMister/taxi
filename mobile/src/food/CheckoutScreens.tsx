import React, { useState } from 'react';
import { Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui';
import { BottomPanel } from '../BottomPanel';
import { Reveal, SpringPressable } from '../design/motion';
import { palette, radii } from '../design/tokens';
import { fonts } from '../design/typography';
import { FoodButton, FoodHeader, FoodIconButton, foodColors as c, money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { useTheme } from '../design/theme';
import { foodImage } from './assets';
import { cartLineKey, cartSummary, MAX_FOOD_QUANTITY } from './cart';
import { NumberTicker } from './NumberTicker';
import type { CartLine, FoodCatalog, FoodPaymentMethod, FoodRestaurant } from './types';
import { useFoodT } from './i18n';
import { shortAddress } from '../address';

export function CartScreen({ restaurant, lines, onBack, onClear, onQuantity, onRemoveOption, onCheckout, onAddRecommendation }: {
  restaurant?: FoodRestaurant; lines: CartLine[]; onBack: () => void; onClear: () => void;
  onQuantity: (key: string, quantity: number) => void; onRemoveOption: (id: string) => void; onCheckout: () => void; onAddRecommendation?: (dish: FoodRestaurant['dishes'][number]) => void;
}) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const summary = cartSummary(restaurant, lines);
  const missing = lines.filter(line => !summary.items.some(item => cartLineKey(item) === cartLineKey(line)));
  const recommendations = restaurant?.dishes.filter(dish => dish.available && !lines.some(line => line.dishId === dish.id)).slice(0, 8) || [];
  const maxContentHeight = Math.max(160, height - insets.top - insets.bottom - 250);
  const estimatedContentHeight = 28 + summary.items.length * 160 + missing.length * 86 + (recommendations.length ? 245 : 0);
  return <View style={s.cartHost}>
    <BottomPanel label={t('Закрыть корзину')} onClose={onBack}>
      <View style={s.cartSheet}>
        <View style={s.cartHeading}><Text style={s.cartTitle}>{t('Корзина')}</Text>{!!lines.length && <FoodIconButton name="trash-outline" label={t('Очистить корзину')} onPress={onClear} backgroundColor={c.surface} />}</View>
        {lines.length ? <>
          <ScrollView showsVerticalScrollIndicator={false} style={{ height: Math.min(maxContentHeight, contentHeight ?? estimatedContentHeight) }} onContentSizeChange={(_width, measuredHeight) => setContentHeight(current => current !== null && Math.abs(current - measuredHeight) < 1 ? current : measuredHeight)} contentContainerStyle={s.cartContents}>
            <Text style={s.cartRestaurantLabel}>{restaurant?.name || t('Меню обновляется')}</Text>
            {summary.items.map(item => <View key={cartLineKey(item)} style={s.cartRow}>
              <View style={s.cartItemTop}>
                <Image source={foodImage(item.dish.id, item.dish.imageUrl, item.dish.imageKey)} style={s.cartImage} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={s.itemName}>{item.dish.name}</Text>
                  <Text style={s.muted} numberOfLines={2}>{item.options.length ? item.options.map(option => option.name).join(' · ') : item.dish.portion}</Text>
                  {!item.dish.available && <Text style={s.errorText}>{t('Нет в наличии')}</Text>}
                </View>
              </View>
              <View style={s.cartItemBottom}>
                <NumberTicker value={item.total} format={money} style={s.lineTotal} height={24} />
                <View accessibilityRole="adjustable" accessibilityLabel={`Количество ${item.dish.name}: ${item.quantity}`} style={s.stepper}>
                  <Pressable accessibilityRole="button" accessibilityLabel={item.quantity === 1 ? `Удалить ${item.dish.name} из корзины` : `Уменьшить ${item.dish.name}`} onPress={() => onQuantity(cartLineKey(item), item.quantity - 1)} style={s.stepButton}><Icon name="remove" size={21} color={c.blue} /></Pressable>
                  <NumberTicker value={item.quantity} style={s.quantity} height={22} accessibilityLabel={`${item.quantity} порций`} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`Увеличить ${item.dish.name}`} accessibilityState={{ disabled: item.quantity >= MAX_FOOD_QUANTITY || !item.dish.available }} disabled={item.quantity >= MAX_FOOD_QUANTITY || !item.dish.available} onPress={() => onQuantity(cartLineKey(item), item.quantity + 1)} style={s.stepButton}><Icon name="add" size={22} color={item.quantity >= MAX_FOOD_QUANTITY ? c.muted : c.blue} /></Pressable>
                </View>
              </View>
            </View>)}
            {missing.map(line => <View key={cartLineKey(line)} style={s.cartRow}><Text style={s.errorText}>{t('Блюдо больше недоступно')}</Text><Pressable accessibilityRole="button" onPress={() => onQuantity(cartLineKey(line), 0)}><Text style={s.removeText}>{t('Удалить')}</Text></Pressable></View>)}
            {!!recommendations.length && <View style={s.recommendations}><Text style={s.sectionTitle}>{t('Добавить к заказу')}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.recommendationList}>{recommendations.map(dish => <View key={dish.id} style={s.recommendationCard}><Image source={foodImage(dish.id, dish.imageUrl, dish.imageKey)} style={s.recommendationImage}/><Text numberOfLines={2} style={s.itemName}>{dish.name}</Text><View style={s.recommendationBottom}><Text style={s.itemPrice}>{money(dish.price)}</Text><FoodIconButton name="add" label={`${t('Добавить')} ${dish.name}`} onPress={() => onAddRecommendation?.(dish)} color={c.ink} backgroundColor={theme.isDark ? theme.palette.elevated : '#FFFFFF'} style={s.recommendationAdd} /></View></View>)}</ScrollView></View>}
          </ScrollView>
          <View style={s.footer}>
            <View style={s.totalRow}><Text style={s.muted}>{t('Товары')}</Text><NumberTicker value={summary.subtotal} format={money} style={s.itemPrice} height={21} /></View>
            <View style={s.totalRow}><Text style={s.muted}>{t('Доставка')}</Text>{summary.deliveryFee
              ? <NumberTicker value={summary.deliveryFee} format={money} style={s.muted} height={20} />
              : <Text style={s.muted}>{t('Бесплатно')}</Text>}</View>
            {summary.invalid && <Text style={s.errorText}>{t('Состав меню изменился. Уберите недоступные блюда.')}</Text>}
            {!!restaurant && summary.subtotal < restaurant.minimumOrder && <Text style={s.errorText}>{t('Минимальный заказ')} — {money(restaurant.minimumOrder)}</Text>}
            <SpringPressable accessibilityRole="button" accessibilityLabel={`${money(summary.total)} · ${t('К оформлению')}`} accessibilityState={{ disabled: summary.invalid || !summary.count || !restaurant || summary.subtotal < restaurant.minimumOrder }} disabled={summary.invalid || !summary.count || !restaurant || summary.subtotal < restaurant.minimumOrder} onPress={onCheckout} pressScale={.985} style={[s.checkoutButton, { backgroundColor: theme.palette.accent }]}>
              <NumberTicker value={summary.total} format={money} style={[s.checkoutButtonText, { color: theme.palette.accentText }]} height={23} />
              <Text style={[s.checkoutButtonText, { color: theme.palette.accentText }]}>· {t('К оформлению')}</Text>
            </SpringPressable>
          </View>
        </> : <View style={s.empty}><Icon name="bag-handle-outline" size={66} color={c.blue} /><Text style={s.emptyTitle}>{t('В корзине пока пусто')}</Text><Text style={[s.muted, { textAlign: 'center' }]}>{t('Добавьте любимые блюда из меню ресторана.')}</Text><FoodButton label={t('Выбрать блюда')} onPress={onBack} style={{ alignSelf: 'stretch', marginTop: 15 }} /></View>}
      </View>
    </BottomPanel>
  </View>;
}

export type CheckoutDetails = { fulfillment: 'DELIVERY'; address: string; comment: string; paymentMethod: FoodPaymentMethod };
export function CheckoutScreen({ restaurant, lines, paymentMethods, details, onDetails, onBack, onSubmit, busy, error }: {
  restaurant: FoodRestaurant; lines: CartLine[]; paymentMethods: FoodCatalog['paymentMethods']; details: CheckoutDetails;
  onDetails: (value: CheckoutDetails) => void; onBack: () => void; onSubmit: () => void; busy: boolean; error: string;
}) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [editingAddress, setEditingAddress] = useState(false);
  const [closingAddress, setClosingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState(details.address);
  const closeAddress = () => { Keyboard.dismiss(); setClosingAddress(true); };
  const summary = cartSummary(restaurant, lines, 'DELIVERY');
  const addressValid = shortAddress(details.address).length >= 5;
  const methods = [
    { id: 'CASH' as const, name: 'Наличными курьеру', icon: 'cash-outline' as const },
    { id: 'CARD' as const, name: 'Оплата картой', icon: 'card-outline' as const },
    { id: 'ONLINE' as const, name: 'Онлайн оплата', icon: 'wallet-outline' as const },
  ];
  const paymentAvailable = paymentMethods.some(method => method.id === details.paymentMethod && method.available);
  const minimumReached = summary.subtotal >= restaurant.minimumOrder;
  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <View accessibilityElementsHidden={editingAddress} importantForAccessibility={editingAddress ? 'no-hide-descendants' : 'auto'} style={{ flex: 1 }}>
    <Reveal style={{ flex: 1 }}><KeyboardAvoidingView behavior="padding" enabled={Platform.OS === 'ios'} style={{ flex: 1 }}>
      <FoodHeader title={t('Оформление заказа')} onBack={onBack} backDisabled={busy} backBusy={busy} />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: 20 }}>
        <Text style={[s.sectionTitle, { marginTop: 8 }]}>{t('Адрес доставки')}</Text>
        <View style={s.addressCard}>
          <Icon name="location" size={29} color={c.blue} />
          <View style={{ flex: 1 }}><Text style={{ color: c.ink, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 }}>{shortAddress(details.address) || t('Укажите адрес')}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Изменить адрес доставки')} disabled={busy} onPress={() => { setAddressDraft(shortAddress(details.address)); setEditingAddress(true); }} style={s.changeAddress}><Text style={{ color: c.blue, fontFamily: fonts.semibold, fontSize: 14 }}>{t('Изменить')}</Text></Pressable>
        </View>
        <Text style={s.sectionTitle}>{t('Комментарий')}</Text>
        <TextInput accessibilityLabel={t('Комментарий к заказу')} editable={!busy} value={details.comment} onChangeText={comment => onDetails({ ...details, comment })} maxLength={500} multiline placeholder={t('Например: домофон, подъезд, этаж')} placeholderTextColor={theme.isDark ? theme.palette.muted : '#7C879F'} style={s.comment} textAlignVertical="top" />
        <Text style={s.sectionTitle}>{t('Способ оплаты')}</Text>
        {methods.map(method => {
          const available = paymentMethods.some(item => item.id === method.id && item.available);
          const selected = method.id === details.paymentMethod;
          return <Pressable key={method.id} accessibilityRole="radio" accessibilityLabel={`${method.name}${available ? '' : ', пока недоступно'}`} accessibilityState={{ checked: selected, disabled: busy || !available }} disabled={busy || !available} onPress={() => onDetails({ ...details, paymentMethod: method.id })} style={[s.payment, selected && { backgroundColor: theme.isDark ? theme.palette.elevated : '#F5F8FD', borderRadius: 14 }]}>
            <Icon name={method.icon} size={26} color={c.ink} /><View style={{ flex: 1 }}><Text style={s.paymentLabel}>{t(method.name)}</Text>{!available && <Text style={{ color: c.muted, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 }}>{t('Пока недоступно')}</Text>}</View><Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={28} color={selected ? c.blue : '#B7BFD0'} />
          </Pressable>;
        })}
        {!minimumReached && <Text style={[s.errorText, { marginTop: 12 }]}>{t('Минимальный заказ')} — {money(restaurant.minimumOrder)}</Text>}
        {!!error && <Text accessibilityRole="alert" style={[s.errorText, { marginTop: 14 }]}>{error}</Text>}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
        {!!summary.deliveryFee && <Text style={{ color: c.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', marginBottom: 10 }}>{t('Включая доставку')} {money(summary.deliveryFee)}</Text>}
        <FoodButton label={`${t('Заказать')} · ${money(summary.total)}`} onPress={onSubmit} busy={busy} disabled={!summary.count || summary.invalid || !addressValid || !paymentAvailable || !minimumReached} />
      </View>
    </KeyboardAvoidingView></Reveal>
    </View>
    {editingAddress && <BottomPanel closeRequested={closingAddress} onClose={() => { Keyboard.dismiss(); setEditingAddress(false); setClosingAddress(false); }} label={t('Закрыть адрес')}>
        <View style={[s.addressSheet, { paddingBottom: Math.max(22, insets.bottom) }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={s.sectionTitle}>{t('Адрес доставки')}</Text><FoodIconButton name="close" label={t('Закрыть')} onPress={closeAddress} /></View>
          <TextInput autoFocus accessibilityLabel={t('Улица и номер дома')} placeholder={t('Улица, дом, квартира, город')} placeholderTextColor={c.muted} value={addressDraft} onChangeText={setAddressDraft} maxLength={300} style={s.addressInput} returnKeyType="done" onSubmitEditing={() => { if (shortAddress(addressDraft).length >= 5) { onDetails({ ...details, address: shortAddress(addressDraft) }); closeAddress(); } }} />
          <FoodButton label={t('Сохранить адрес')} disabled={shortAddress(addressDraft).length < 5} onPress={() => { onDetails({ ...details, address: shortAddress(addressDraft) }); closeAddress(); }} />
        </View>
    </BottomPanel>}
  </SafeAreaView>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  cartHost: { flex: 1 },
  cartSheet: { minHeight: 0 },
  cartHeading: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cartTitle: { color: c.ink, fontFamily: fonts.bold, fontSize: 28, letterSpacing: -.7 },
  cartContents: { paddingHorizontal: 18, paddingBottom: 26 },
  recommendations: { marginTop: 4 },
  recommendationList: { gap: 10, paddingBottom: 5 },
  recommendationCard: { width: 150, padding: 9, gap: 6, borderRadius: radii.large, backgroundColor: c.white },
  recommendationImage: { width: '100%', height: 102, borderRadius: radii.medium, backgroundColor: c.surface },
  recommendationBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recommendationAdd: { backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  removeText: { color: c.blue, fontFamily: fonts.semibold, marginTop: 8 },
  cartRestaurant: { minHeight: 66, marginBottom: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: radii.large, backgroundColor: palette.blueSoft, borderWidth: 1, borderColor: '#CFE3FF' },
  cartRestaurantIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: c.white },
  cartRestaurantLabel: { color: c.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  cartRestaurantName: { color: c.ink, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  cartRow: { marginBottom: 0, paddingVertical: 16, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
  cartItemTop: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartItemBottom: { minHeight: 46, paddingTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  extraRow: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartImage: { width: 70, height: 70, borderRadius: radii.medium, backgroundColor: palette.surface },
  itemName: { color: c.ink, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -.2 },
  muted: { color: c.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  itemPrice: { marginTop: 3, color: c.ink, fontFamily: fonts.medium, fontSize: 15 },
  stepper: { height: 42, flexDirection: 'row', alignItems: 'center' },
  stepButton: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  quantity: { minWidth: 30, textAlign: 'center', color: c.ink, fontFamily: fonts.bold, fontSize: 17 },
  lineTotal: { color: c.ink, fontFamily: fonts.bold, fontSize: 18 },
  optionCount: { padding: 10, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radii.small, backgroundColor: c.surface },
  footer: { paddingTop: 14, paddingHorizontal: 20, paddingBottom: 8, backgroundColor: 'white', borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.line },
  checkoutButton: { minHeight: 58, borderRadius: radii.medium, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: c.blue },
  checkoutButtonText: { color: c.white, fontFamily: fonts.bold, fontSize: 17, lineHeight: 23 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  total: { color: c.ink, fontFamily: fonts.bold, fontSize: 23, letterSpacing: -.5 },
  empty: { minHeight: 220, padding: 30, alignItems: 'center', justifyContent: 'center', gap: 14 },
  emptyTitle: { color: c.ink, fontFamily: fonts.bold, fontSize: 23, textAlign: 'center' },
  sectionTitle: { marginTop: 24, marginBottom: 10, color: c.ink, fontFamily: fonts.bold, fontSize: 19, lineHeight: 25, letterSpacing: -.3 },
  addressCard: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radii.large, backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  changeAddress: { backgroundColor: palette.blueSoft, borderRadius: radii.small, paddingHorizontal: 13, paddingVertical: 12 },
  comment: { minHeight: 82, padding: 16, borderRadius: radii.large, backgroundColor: c.white, borderWidth: 1, borderColor: palette.line, color: c.ink, fontFamily: fonts.regular, fontSize: 16, lineHeight: 23 },
  payment: { flexDirection: 'row', alignItems: 'center', gap: 17, paddingHorizontal: 20, minHeight: 62, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
  paymentLabel: { color: c.ink, fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  errorText: { color: palette.danger, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000066' },
  addressSheet: { paddingHorizontal: 22, paddingTop: 8, backgroundColor: 'white', borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero },
  addressInput: { minHeight: 56, marginBottom: 20, padding: 15, borderRadius: radii.medium, backgroundColor: c.surface, color: c.ink, fontFamily: fonts.regular, fontSize: 16 },
});
