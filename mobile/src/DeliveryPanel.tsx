import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel, panelStyle } from './BottomPanel';
import { clientMapPanelStyle } from './clientMapPanelStyle';
import { useTheme } from './design/theme';
import type { Language, Point, Quote, Tariff } from './types';
import { colors, Icon, PickupIcon, money, shortAddress, ToggleSwitch, tr } from './ui';
import { useParametersSwipe } from './useParametersSwipe';
import { usePanelTransition } from './usePanelTransition';

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
  registerAddressOpener?: (open: ((field: 'pickup' | 'dropoff') => void) | null) => void;
};
type Surface = 'summary' | 'details' | 'payment' | 'comment';

export function DeliveryPanel({ language = 'ru', pickup, dropoff, tariffs, selectedKind, quote, previewQuote, quotes, calculating, error, busy, details, onDetails, onKind, onAddress, registerAddressOpener, onSwap, onBook, onHeight, hidden }: Props) {
  const t = tr(language);
  const { isDark, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const { surface, navigate, suspend, resume, onSheetClosed, sheetClosing, rootVisible, rootTranslateY, onRootHeight } = usePanelTransition<Surface>('summary');
  const wasHidden = useRef(!!hidden);
  const requestAddress = (field: 'pickup' | 'dropoff') => suspend(() => onAddress(field));
  useEffect(() => { registerAddressOpener?.(requestAddress); return () => registerAddressOpener?.(null); }, [registerAddressOpener, requestAddress]);
  useEffect(() => { if (wasHidden.current && !hidden) resume(); wasHidden.current = !!hidden; }, [hidden]);
  const [paymentReturn, setPaymentReturn] = useState<'summary' | 'details'>('summary');
  const [commentDraft, setCommentDraft] = useState('');
  const selected = tariffs.find(item => item.kind === selectedKind);
  const ready = !!pickup && !!dropoff;
  const shownQuote = quote ?? previewQuote;
  const open = () => { if (!busy && rootVisible) navigate('details'); };
  const openPayment = () => { setPaymentReturn(surface === 'details' ? 'details' : 'summary'); navigate('payment'); };
  const closePayment = () => navigate(paymentReturn);
  const close = () => { Keyboard.dismiss(); navigate(surface === 'comment' ? 'details' : surface === 'payment' ? paymentReturn : 'summary'); };
  const dismiss = () => { Keyboard.dismiss(); onSheetClosed(); };
  const editComment = () => { setCommentDraft(details.comment); navigate('comment'); };
  const parametersPull = useParametersSwipe(open, rootVisible && !busy);
  const footer = (inside = false) => <View style={d.footer}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Способы оплаты')} disabled={busy} onPress={openPayment} style={d.cash}><Icon name="cash-outline" color={colors.blue} size={29}/></Pressable>
    <Pressable accessibilityRole="button" disabled={busy || (ready && !quote)} onPress={!ready ? () => requestAddress(dropoff ? 'pickup' : 'dropoff') : onBook} style={({ pressed }) => [d.primary, (pressed || busy || (ready && !quote)) && { opacity: .6 }]}>{(busy || (ready && !quote && calculating)) && <ActivityIndicator size="small" color="#FFFFFF"/>}<Text numberOfLines={2} adjustsFontSizeToFit style={d.primaryText}>{t(!ready ? 'Указать адреса' : quote ? 'Заказать доставку' : error ? 'Повторим автоматически' : shownQuote ? 'Обновляем цену…' : 'Считаем…')}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t(inside ? 'Свернуть параметры' : 'Параметры доставки')} onPress={inside ? close : open} style={d.parameters}><Icon name={inside ? 'chevron-down' : 'options-outline'} color={palette.ink} size={26}/></Pressable>
  </View>;
  if (hidden) return null;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
    <Animated.View pointerEvents={rootVisible ? 'auto' : 'none'} accessibilityElementsHidden={!rootVisible} importantForAccessibility={!rootVisible ? 'no-hide-descendants' : 'auto'} onLayout={event => { onRootHeight(event.nativeEvent.layout.height); onHeight(event.nativeEvent.layout.height); }} testID="client-delivery-panel" style={[panelStyle.surface, d.panel, clientMapPanelStyle.surface, isDark && { backgroundColor: palette.surface, shadowColor: palette.background }, { transform: [{ translateY: rootTranslateY }] }]}>
      <ScrollView testID="client-delivery-content" style={clientMapPanelStyle.scroll} nestedScrollEnabled keyboardShouldPersistTaps="handled" bounces={false}>
      <View style={d.titleRow}><Text style={[d.title, { color: palette.ink }]}>{t('Доставка')}</Text></View>
      <AddressRow language={language} label={t('Адрес отправки')} value={pickup?.address || t('Определяем местоположение')} pickup onPress={() => requestAddress('pickup')} color={palette.ink}/>
      <AddressRow language={language} label={t('Куда доставить')} value={dropoff?.address || t('Куда доставить')} onPress={() => requestAddress('dropoff')} onSwap={onSwap} swapDisabled={busy || !ready} color={palette.ink}/>
      <View style={d.services}>
        <DeliveryService language={language} title={t('Доставка')} source={require('../assets/car-economy.webp')} selected={selectedKind === 'DELIVERY_CAR'} price={tariffs.find(item => item.kind === 'DELIVERY_CAR') ? quotes[tariffs.find(item => item.kind === 'DELIVERY_CAR')!.id]?.price : undefined} minimumPrice={tariffs.find(item => item.kind === 'DELIVERY_CAR')?.minimumPrice} onPress={() => onKind('DELIVERY_CAR')} palette={palette}/>
        <DeliveryService language={language} truck title={t('Грузовой')} source={require('../assets/home/truck-white.webp')} selected={selectedKind === 'DELIVERY_TRUCK'} price={tariffs.find(item => item.kind === 'DELIVERY_TRUCK') ? quotes[tariffs.find(item => item.kind === 'DELIVERY_TRUCK')!.id]?.price : undefined} minimumPrice={tariffs.find(item => item.kind === 'DELIVERY_TRUCK')?.minimumPrice} onPress={() => onKind('DELIVERY_TRUCK')} palette={palette}/>
      </View>
      {!!error && <Text accessibilityRole="alert" style={d.error}>{error}</Text>}
      </ScrollView>
      <GestureDetector gesture={parametersPull}>
        <View testID="delivery-parameters-swipe" collapsable={false} style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          {footer()}
        </View>
      </GestureDetector>
    </Animated.View>
    {surface !== 'summary' && <BottomPanel key={surface} closeRequested={sheetClosing} onClose={dismiss} label={t('Закрыть')}>
    {surface === 'details' && <>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[d.details, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={d.detailsHeading}><View><Text style={[d.detailsTitle, { color: palette.ink }]}>{t(selectedKind === 'DELIVERY_TRUCK' ? 'Грузовой' : 'Доставка')}</Text><Text style={[d.detailsPrice, { color: palette.ink }]}>{shownQuote ? money(shownQuote.price) : selected ? `${t('от')} ${money(selected.minimumPrice)}` : t('Стоимость после маршрута')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={close} style={d.close}><Icon name="close" color={palette.ink}/></Pressable></View>
        <View style={[d.deliveryHero, { backgroundColor: isDark ? palette.elevated : '#F4F6F8' }]}><Image source={selectedKind === 'DELIVERY_TRUCK' ? require('../assets/home/truck-white.webp') : require('../assets/car-economy.webp')} resizeMode="contain" style={d.heroImage}/></View>
        <View style={[d.simpleOptions, { backgroundColor: isDark ? palette.elevated : '#F7F8FA' }]}>
          <OptionSwitch icon="time-outline" title={t('Запланировать поездку')} caption={t('Подача через 30 минут')} value={details.scheduled} onValueChange={scheduled => onDetails({ ...details, scheduled })}/>
          <OptionSwitch icon="walk-outline" title={t('От двери до двери')} caption={t('Водитель заберёт и передаст груз у двери')} value={details.doorToDoor} onValueChange={doorToDoor => onDetails({ ...details, doorToDoor })}/>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Комментарий водителю')} onPress={editComment} style={[d.option, { borderBottomWidth: 0 }]}><Icon name="chatbubble-outline" color={palette.ink} size={21}/><View style={{ flex: 1 }}><Text style={[d.optionTitle, { color: palette.ink }]}>{t('Комментарий водителю')}</Text>{!!details.comment && <Text numberOfLines={2} style={[d.hint, { color: palette.muted }]}>{details.comment}</Text>}</View><Icon name="chevron-forward" color={palette.muted} size={18}/></Pressable>
        </View>
        {!!error && <Text accessibilityRole="alert" style={d.error}>{error}</Text>}
        {footer(true)}
      </ScrollView>
    </>}
    {surface === 'comment' && <View style={[d.payment, { paddingBottom: Math.max(insets.bottom, 12) }]}><Text style={[d.detailsTitle, { color: palette.ink }]}>{t('Комментарий водителю')}</Text><TextInput testID="delivery-comment" accessibilityLabel={t('Комментарий водителю')} value={commentDraft} onChangeText={setCommentDraft} autoFocus maxLength={500} multiline placeholder={t('Укажите важные детали')} placeholderTextColor={palette.muted} style={[d.commentInput, { color: palette.ink, backgroundColor: palette.elevated }]}/><Pressable accessibilityRole="button" accessibilityLabel={t('Готово')} testID="delivery-comment-done" onPress={() => { onDetails({ ...details, comment: commentDraft.trim() }); close(); }} style={[d.paymentDone, { backgroundColor: palette.accent }]}><Text style={[d.paymentDoneText, { color: palette.accentText }]}>{t('Готово')}</Text></Pressable></View>}
    {surface === 'payment' && <><View style={[d.payment, { paddingBottom: Math.max(insets.bottom, 12) }]}><View style={d.detailsHeading}><Text style={[d.detailsTitle, { color: palette.ink }]}>{t('Способы оплаты')}</Text></View><View style={[d.paymentOption, { borderColor: palette.line }]}><Icon name="cash-outline" color={colors.blue} size={29}/><View style={{ flex: 1, gap: 3 }}><Text style={[d.paymentTitle, { color: palette.ink }]}>{t('Наличные')}</Text><Text style={[d.hint, { color: palette.muted }]}>{t('Оплата водителю после поездки')}</Text></View><Icon name="checkmark-circle" color={colors.blue} size={25}/></View><Pressable accessibilityRole="button" accessibilityLabel={t('Готово')} onPress={closePayment} style={[d.paymentDone, { backgroundColor: palette.accent }]}><Text style={[d.paymentDoneText, { color: palette.accentText }]}>{t('Готово')}</Text></Pressable></View></>}
    </BottomPanel>}
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
  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 17, paddingTop: 12, gap: 2, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, titleRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 2 }, title: { fontSize: 26, fontWeight: '800', letterSpacing: -.6 },
  address: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E1E4E8' }, addressMain: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 13 }, swap: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center' }, addressLabel: { color: colors.muted, fontSize: 10, marginBottom: 2 }, addressValue: { fontSize: 15, fontWeight: '500' }, services: { flexDirection: 'row', gap: 8, paddingTop: 6, paddingBottom: 3 }, service: { flex: 1, minHeight: 124, borderRadius: 18, paddingHorizontal: 9, paddingTop: 4, paddingBottom: 7, alignItems: 'flex-start' }, serviceImageFrame: { width: '100%', height: 68, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, serviceImage: { width: 112, maxWidth: '100%', height: 78 }, truckImage: { width: 112, height: 112 }, serviceName: { fontSize: 14, lineHeight: 18, fontWeight: '700' }, servicePrice: { fontSize: 15, lineHeight: 20, fontWeight: '800', marginTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 6 }, cash: { width: 42, height: 48, alignItems: 'center', justifyContent: 'center' }, primary: { minHeight: 52, borderRadius: 17, backgroundColor: colors.blue, flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, primaryText: { flexShrink: 1, textAlign: 'center', color: '#FFFFFF', fontSize: 15, fontWeight: '700' }, parameters: { width: 43, height: 48, alignItems: 'center', justifyContent: 'center' }, error: { color: colors.danger, fontSize: 12, lineHeight: 16 },
  details: { paddingHorizontal: 17, paddingTop: 9, gap: 13 }, detailsHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, detailsTitle: { fontSize: 27, lineHeight: 33, fontWeight: '800' }, detailsPrice: { fontSize: 20, lineHeight: 26, fontWeight: '700', marginTop: 3 }, close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, hint: { fontSize: 11, lineHeight: 16 }, deliveryHero: { minHeight: 176, alignItems: 'center', justifyContent: 'center', borderRadius: 22, paddingHorizontal: 12 }, heroImage: { width: '96%', height: 170 }, simpleOptions: { borderRadius: 20, paddingHorizontal: 14 }, option: { minHeight: 65, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E2E5E9' }, optionTitle: { fontSize: 15, fontWeight: '700' }, commentBlock: { paddingVertical: 13, borderTopWidth: StyleSheet.hairlineWidth }, commentHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 }, commentInput: { minHeight: 74, borderRadius: 15, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14, textAlignVertical: 'top' }, payment: { paddingHorizontal: 17, paddingTop: 8, gap: 16 }, paymentOption: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth }, paymentTitle: { fontSize: 16, fontWeight: '700' }, paymentDone: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, paymentDoneText: { fontSize: 16, fontWeight: '700' },
});
