import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import * as Contacts from 'expo-contacts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Car, colors, Icon, PickupIcon, km, mins, money, shortAddress, tr } from './ui';
import { BottomPanel, panelStyle } from './BottomPanel';
import { clientMapPanelStyle } from './clientMapPanelStyle';
import { Point, Quote, Tariff, User } from './types';
import { usePanelTransition } from './usePanelTransition';
import { useTheme } from './design/theme';
import { useThemeStyles } from './design/themeStyles';
import { GestureDetector } from 'react-native-gesture-handler';
import { useParametersSwipe } from './useParametersSwipe';
import Reanimated, { useAnimatedStyle, useSharedValue, withSpring, type SharedValue } from 'react-native-reanimated';
import { useMotionPreference } from './design/motion';

export type RideDetails = { entrance: string; comment: string; passenger: { name: string; phone: string } | null };
export const emptyRideDetails: RideDetails = { entrance: '', comment: '', passenger: null };
export function rideComment(details: RideDetails): string {
  return [details.entrance.trim() && 'Подъезд: ' + details.entrance.trim(), details.comment.trim()].filter(Boolean).join('\n');
}
type EditField = 'entrance' | 'comment';
type Surface = 'summary' | 'details' | 'payment' | 'passenger' | EditField;
type Props = {
  pickup: Point | null; dropoff: Point | null; locatingPickup?: boolean; tariffs: Tariff[]; tariffId: string;
  quote: Quote | null; previewQuote?: Quote | null; quotes: Record<string, Quote>; calculating: boolean; quoteError: string; bookingError?: string; busy: boolean;
  pickupAvailability?: 'unknown' | 'available' | 'unavailable';
  routeDurationSeconds?: number;
  language: User['language']; details: RideDetails; onDetails: (value: RideDetails) => void;
  onAddress: (field: 'pickup' | 'dropoff') => void; onTariff: (id: string) => void;
  registerAddressOpener?: (open: ((field: 'pickup' | 'dropoff') => void) | null) => void;
  onSwap: () => void; onBook: () => void;
  onHeight: (height: number) => void; hidden?: boolean; mapMoving?: boolean; browseOffset?: SharedValue<number>;
};
const carColor = (index: number) => index === 0 ? '#E5ECF4' : index === 1 ? '#67788D' : '#253447';
const titles: Record<EditField, string> = { entrance: 'Укажите номер подъезда', comment: 'Комментарий водителю' };

