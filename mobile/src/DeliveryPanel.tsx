import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel, panelStyle } from './BottomPanel';
import { useTheme } from './design/theme';
import type { Language, Point, Quote, Tariff } from './types';
import { colors, Icon, PickupIcon, money, shortAddress, ToggleSwitch, tr } from './ui';

export type DeliveryDetails = {
  comment: string;
  doorToDoor: boolean;
  scheduled: boolean;
};
export const emptyDeliveryDetails: DeliveryDetails = { comment: '', doorToDoor: false, scheduled: false };

type Props = {
  language?: Language;
  pickup: Point | null; dropoff: Point | null; tariffs: Tariff[]; selectedKind: 'DELIVERY_CAR' | 'DELIVERY_TRUCK';
  quote: Quote | null; previewQuote?: Quote | null; quotes: Record<string, Quote>; calculating: boolean; error?: string; busy: boolean;
  details: DeliveryDetails; onDetails: (value: DeliveryDetails) => void; onKind: (kind: 'DELIVERY_CAR' | 'DELIVERY_TRUCK') => void;
  onAddress: (field: 'pickup' | 'dropoff') => void; onSwap: () => void; onBook: () => void; onHeight: (height: number) => void; hidden?: boolean;
};

export function DeliveryPanel({ language = 'ru', pickup, dropoff, tariffs, selectedKind, quote, previewQuote, quotes, calculating, error, busy, details, onDetails, onKind, onAddress, onSwap, onBook, onHeight, hidden }: Props) {
  const t = tr(language);
  const { isDark, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [surface, setSurface] = useState<'details' | 'payment' | null>(null);
  const [paymentReturn, setPaymentReturn] = useState<'details' | null>(null);
  const selected = tariffs.find(item => item.kind === selectedKind);
  const ready = !!pickup && !!dropoff;
  const shownQuote = quote ?? previewQuote;
  const open = () => setSurface('details');
  const openPayment = () => { setPaymentReturn(surface === 'details' ? 'details' : null); setSurface('payment'); };
  const closePayment = () => setSurface(paymentReturn);
  const pull = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy < -7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => { if (gesture.dy < -24 || gesture.vy < -.3) open(); },
  }), []);
  const footer = (inside = false) => <View style={d.footer}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Способы оплаты')} disabled={busy} onPress={openPayment} style={d.cash}><Icon name="cash-outline" color={colors.blue} size={29}/></Pressable>
    <Pressable accessibilityRole="button" disabled={busy || (ready && !quote)} onPress={!ready ? () => onAddress(dropoff ? 'pickup' : 'dropoff') : onBook} style={({ pressed }) => [d.primary, (pressed || busy || (ready && !quote)) && { opacity: .6 }]}>{(busy || (ready && !quote && calculating)) && <ActivityIndicator size="small" color="#FFFFFF"/>}<Text style={d.primaryText}>{t(!ready ? 'Указать адреса' : quote ? 'Заказать доставку' : error ? 'Повторим автоматически' : shownQuote ? 'Обновляем цену…' : 'Считаем…')}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t(inside ? 'Свернуть параметры' : 'Параметры доставки')} onPress={inside ? () => setSurface(null) : open} style={d.parameters}><Icon name={inside ? 'chevron-down' : 'options-outline'} color={palette.ink} size={26}/></Pressable>
  </View>;
  if (hidden) return null;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
    <View accessibilityElementsHidden={surface !== null} importantForAccessibility={surface !== null ? 'no-hide-descendants' : 'auto'} onLayout={event => onHeight(event.nativeEvent.layout.height)} {...pull.panHandlers} style={[panelStyle.surface, d.panel, isDark && { backgroundColor: palette.surface, shadowColor: palette.background }, { paddingBottom: Math.max(insets.bottom, 11) }]}>
      <View style={d.titleRow}><View style={d.deliveryMark}><Icon name="cube" color="#FFFFFF" size={22}/></View><Text style={[d.title, { color: palette.ink }]}>{t('Доставка')}</Text></View>
      <AddressRow language={language} label={t('Адрес отправки')} value={pickup?.address || t('Определяем местоположение')} pickup onPress={() => onAddress('pickup')} color={palette.ink}/>
      <AddressRow language={language} label={t('Куда доставить')} value={dropoff?.address || t('Куда доставить')} onPress={() => onAddress('dropoff')} onSwap={onSwap} swapDisabled={busy || !ready} color={palette.ink}/>
      <View style={d.services}>
        <DeliveryService language={language} title={t('Доставка')} source={require('../assets/car-economy.png')} selected={selectedKind === 'DELIVERY_CAR'} price={tariffs.find(item => item.kind === 'DELIVERY_CAR') ? quotes[tariffs.find(item => item.kind === 'DELIVERY_CAR')!.id]?.price : undefined} minimumPrice={tariffs.find(item => item.kind === 'DELIVERY_CAR')?.minimumPrice} onPress={() => onKind('DELIVERY_CAR')} palette={palette}/>
        <DeliveryService language={language} truck title={t('Грузовой')} source={require('../assets/home/truck-white.png')} selected={selectedKind === 'DELIVERY_TRUCK'} price={tariffs.find(item => item.kind === 'DELIVERY_TRUCK') ? quotes[tariffs.find(item => item.kind === 'DELIVERY_TRUCK')!.id]?.price : undefined} minimumPrice={tariffs.find(item => item.kind === 'DELIVERY_TRUCK')?.minimumPrice} onPress={() => onKind('DELIVERY_TRUCK')} palette={palette}/>
      </View>
      {!!error && <Text accessibilityRole="alert" style={d.error}>{error}</Text>}
      {footer()}
    </View>
    {surface === 'details' && <BottomPanel onClose={() => setSurface(null)} label={t('Закрыть параметры доставки')}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[d.details, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={d.detailsHeading}><View><Text style={[d.detailsTitle, { color: palette.ink }]}>{t(selectedKind === 'DELIVERY_TRUCK' ? 'Грузовой' : 'Доставка')}</Text><Text style={[d.detailsPrice, { color: palette.ink }]}>{shownQuote ? money(shownQuote.price) : selected ? `${t('от')} ${money(selected.minimumPrice)}` : t('Стоимость после маршрута')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={() => setSurface(null)} style={d.close}><Icon name="close" color={palette.ink}/></Pressable></View>
        <View style={[d.deliveryHero, { backgroundColor: isDark ? palette.elevated : '#F4F6F8' }]}><Image source={selectedKind === 'DELIVERY_TRUCK' ? require('../assets/home/truck-white.png') : require('../assets/car-economy.png')} resizeMode="contain" style={d.heroImage}/></View>
        <View style={[d.simpleOptions, { backgroundColor: isDark ? palette.elevated : '#F7F8FA' }]}>
          <OptionSwitch icon="time-outline" title={t('Запланировать поездку')} caption={t('Подача через 30 минут')} value={details.scheduled} onValueChange={scheduled => onDetails({ ...details, scheduled })}/>
          <OptionSwitch icon="walk-outline" title={t('От двери до двери')} caption={t('Водитель заберёт и передаст груз у двери')} value={details.doorToDoor} onValueChange={doorToDoor => onDetails({ ...details, doorToDoor })}/>
          <View style={[d.commentBlock, { borderColor: palette.line }]}><View style={d.commentHeading}><Icon name="chatbubble-outline" color={palette.ink} size={21}/><Text style={[d.optionTitle, { color: palette.ink }]}>{t('Комментарий водителю')}</Text></View><TextInput value={details.comment} onChangeText={comment => onDetails({ ...details, comment })} maxLength={500} multiline placeholder={t('Укажите важные детали')} placeholderTextColor={palette.muted} style={[d.commentInput, { color: palette.ink, backgroundColor: isDark ? palette.surface : '#FFFFFF' }]}/></View>
        </View>
        {!!error && <Text accessibilityRole="alert" style={d.error}>{error}</Text>}
        {footer(true)}
      </ScrollView>
    </BottomPanel>}
    {surface === 'payment' && <BottomPanel onClose={closePayment} label={t('Закрыть способы оплаты')}><View style={[d.payment, { paddingBottom: Math.max(insets.bottom, 12) }]}><View style={d.detailsHeading}><Text style={[d.detailsTitle, { color: palette.ink }]}>{t('Способы оплаты')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={closePayment} style={d.close}><Icon name="close" color={palette.ink}/></Pressable></View><View style={[d.paymentOption, { borderColor: palette.line }]}><Icon name="cash-outline" color={colors.blue} size={29}/><View style={{ flex: 1, gap: 3 }}><Text style={[d.paymentTitle, { color: palette.ink }]}>{t('Наличные')}</Text><Text style={[d.hint, { color: palette.muted }]}>{t('Оплата водителю после поездки')}</Text></View><Icon name="checkmark-circle" color={colors.blue} size={25}/></View><Pressable accessibilityRole="button" onPress={closePayment} style={[d.paymentDone, { backgroundColor: palette.accent }]}><Text style={[d.paymentDoneText, { color: palette.accentText }]}>{t('Готово')}</Text></Pressable></View></BottomPanel>}
  </View>;
}

function AddressRow({ value, label, pickup, onPress, onSwap, swapDisabled, color, language = 'ru' }: { value: string; label: string; pickup?: boolean; onPress: () => void; onSwap?: () => void; swapDisabled?: boolean; color: string; language?: Language }) {
  return <View style={d.address}><Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={d.addressMain}>{pickup ? <PickupIcon size={21}/> : <Icon name="flag" size={21}/>}<View style={{ flex: 1 }}><Text style={d.addressLabel}>{label}</Text><Text numberOfLines={1} style={[d.addressValue, { color }]}>{shortAddress(value)}</Text></View></Pressable>{onSwap ? <Pressable accessibilityRole="button" accessibilityLabel={tr(language)('Поменять адреса местами')} accessibilityState={{ disabled: !!swapDisabled }} onPress={onSwap} disabled={swapDisabled} style={[d.swap, swapDisabled && { opacity: .35 }]}><Icon name="swap-vertical" color={colors.muted} size={21}/></Pressable> : <Icon name="chevron-forward" color={colors.muted} size={18}/>}</View>;
}
function DeliveryService({ title, source, truck = false, selected, price, minimumPrice, onPress, palette, language = 'ru' }: { title: string; source: number; truck?: boolean; selected: boolean; price?: number; minimumPrice?: number; onPress: () => void; palette: ReturnType<typeof useTheme>['palette']; language?: Language }) {
  const t = tr(language);
  const displayPrice = price ? money(price) : minimumPrice ? `${t('от')} ${money(minimumPrice)}` : t('Расчёт цены');
  return <Pressable accessibilityRole="radio" accessibilityLabel={`${title}, ${displayPrice}`} accessibilityState={{ checked: selected }} onPress={onPress} style={[d.service, { backgroundColor: selected ? palette.elevated : 'transparent' }]}><View style={d.serviceImageFrame}><Image source={source} resizeMode="contain" style={[d.serviceImage, truck && d.truckImage]}/></View><Text style={[d.serviceName, { color: palette.ink }]}>{title}</Text><Text style={[d.servicePrice, { color: palette.ink }]}>{displayPrice}</Text></Pressable>;
}
function OptionSwitch({ icon, title, caption, value, onValueChange }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; caption: string; value: boolean; onValueChange: (value: boolean) => void }) { const { palette } = useTheme(); return <View style={d.option}><Icon name={icon} color={palette.ink} size={22}/><View style={{ flex: 1 }}><Text style={[d.optionTitle, { color: palette.ink }]}>{title}</Text><Text style={[d.hint, { color: palette.muted }]}>{caption}</Text></View><ToggleSwitch label={title} value={value} onValueChange={onValueChange}/></View>; }

const d = StyleSheet.create({
  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 17, paddingTop: 15, gap: 3, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 3 }, deliveryMark: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#EA3C32', alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 26, fontWeight: '800', letterSpacing: -.6 },
  address: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E1E4E8' }, addressMain: { flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 13 }, swap: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center' }, addressLabel: { color: colors.muted, fontSize: 10, marginBottom: 2 }, addressValue: { fontSize: 15, fontWeight: '500' }, services: { flexDirection: 'row', gap: 8, paddingTop: 9, paddingBottom: 5 }, service: { flex: 1, minHeight: 142, borderRadius: 20, paddingHorizontal: 9, paddingTop: 5, paddingBottom: 10, alignItems: 'flex-start' }, serviceImageFrame: { width: '100%', height: 83, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, serviceImage: { width: 140, maxWidth: '100%', height: 100 }, truckImage: { width: 164, height: 158 }, serviceName: { fontSize: 15, lineHeight: 19, fontWeight: '700' }, servicePrice: { fontSize: 17, lineHeight: 22, fontWeight: '800', marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 6 }, cash: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center' }, primary: { minHeight: 52, borderRadius: 17, backgroundColor: colors.blue, flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' }, parameters: { width: 43, height: 48, alignItems: 'center', justifyContent: 'center' }, error: { color: colors.danger, fontSize: 12, lineHeight: 16 },
  details: { paddingHorizontal: 17, paddingTop: 9, gap: 13 }, detailsHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, detailsTitle: { fontSize: 27, lineHeight: 33, fontWeight: '800' }, detailsPrice: { fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 3 }, close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, hint: { fontSize: 11, lineHeight: 16 }, deliveryHero: { minHeight: 176, alignItems: 'center', justifyContent: 'center', borderRadius: 22, paddingHorizontal: 12 }, heroImage: { width: '96%', height: 170 }, simpleOptions: { borderRadius: 20, paddingHorizontal: 14 }, option: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E2E5E9' }, optionTitle: { fontSize: 15, fontWeight: '700' }, commentBlock: { paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth }, commentHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }, commentInput: { minHeight: 74, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14, textAlignVertical: 'top' }, payment: { paddingHorizontal: 17, paddingTop: 8, gap: 16 }, paymentOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth }, paymentTitle: { fontSize: 16, fontWeight: '700' }, paymentDone: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, paymentDoneText: { fontSize: 16, fontWeight: '700' },
});
