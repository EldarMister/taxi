import React, { useState } from 'react';
import { Alert, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui';
import { BottomPanel } from '../BottomPanel';
import { Reveal } from '../design/motion';
import { palette, radii } from '../design/tokens';
import { fonts } from '../design/typography';
import { FoodButton, FoodHeader, FoodIconButton, foodColors as c, money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { useTheme } from '../design/theme';
import { foodImage } from './assets';
import { cartLineKey, cartSummary, MAX_FOOD_QUANTITY } from './cart';
import type { CartLine, FoodCatalog, FoodPaymentMethod, FoodRestaurant } from './types';
import { useFoodT } from './i18n';

export function CartScreen({ restaurant, lines, onBack, onClear, onQuantity, onRemoveOption, onCheckout }: {
  restaurant?: FoodRestaurant; lines: CartLine[]; onBack: () => void; onClear: () => void;
  onQuantity: (key: string, quantity: number) => void; onRemoveOption: (id: string) => void; onCheckout: () => void;
}) {
  const t = useFoodT();
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const insets = useSafeAreaInsets();
  const summary = cartSummary(restaurant, lines);
  const extras = restaurant?.options.flatMap(option => {
    const quantity = lines.reduce((count, line) => count + (line.optionIds.includes(option.id) ? line.quantity : 0), 0);
    return quantity ? [{ ...option, quantity }] : [];
  }) || [];
  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <Reveal style={{ flex: 1 }}>
    <FoodHeader title={t('Корзина')} onBack={onBack} right={lines.length ? <FoodIconButton name="trash-outline" label={t('Очистить корзину')} onPress={onClear} /> : undefined} />
    {summary.count ? <>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: 24 }}>
        <View style={s.cartRestaurant}>
          <View style={s.cartRestaurantIcon}><Icon name="restaurant-outline" size={23} color={c.blue} /></View>
          <View style={{ flex: 1 }}><Text style={s.cartRestaurantLabel}>{t('Заказ из ресторана')}</Text><Text numberOfLines={1} style={s.cartRestaurantName}>{restaurant?.name}</Text></View>
        </View>
        {summary.items.map(item => <View key={cartLineKey(item)} style={s.cartRow}>
          <View style={s.cartItemTop}>
            <Image source={foodImage(item.dish.id, item.dish.imageUrl, item.dish.imageKey)} style={s.cartImage} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.itemName}>{item.dish.name}</Text>
              <Text style={s.muted}>{item.dish.portion}</Text>
              <Text style={s.itemPrice}>{money(item.dish.price)} {t('за шт.')}</Text>
              {!item.dish.available && <Text style={s.errorText}>{t('Нет в наличии')}</Text>}
            </View>
          </View>
          <View style={s.cartItemBottom}>
            <View accessibilityRole="adjustable" accessibilityLabel={`Количество ${item.dish.name}: ${item.quantity}`} style={s.stepper}>
              <Pressable accessibilityRole="button" accessibilityLabel={item.quantity === 1 ? `Удалить ${item.dish.name} из корзины` : `Уменьшить ${item.dish.name}`} onPress={() => onQuantity(cartLineKey(item), item.quantity - 1)} style={s.stepButton}><Icon name={item.quantity === 1 ? 'trash-outline' : 'remove'} size={21} color={item.quantity === 1 ? palette.danger : c.blue} /></Pressable>
              <Text accessibilityLiveRegion="polite" style={s.quantity}>{item.quantity}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Увеличить ${item.dish.name}`} accessibilityState={{ disabled: item.quantity >= MAX_FOOD_QUANTITY }} disabled={item.quantity >= MAX_FOOD_QUANTITY} onPress={() => onQuantity(cartLineKey(item), item.quantity + 1)} style={s.stepButton}><Icon name="add" size={22} color={item.quantity >= MAX_FOOD_QUANTITY ? c.muted : c.blue} /></Pressable>
            </View>
            <Text style={s.lineTotal}>{money(item.dish.price * item.quantity)}</Text>
          </View>
        </View>)}
        {extras.map(option => <View key={option.id} style={[s.cartRow, s.extraRow]}>
          {option.id === 'wasabi' && !option.imageUrl ? <View style={[s.cartImage, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#EEF4E8' }]}><Icon name="leaf" color="#7C9B35" size={40} /></View> : <Image source={foodImage(option.imageKey, option.imageUrl)} style={s.cartImage} />}
          <View style={{ flex: 1, gap: 3 }}><Text style={s.itemName}>{option.name}</Text><Text style={s.muted}>1 {t('порция')}</Text><Text style={s.itemPrice}>{money(option.price * option.quantity)}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${option.name}: ${option.quantity} ${t('порций')}. ${t('Изменить')}`} onPress={() => Alert.alert(option.name, `${option.quantity} ${t('порций')} — ${t('по одной к каждой порции блюда')}.`, [{ text: t('Оставить'), style: 'cancel' }, { text: t('Убрать'), onPress: () => onRemoveOption(option.id) }])} style={s.optionCount}>
            <Text style={s.muted}>{option.quantity} {t('шт.')}</Text><Icon name="chevron-down" size={13} color={c.muted} />
          </Pressable>
        </View>)}
      </ScrollView>
      <View style={[s.footer, { paddingBottom: Math.max(18, insets.bottom + 10) }]}>
        {!!summary.deliveryFee && <View style={[s.totalRow, { marginBottom: 12 }]}><Text style={s.muted}>{t('Доставка')}</Text><Text style={s.muted}>{money(summary.deliveryFee)}</Text></View>}
        <View style={s.totalRow}><Text style={s.total}>{t('Итого')}</Text><Text style={s.total}>{money(summary.total)}</Text></View>
        {summary.invalid && <Text style={[s.errorText, { marginBottom: 12 }]}>{t('Состав меню изменился. Уберите недоступные блюда.')}</Text>}
        <FoodButton label={t('Оформить заказ')} onPress={onCheckout} disabled={summary.invalid} />
      </View>
    </> : <View style={s.empty}>
      <Icon name="bag-handle-outline" size={66} color={c.blue} /><Text style={s.emptyTitle}>{t(lines.length ? 'Меню изменилось' : 'В корзине пока пусто')}</Text><Text style={[s.muted, { textAlign: 'center' }]}>{t(lines.length ? 'Сохранённые блюда больше недоступны. Очистите корзину и выберите другие.' : 'Добавьте любимые блюда из меню ресторана.')}</Text><FoodButton label={t(lines.length ? 'Очистить корзину' : 'Выбрать блюда')} onPress={lines.length ? onClear : onBack} style={{ alignSelf: 'stretch', marginTop: 15 }} />
    </View>}
    </Reveal>
  </SafeAreaView>;
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
  const addressValid = details.address.trim().length >= 5;
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
          <View style={{ flex: 1 }}><Text style={{ color: c.ink, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 }}>{details.address || t('Укажите адрес')}</Text><Text style={s.muted}>Кочкор-Ата</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Изменить адрес доставки')} disabled={busy} onPress={() => { setAddressDraft(details.address); setEditingAddress(true); }} style={s.changeAddress}><Text style={{ color: c.blue, fontFamily: fonts.semibold, fontSize: 14 }}>{t('Изменить')}</Text></Pressable>
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
          <Text style={[s.muted, { marginBottom: 12 }]}>Кочкор-Ата</Text>
          <TextInput autoFocus accessibilityLabel={t('Улица и номер дома')} placeholder={t('Улица и номер дома')} placeholderTextColor={c.muted} value={addressDraft} onChangeText={setAddressDraft} maxLength={300} style={s.addressInput} returnKeyType="done" onSubmitEditing={() => { if (addressDraft.trim().length >= 5) { onDetails({ ...details, address: addressDraft.trim() }); closeAddress(); } }} />
          <FoodButton label={t('Сохранить адрес')} disabled={addressDraft.trim().length < 5} onPress={() => { onDetails({ ...details, address: addressDraft.trim() }); closeAddress(); }} />
        </View>
    </BottomPanel>}
  </SafeAreaView>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  cartRestaurant: { minHeight: 66, marginBottom: 14, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: radii.large, backgroundColor: palette.blueSoft, borderWidth: 1, borderColor: '#CFE3FF' },
  cartRestaurantIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: c.white },
  cartRestaurantLabel: { color: c.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  cartRestaurantName: { color: c.ink, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  cartRow: { marginBottom: 12, padding: 13, gap: 12, borderRadius: radii.large, backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  cartItemTop: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartItemBottom: { minHeight: 46, paddingTop: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  extraRow: { minHeight: 104, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cartImage: { width: 88, height: 88, borderRadius: radii.medium, backgroundColor: palette.surface },
  itemName: { color: c.ink, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, letterSpacing: -.2 },
  muted: { color: c.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  itemPrice: { marginTop: 3, color: c.ink, fontFamily: fonts.medium, fontSize: 15 },
  stepper: { height: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: palette.blueSoft, borderRadius: 14, borderWidth: 1, borderColor: '#D4E7FF' },
  stepButton: { width: 46, height: 44, alignItems: 'center', justifyContent: 'center' },
  quantity: { minWidth: 30, textAlign: 'center', color: c.ink, fontFamily: fonts.bold, fontSize: 17 },
  lineTotal: { color: c.ink, fontFamily: fonts.bold, fontSize: 18 },
  optionCount: { padding: 10, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: radii.small, backgroundColor: c.surface },
  footer: { paddingTop: 17, paddingHorizontal: 20, backgroundColor: 'white', borderTopLeftRadius: radii.hero, borderTopRightRadius: radii.hero, shadowColor: '#27313F', shadowOpacity: .09, shadowRadius: 22, shadowOffset: { width: 0, height: -8 }, elevation: 6 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  total: { color: c.ink, fontFamily: fonts.bold, fontSize: 23, letterSpacing: -.5 },
  empty: { flex: 1, padding: 30, alignItems: 'center', justifyContent: 'center', gap: 14 },
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