export function BookingPanel({ pickup, dropoff, locatingPickup = false, tariffs, tariffId, quote, previewQuote, quotes, calculating, quoteError, bookingError, busy, pickupAvailability = 'unknown', routeDurationSeconds, language, details, onDetails, onAddress, registerAddressOpener, onTariff, onSwap, onBook, onHeight, hidden, mapMoving = false, browseOffset }: Props) {
  const { isDark, palette } = useTheme();
  const b = useThemeStyles(baseB);
  const t = tr(language);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const { surface, navigate, suspend, resume, onSheetClosed, sheetClosing, rootVisible, rootTranslateY, onRootHeight } = usePanelTransition<Surface>('summary');
  const reducedMotion = useMotionPreference();
  const mapHidden = mapMoving && !dropoff && rootVisible;
  const mapProgress = useSharedValue(0);
  const panelTravel = useSharedValue(200);
  useEffect(() => {
    if (browseOffset) return;
    mapProgress.set(reducedMotion ? (mapHidden ? 1 : 0) : withSpring(mapHidden ? 1 : 0, { duration: 300, dampingRatio: 1, overshootClamping: true }));
  }, [mapHidden, reducedMotion, mapProgress, browseOffset]);
  const mapMotion = useAnimatedStyle(() => ({ transform: [{ translateY: browseOffset ? browseOffset.get() : mapProgress.get() * panelTravel.get() }] }));
  const wasHidden = useRef(!!hidden);
  const requestAddress = (field: 'pickup' | 'dropoff') => suspend(() => onAddress(field));
  useEffect(() => { registerAddressOpener?.(requestAddress); return () => registerAddressOpener?.(null); }, [registerAddressOpener, requestAddress]);
  useEffect(() => { if (wasHidden.current && !hidden) resume(); wasHidden.current = !!hidden; }, [hidden]);
  const [returnTo, setReturnTo] = useState<'summary' | 'details'>('summary');
  const [draft, setDraft] = useState('');
  const [passengerDraft, setPassengerDraft] = useState({ name: '', phone: '' });
  const [passengerError, setPassengerError] = useState('');
  const [contactsBusy, setContactsBusy] = useState(false);
  const ready = !!pickup && !!dropoff;
  const shownQuote = quote ?? previewQuote;
  const durationSeconds = Number.isFinite(routeDurationSeconds) && routeDurationSeconds! > 0 ? routeDurationSeconds : shownQuote?.durationSeconds;
  const noCars = pickupAvailability === 'unavailable';
  const tooLong = rideComment(details).length > 500;
  const bookDisabled = noCars || locatingPickup || busy || (ready && !quote) || tooLong;
  const visibleError = tooLong ? 'Сократите комментарий до 500 символов.' : bookingError || quoteError;
  const index = Math.max(0, tariffs.findIndex(item => item.id === tariffId));
  const tariff = tariffs[index];
  const editing = surface in titles ? surface as EditField : null;
  const openParameters = () => {
    if (rootVisible && surface === 'summary' && dropoff && !busy) navigate('details');
  };
  const parametersPull = useParametersSwipe(openParameters, rootVisible && surface === 'summary' && !!dropoff && !busy);
  const edit = (field: EditField) => { setReturnTo(surface === 'details' ? 'details' : 'summary'); setDraft(details[field]); navigate(field); };
  const close = () => { Keyboard.dismiss(); navigate(editing || surface === 'payment' || surface === 'passenger' ? returnTo : 'summary'); };
  const dismiss = () => { Keyboard.dismiss(); onSheetClosed(); };
  const payment = () => { setReturnTo(surface === 'details' ? 'details' : 'summary'); navigate('payment'); };
  const openPassenger = () => { setReturnTo('details'); setPassengerDraft(details.passenger || { name: '', phone: '' }); setPassengerError(''); navigate('passenger'); };
  const savePassenger = () => {
    const name = passengerDraft.name.trim();
    const phone = passengerDraft.phone.trim();
    if (name.length < 2 || !/^\+?[\d ()-]{7,24}$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) {
      setPassengerError('Укажите имя и номер телефона пассажира');
      return;
    }
    onDetails({ ...details, passenger: { name, phone } });
    close();
  };
  const chooseContact = async () => {
    if (contactsBusy) return;
    setContactsBusy(true);
    setPassengerError('');
    try {
      if (!await Contacts.isAvailableAsync()) { setPassengerError('Контакты на этом устройстве недоступны'); return; }
      if (Platform.OS === 'android' && !(await Contacts.requestPermissionsAsync()).granted) {
        setPassengerError('Разрешите доступ к контактам в настройках телефона'); return;
      }
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) return;
      const phone = contact.phoneNumbers?.find(item => !!item.number)?.number || '';
      if (!phone) { setPassengerError('У выбранного контакта нет номера телефона'); return; }
      setPassengerDraft({ name: contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' '), phone });
    } catch {
      setPassengerError('Не удалось открыть контакты');
    } finally {
      setContactsBusy(false);
    }
  };
  const footer = (expanded = false) => <View style={b.footer}>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Способы оплаты')} onPress={payment} disabled={busy} style={b.iconButton}><Icon name="cash-outline" size={27} color={colors.blue}/></Pressable>
    <Pressable testID="book-ride" accessibilityRole="button" accessibilityState={{ disabled: bookDisabled }} disabled={bookDisabled} onPress={() => { if (!bookDisabled) { if (ready) onBook(); else onAddress(pickup ? 'dropoff' : 'pickup'); } }} style={({ pressed }) => [b.primary, { flex: 1 }, noCars && b.primaryUnavailable, !noCars && (pressed || bookDisabled) && { opacity: .6 }]}>
    {!noCars && (locatingPickup || busy || (ready && !quote && calculating)) && <ActivityIndicator color={palette.accentText} size="small"/>}<Text numberOfLines={2} adjustsFontSizeToFit style={[b.primaryText, noCars && b.primaryUnavailableText]}>{t(noCars ? 'Нет машин' : locatingPickup ? 'Определяем местоположение' : !ready ? 'Укажите маршрут' : quote ? 'Заказать' : quoteError ? 'Повторим автоматически' : shownQuote ? 'Обновляем цену…' : 'Считаем…')}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={t(expanded ? 'Свернуть детали поездки' : 'Детали поездки')} onPress={() => navigate(expanded ? 'summary' : 'details')} style={b.iconButton}><Icon name={expanded ? 'chevron-down' : 'options-outline'} size={25}/></Pressable>
  </View>;
  if (hidden) return null;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
    <Reanimated.View testID="taxi-map-browse-surface" pointerEvents={mapHidden ? 'none' : 'box-none'} style={[StyleSheet.absoluteFill, mapMotion]}>
    <Animated.View pointerEvents={rootVisible && !mapHidden ? 'auto' : 'none'} accessibilityElementsHidden={surface !== 'summary' || mapHidden} importantForAccessibility={surface === 'summary' && !mapHidden ? 'auto' : 'no-hide-descendants'} onLayout={event => { const measured = event.nativeEvent.layout.height; panelTravel.set(Math.max(0, measured - 32)); onRootHeight(measured); onHeight(measured); }} testID="client-booking-panel" style={[panelStyle.surface, clientMapPanelStyle.surface, isDark && { backgroundColor: palette.surface, shadowColor: palette.background }, { position: 'absolute', bottom: 0, left: 0, right: 0, paddingTop: 14, paddingBottom: dropoff ? 0 : Math.max(insets.bottom, 12), transform: [{ translateY: rootTranslateY }] }]}>
      <ScrollView testID="client-booking-content" style={clientMapPanelStyle.scroll} nestedScrollEnabled keyboardShouldPersistTaps="handled" bounces={false}>
      {!dropoff ? <View style={b.home}>
        <View style={b.homeTitle}><Image source={require('../assets/logo1.png')} accessibilityLabel="Atlas" resizeMode="contain" style={b.serviceLogo}/><Text style={b.title}>{t('Такси')}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Куда едем?')} onPress={() => requestAddress('dropoff')} style={[b.destination, !isDark && b.destinationShadow]}><Text style={b.where}>{t('Куда едем?')}</Text><Icon name="arrow-forward-circle" size={23}/></Pressable>
      </View> : <>
        <View style={b.addressRow}><Pressable accessibilityRole="button" accessibilityLabel={t('Откуда')} disabled={busy} onPress={() => requestAddress('pickup')} style={b.address}><PickupIcon size={20}/><Text numberOfLines={1} style={b.addressText}>{shortAddress(pickup?.address) || t(locatingPickup ? 'Определяем местоположение' : 'Место подачи')}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('Подъезд')} onPress={() => edit('entrance')} style={b.pill}><Text numberOfLines={1} style={b.pillText}>{details.entrance ? t('Подъезд') + ' ' + details.entrance : t('Подъезд')}</Text></Pressable></View>
        <View style={b.addressRow}><Pressable accessibilityRole="button" accessibilityLabel={t('Куда')} disabled={busy} onPress={() => requestAddress('dropoff')} style={b.address}><Icon name="flag" size={20}/><Text numberOfLines={1} style={b.addressText}>{shortAddress(dropoff.address)}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('Поменять адреса местами')} onPress={onSwap} disabled={busy} style={b.iconButton}><Icon name="swap-vertical" size={20}/></Pressable></View>
        <View style={b.tariffRow}>
        <ScrollView horizontal style={b.tariffScroll} showsHorizontalScrollIndicator={false} contentContainerStyle={b.tariffs}>
          {tariffs.map((item, i) => <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.name + ', ' + (noCars ? t('Нет машин') : quotes[item.id] ? money(quotes[item.id].price) : t('Расчёт стоимости'))} accessibilityState={{ checked: item.id === tariffId }} disabled={busy} onPress={() => item.id === tariffId ? navigate('details') : onTariff(item.id)} style={[b.tariff, item.id === tariffId && b.selected, isDark && item.id === tariffId && { borderColor: palette.ink }]}>
            <Car color={carColor(i)} size={86}/><Text style={b.tariffName} numberOfLines={1}>{item.name}</Text><Text testID={'booking-tariff-price-' + item.id} style={b.price}>{noCars ? '—' : quotes[item.id] ? money(quotes[item.id].price) : calculating ? '…' : '—'}</Text>
          </Pressable>)}
        </ScrollView>
        {shownQuote && Number.isFinite(shownQuote.distanceMeters) && shownQuote.distanceMeters >= 0 && !!durationSeconds && <View testID="booking-route-summary" style={b.routeSummary}>
          <Text style={b.caption}>{t('Ехать')}</Text>
          <Text testID="booking-route-distance" numberOfLines={1} style={b.routeDistance}>{km(shownQuote.distanceMeters)}</Text>
          <Text testID="booking-route-time" numberOfLines={1} style={b.caption}>{mins(durationSeconds, language) + ' ' + t('в пути')}</Text>
        </View>}
        </View>
        {!tariffs.length && <Text style={b.caption}>{t('Загружаем тарифы…')}</Text>}
        {!!visibleError && <Text accessibilityRole="alert" style={b.error}>{t(visibleError)}</Text>}
      </>}
      </ScrollView>
      {!!dropoff && <GestureDetector gesture={parametersPull}>
        <View testID="taxi-parameters-swipe" collapsable={false} style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
          {footer()}
        </View>
      </GestureDetector>}
    </Animated.View>
    </Reanimated.View>
    {surface !== 'summary' && <BottomPanel key={surface} closeRequested={sheetClosing} onClose={dismiss} label={t('Закрыть')}>
      {surface === 'details' && <>
        <ScrollView style={clientMapPanelStyle.scroll} nestedScrollEnabled keyboardShouldPersistTaps="handled" bounces={false}>
        <View style={b.detailsHeader}><Pressable accessibilityRole="button" accessibilityLabel={t('Назад')} onPress={close} style={b.iconButton}><Icon name="arrow-back"/></Pressable><View style={{ flex: 1, alignItems: 'center' }}><Text numberOfLines={1} style={b.routeLabel}>{shortAddress(pickup?.address)}</Text><Text numberOfLines={1} style={b.routeLabel}>{shortAddress(dropoff?.address)}</Text></View><View style={b.iconButton}><Icon name="information-circle-outline" color={colors.muted}/></View></View>
        <View style={b.hero}><View style={{ alignItems: 'center' }}><Car size={height < 740 ? 160 : 210} color={carColor(index)}/></View><Text style={b.detailTitle}>{tariff?.name || t('Такси')}</Text><Text numberOfLines={2} style={b.caption}>{tariff?.description || t('Выберите тариф')}</Text><Text testID="booking-detail-price" style={b.detailPrice}>{shownQuote ? (noCars ? '—' : money(shownQuote.price)) + ' · ≈ ' + mins(durationSeconds!, language) + ' ' + t('в пути') : noCars ? '—' : t('Выберите маршрут')}</Text></View>
        <View style={b.optionsBody}>
          <View style={b.optionsList}>
            <Pressable accessibilityRole="button" accessibilityLabel={t(titles.comment)} onPress={() => edit('comment')} style={b.optionRow}><Icon name="chatbubble-outline" size={21}/><View style={{ flex: 1 }}><Text style={b.addressText}>{t(titles.comment)}</Text>{!!details.comment && <Text numberOfLines={1} style={b.caption}>{details.comment}</Text>}</View><Icon name="chevron-forward" size={17}/></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Заказ другому человеку')} onPress={openPassenger} style={[b.optionRow, { borderBottomWidth: 0 }]}><Icon name="person-add-outline" size={21}/><View style={{ flex: 1 }}><Text style={b.addressText}>{t('Заказ другому человеку')}</Text>{!!details.passenger && <Text numberOfLines={1} style={b.caption}>{details.passenger.name} · {details.passenger.phone}</Text>}</View><Icon name="chevron-forward" size={17}/></Pressable>
          </View>
        </View>
        </ScrollView>
        <View style={b.bottom}>{!!visibleError && <Text accessibilityRole="alert" style={b.error}>{t(visibleError)}</Text>}{footer(true)}</View>
      </>}
      {editing && <View style={b.editor}>
        <View style={b.editorHeading}><Text style={b.detailTitle}>{t(titles[editing])}</Text></View>
        <TextInput key={editing} testID={'ride-' + editing} accessibilityLabel={t(titles[editing])} value={draft} onChangeText={setDraft} autoFocus maxLength={editing === 'entrance' ? 20 : editing === 'comment' ? 220 : 80} multiline={editing !== 'entrance'} placeholder={t(editing === 'entrance' ? 'Например, 2' : 'Напишите здесь')} placeholderTextColor={palette.muted} returnKeyType={editing === 'entrance' ? 'done' : 'default'} onSubmitEditing={editing === 'entrance' ? () => { onDetails({ ...details, [editing]: draft.trim() }); close(); } : undefined} style={[b.input, { height: editing === 'entrance' ? 56 : 90 }]}/>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Готово')} testID="ride-editor-done" onPress={() => { onDetails({ ...details, [editing]: draft.trim() }); close(); }} style={b.primary}><Text numberOfLines={2} adjustsFontSizeToFit style={b.primaryText}>{t('Готово')}</Text></Pressable>
      </View>}
      {surface === 'passenger' && <View style={b.editor}>
        <View style={b.editorHeading}><Text style={b.detailTitle}>{t('Заказ другому человеку')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={close} style={b.iconButton}><Icon name="close"/></Pressable></View>
        <Text style={b.caption}>{t('Водитель увидит имя и телефон этого пассажира')}</Text>
        <TextInput testID="passenger-name" accessibilityLabel={t('Имя пассажира')} value={passengerDraft.name} onChangeText={name => { setPassengerDraft(current => ({ ...current, name })); setPassengerError(''); }} maxLength={80} placeholder={t('Имя пассажира')} placeholderTextColor={palette.muted} autoCapitalize="words" style={[b.input, { height: 56 }]}/>
        <TextInput testID="passenger-phone" accessibilityLabel={t('Телефон пассажира')} value={passengerDraft.phone} onChangeText={phone => { setPassengerDraft(current => ({ ...current, phone })); setPassengerError(''); }} maxLength={24} placeholder={t('Телефон пассажира')} placeholderTextColor={palette.muted} keyboardType="phone-pad" autoComplete="tel" style={[b.input, { height: 56 }]}/>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Выбрать из контактов')} disabled={contactsBusy} onPress={() => { void chooseContact(); }} style={b.contactPicker}><Icon name="people-outline" color={palette.accent} size={22}/><Text style={[b.addressText, { color: palette.accent }]}>{t('Выбрать из контактов')}</Text>{contactsBusy && <ActivityIndicator color={palette.accent}/>}</Pressable>
        {!!passengerError && <Text accessibilityRole="alert" style={b.error}>{t(passengerError)}</Text>}
        <Pressable accessibilityRole="button" accessibilityLabel={t('Готово')} onPress={savePassenger} style={b.primary}><Text numberOfLines={2} adjustsFontSizeToFit style={b.primaryText}>{t('Готово')}</Text></Pressable>
        {!!details.passenger && <Pressable accessibilityRole="button" accessibilityLabel={t('Убрать пассажира')} onPress={() => { onDetails({ ...details, passenger: null }); close(); }} style={b.contactPicker}><Text style={[b.addressText, { color: palette.muted }]}>{t('Убрать пассажира')}</Text></Pressable>}
      </View>}
      {surface === 'payment' && <View style={b.editor}><View style={b.editorHeading}><Text style={b.detailTitle}>{t('Способы оплаты')}</Text></View><View style={b.optionRow}><Icon name="cash-outline" color={colors.blue} size={28}/><View style={{ flex: 1 }}><Text style={b.addressText}>{t('Наличные')}</Text><Text style={b.caption}>{t('Оплата водителю после поездки')}</Text></View><Icon name="checkmark-circle" color={colors.blue}/></View><Pressable accessibilityRole="button" accessibilityLabel={t('Готово')} testID="ride-payment-done" onPress={close} style={b.primary}><Text numberOfLines={2} adjustsFontSizeToFit style={b.primaryText}>{t('Готово')}</Text></Pressable></View>}
    </BottomPanel>}
  </View>;
}
const baseB = StyleSheet.create({
  destinationShadow: { elevation: 2, shadowColor: '#152E50', shadowOpacity: .07, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  home: { gap: 13, paddingTop: 3, paddingBottom: 9 }, homeTitle: { flexDirection: 'row', alignItems: 'center', gap: 9 }, serviceLogo: { width: 40, height: 40, borderRadius: 12 }, title: { fontSize: 27, color: colors.ink, fontWeight: '700', letterSpacing: -.7 }, destination: { height: 50, borderRadius: 16, backgroundColor: '#F0F2F5', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }, where: { flex: 1, fontSize: 16, color: colors.ink, fontWeight: '600', textAlign: 'center' },
  addressRow: { flexDirection: 'row', alignItems: 'center', minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E6E8EB', gap: 5 }, address: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 15, paddingVertical: 14 }, addressText: { fontSize: 15, color: colors.ink, flexShrink: 1 }, pill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: '#F1F2F4', maxWidth: 116 }, pillText: { fontSize: 12, color: colors.ink },
  caption: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  tariffRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, tariffScroll: { flex: 1, minWidth: 0 },
  routeSummary: { width: 96, alignItems: 'flex-end', gap: 2 }, routeDistance: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.ink },
  tariffs: { gap: 6, paddingTop: 8 }, tariff: { width: 100, borderRadius: 17, paddingHorizontal: 7, paddingTop: 0, paddingBottom: 7, borderWidth: 1.5, borderColor: 'transparent' }, selected: { backgroundColor: '#EAF3FF', borderColor: '#C2DDFF' }, tariffName: { fontSize: 13, color: colors.ink, marginTop: -5 }, price: { fontSize: 17, lineHeight: 22, color: colors.ink, fontWeight: '600' }, requests: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 4 }, iconButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }, primary: { minHeight: 52, borderRadius: 16, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, paddingHorizontal: 12 }, primaryText: { flexShrink: 1, textAlign: 'center', color: 'white', fontSize: 16, fontWeight: '600' }, error: { fontSize: 12, lineHeight: 16, color: colors.danger, paddingVertical: 5 },
  primaryUnavailable: { backgroundColor: '#F0F2F5' }, primaryUnavailableText: { color: colors.muted },
  detailsHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: '#F7F8FA' }, routeLabel: { color: colors.ink, fontSize: 11, lineHeight: 16 }, hero: { paddingHorizontal: 18, paddingBottom: 15, gap: 5, backgroundColor: '#F7F8FA' }, detailTitle: { color: colors.ink, fontSize: 22, fontWeight: '700', flexShrink: 1 }, detailPrice: { fontSize: 22, color: colors.ink, fontWeight: '600', paddingTop: 6 }, optionsBody: { paddingHorizontal: 16, paddingTop: 15, gap: 12 }, optionsList: { paddingHorizontal: 14, backgroundColor: '#F4F5F7', borderRadius: 20 }, optionRow: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 56, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E2E5E9' }, bottom: { paddingHorizontal: 16, paddingTop: 17, paddingBottom: 5 }, editor: { paddingHorizontal: 16, paddingBottom: 7, gap: 16 }, editorHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, input: { fontSize: 18, color: colors.ink, borderBottomWidth: 1.5, borderBottomColor: colors.ink, paddingHorizontal: 4, paddingVertical: 12, textAlignVertical: 'top' }, contactPicker: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
});
