import React, { useEffect } from 'react';
import { ActivityIndicator, Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel, panelStyle } from './BottomPanel';
import { ClientCompletionPanel } from './ClientCompletionPanel';
import { TripPanel, statusText } from './TripPanel';
import { Avatar, Car, colors, Icon, km, money, shortAddress, tr } from './ui';
import { usePanelTransition } from './usePanelTransition';
import { useTheme } from './design/theme';
import { useWaiting, waitingClock } from './waiting';

import type { DriverLocation } from './types';
import type { DrivingRoute } from './navigation';
type Props = Omit<React.ComponentProps<typeof TripPanel>, 'onRating'> & { onRating: (score: number, comment?: string) => Promise<boolean>; onReset?: () => void; onHeight: (height: number) => void; driverPosition?: DriverLocation | null; trackingWaiting?: boolean; trackingStatus?: string; approach?: DrivingRoute | null };
export function splitKyrgyzPlate(value: string): { region: string; registration: string } | null {
  const match = value.trim().toUpperCase().match(/^(\d{2})\s*(?:(?:KG|КГ)\s*)?(\d{3})\s*([A-ZА-ЯЁ]{2,3})$/u);
  return match ? { region: match[1], registration: `${match[2]} ${match[3]}` } : null;
}
export function splitOldKyrgyzPlate(value: string): string | null {
  const match = value.trim().toUpperCase().match(/^([A-ZА-ЯЁ])\s*(\d{3})\s*([A-ZА-ЯЁ]{2})$/u);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : null;
}
export function ClientTripPanel({ order, user, busy, onAction, onChat, onDone, onReset, onRating, coming, onHeight, trackingStatus }: Props) {
  const { isDark } = useTheme();
  const accent = isDark ? '#FFFFFF' : colors.blue;
  const t = tr(user.language);
  const insets = useSafeAreaInsets();
  const { surface, navigate, onSheetClosed, reset, sheetClosing, rootVisible, rootTranslateY, onRootHeight } = usePanelTransition<'summary' | 'details' | 'cancel'>('summary');
  useEffect(() => { reset(); }, [order.id, order.status]);
  const waiting = useWaiting(order);
  const complete = order.status === 'COMPLETED';
  if (complete) return <ClientCompletionPanel order={order} user={user} busy={busy} onDone={onDone} onRating={onRating} onHeight={onHeight}/>;
  const ended = ['COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(order.status);
  const searching = order.status === 'SEARCHING';
  const delivery = order.kind !== undefined && order.kind !== 'RIDE';
  const deliveryStatus:Partial<Record<typeof order.status,string>>={SEARCHING:'Ищем водителя для доставки',ASSIGNED:'Водитель едет за грузом',ARRIVED:'Водитель прибыл за грузом',IN_PROGRESS:'Груз в пути',CANCELLED:'Доставка отменена',NO_DRIVER:'Водитель не найден'};
  const vehicle = order.driver?.driverProfile;
  const plateParts = vehicle?.carPlate ? splitKyrgyzPlate(vehicle.carPlate) : null;
  const oldPlate = vehicle?.carPlate && !plateParts ? splitOldKyrgyzPlate(vehicle.carPlate) : null;
  const close = () => navigate('summary');
  const route = <View style={[c.route, isDark && c.darkRoute]}>{([['person', order.pickup.address], ['flag', order.dropoff.address]] as const).map(([icon, address]) => <View key={icon} style={c.routeRow}><Icon name={icon} size={18} color={isDark ? '#FFFFFF' : undefined}/><Text style={[c.text, isDark && c.darkInk]} numberOfLines={1}>{shortAddress(address)}</Text></View>)}</View>;
  const button = (label: string, action: () => void, secondary = false, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={action} style={[c.button, isDark && c.darkButton, secondary && c.secondary, isDark && secondary && c.darkSecondary, (busy || disabled) && { opacity: .55 }]}><Text style={[c.buttonText, isDark && c.darkButtonText, secondary && { color: isDark ? '#FFFFFF' : colors.ink }]}>{t(label)}</Text></Pressable>;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
    <Animated.View pointerEvents={rootVisible ? 'auto' : 'none'} accessibilityElementsHidden={surface !== 'summary'} onLayout={event => { const measured = event.nativeEvent.layout.height; onRootHeight(measured); onHeight(measured); }} importantForAccessibility={surface === 'summary' ? 'auto' : 'no-hide-descendants'} style={[panelStyle.surface, c.surface, isDark && c.darkSurface, { paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY: rootTranslateY }] }]}>
      <View style={c.heading}><View style={{ flex: 1, gap: 5 }}><Text style={[c.title, isDark && c.darkInk]}>{t(delivery ? deliveryStatus[order.status] || statusText[order.status] : statusText[order.status])}</Text>{searching && <Text style={[c.caption, isDark && c.darkMuted]}>{t(delivery ? 'Предлагаем доставку подходящим водителям' : 'Предлагаем заказ свободным водителям')}</Text>}{order.status === 'ASSIGNED' && <Text style={[c.caption, isDark && c.darkMuted]}>{t(delivery ? 'Водитель направляется к адресу отправки' : 'Водитель направляется к месту подачи')}</Text>}</View>{searching ? <ActivityIndicator color={accent}/> : ended ? <Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} disabled={busy} onPress={onReset ?? onDone} style={c.icon}><Icon name="close-circle-outline" color={accent} size={34}/></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={t(delivery ? 'Детали доставки' : 'Детали поездки')} onPress={() => navigate('details')} style={c.icon}><Icon name="ellipsis-horizontal" color={isDark ? '#FFFFFF' : undefined}/></Pressable>}</View>
      {searching || ended ? <>{route}<View style={c.fare}><Icon name="cash-outline" color={accent} size={24}/><Text style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{t('Наличные')} · {order.tariff?.name}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(order.price)}</Text></View></> : <>
        <View style={c.vehicle}><View style={{ flex: 1, gap: 8 }}>
          {vehicle?.carPlate ? <View testID="client-vehicle-plate" accessibilityLabel={`Номер автомобиля ${vehicle.carPlate}`} style={[c.plateFrame, isDark && c.darkPlateFrame, oldPlate && c.oldPlateFrame]}>
            {plateParts ? <><View style={c.plateCountry}><Text style={[c.plateRegion, isDark && c.darkInk]}>{plateParts.region}</Text><View style={c.plateCountryRow}><Text style={c.plateFlag}>🇰🇬</Text><Text style={[c.plateCountryCode, isDark && c.darkMuted]}>KG</Text></View></View><View style={[c.plateDivider, isDark && c.darkPlateDivider]}/><Text numberOfLines={1} adjustsFontSizeToFit style={[c.plateRegistration, isDark && c.darkInk]}>{plateParts.registration}</Text></>
              : oldPlate ? <><View testID="client-old-plate-flag" style={c.oldPlateFlag}><Text style={c.oldPlateFlagIcon}>🇰🇬</Text></View><Text numberOfLines={1} adjustsFontSizeToFit style={[c.oldPlateRegistration, isDark && c.darkInk]}>{oldPlate}</Text></>
              : <Text numberOfLines={1} adjustsFontSizeToFit style={[c.plateRegistration, isDark && c.darkInk]}>{vehicle.carPlate}</Text>}
          </View> : <Text style={[c.platePlaceholder, isDark && c.darkInk]}>{t('Автомобиль')}</Text>}
          <Text style={[c.text, isDark && c.darkInk]} numberOfLines={1}>{vehicle ? [vehicle.carColor, vehicle.carMake].filter(Boolean).join(' ') : t('Данные водителя загружаются')}</Text>
        </View><Car size={112}/></View>
        {order.driver && <View style={c.driver}><Avatar user={order.driver} size={42}/><View style={{ flex: 1, gap: 3 }}><Text style={[c.text, isDark && c.darkInk]}>{order.driver.name || t('Водитель')}</Text>{vehicle?.rating != null && <Text style={[c.caption, isDark && c.darkMuted]}>★ {Number(vehicle.rating).toFixed(1)}</Text>}</View><Pressable accessibilityRole="button" accessibilityLabel={t('Позвонить')} disabled={!order.driver.phone} onPress={() => { if (order.driver?.phone) void Linking.openURL('tel:' + order.driver.phone); }} style={[c.contact, isDark && c.darkContact]}><Icon name="call-outline" color={accent}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('Чат')} onPress={onChat} style={[c.contact, isDark && c.darkContact]}><Icon name="chatbubble-outline" color={accent}/></Pressable></View>}
        {waiting && <View testID="client-waiting-card" style={[c.waiting, isDark && c.darkWaiting]}><Icon name="time-outline" size={29} color={isDark ? '#FFFFFF' : colors.ink}/><View style={c.waitingCopy}><Text style={[c.waitingTitle, isDark && c.darkInk]}>{t(waiting.phase === 'BEFORE_FREE' ? 'Ожидание начнётся через' : waiting.phase === 'FREE' ? 'Бесплатное ожидание' : 'Платное ожидание')} {waiting.phase === 'PAID' ? `· ${waiting.billedMinutes} ${t('мин')}` : `· ${waitingClock(waiting.remainingSeconds)}`}</Text><Text style={[c.waitingCaption, isDark && c.darkMuted]}>{waiting.phase === 'BEFORE_FREE' ? `${order.waiting?.freeMinutes ?? 5} ${t('мин бесплатно после начала')}` : waiting.phase === 'PAID' ? `+${money(waiting.charge)} · ${money(order.waiting?.pricePerMinute ?? 0)}/${t('мин')}` : `${t('Затем')} ${money(order.waiting?.pricePerMinute ?? 0)}/${t('мин')}`}</Text></View><View style={[c.waitingDivider, isDark && c.darkWaitingDivider]}/><Text numberOfLines={1} adjustsFontSizeToFit style={[c.waitingPrice, isDark && c.darkInk]}>{money(waiting.totalPrice)}</Text></View>}
        {order.status === 'IN_PROGRESS' && <View style={c.fare}><Icon name="flag" size={18} color={isDark ? '#FFFFFF' : undefined}/><Text numberOfLines={1} style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{shortAddress(order.dropoff.address)}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(order.price)}</Text></View>}
        {!!trackingStatus && <Text accessibilityRole="text" style={[c.caption, isDark && c.darkMuted]}>{t(trackingStatus)}</Text>}
      </>}
      {ended ? button('Заказать снова', onDone) : <>
        {order.status === 'ARRIVED' && button(coming ? 'Уже отправлено' : delivery ? 'Передаю груз' : 'Я выхожу', () => onAction('coming'), false, coming)}
        {searching ? button('Отменить заказ', () => navigate('cancel'), true) : order.status !== 'IN_PROGRESS' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => navigate('cancel')} style={c.cancel}><Text style={[c.caption, isDark && c.darkMuted]}>{t('Отменить заказ')}</Text></Pressable>}
      </>}
    </Animated.View>
    {surface !== 'summary' && <BottomPanel key={surface} closeRequested={sheetClosing} onClose={onSheetClosed} label={t('Закрыть')}><View style={c.detailBody}>
      <View style={c.heading}><Text style={[c.title, isDark && c.darkInk, { flex: 1 }]}>{t(surface === 'cancel' ? delivery ? 'Отменить доставку?' : 'Отменить поездку?' : delivery ? 'Детали доставки' : 'Детали поездки')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={close} style={c.icon}><Icon name="close" color={isDark ? '#FFFFFF' : undefined}/></Pressable></View>
      {route}
      {surface === 'cancel' ? <>{button('Продолжить ожидание', close)}{button('Отменить заказ', () => onAction('cancel'), true)}</> : <><View style={c.fare}><Text style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{t('Наличные')} · {km(order.distanceMeters)}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(waiting?.totalPrice ?? order.price)}</Text></View>{delivery && order.deliveryDetails?.goodsDescription && <Text style={[c.caption, isDark && c.darkMuted]}>{t('Груз')}: {order.deliveryDetails.goodsDescription}{order.deliveryDetails.doorToDoor ? ` · ${t('от двери до двери')}` : ''}</Text>}{!!order.comment && <Text style={[c.caption, isDark && c.darkMuted]}>{order.comment}</Text>}{button('Готово', close)}</>}
    </View></BottomPanel>}
  </View>;
}
const c = StyleSheet.create({
  surface: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: 9, paddingTop: 14 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 4 }, title: { color: colors.ink, fontSize: 22, fontWeight: '700' }, caption: { color: colors.muted, fontSize: 12, lineHeight: 17 }, text: { color: colors.ink, fontSize: 15, flexShrink: 1 },
  darkSurface: { backgroundColor: '#111111' }, darkInk: { color: '#FFFFFF' }, darkMuted: { color: '#B8B8B8' }, darkRoute: { borderColor: '#3A3A3A' },
  route: { gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line }, routeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, fare: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }, price: { fontSize: 19, fontWeight: '600', color: colors.ink },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 15, borderWidth: 1, borderColor: '#DCE8FA', backgroundColor: '#EAF3FF' }, waitingCopy: { flex: 1, gap: 3 }, waitingTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: colors.ink }, waitingCaption: { fontSize: 11, lineHeight: 16, color: colors.muted }, waitingDivider: { width: 1, height: 38, backgroundColor: '#CBD9EC' }, waitingPrice: { minWidth: 72, maxWidth: 94, textAlign: 'right', fontSize: 18, fontWeight: '800', color: colors.ink }, darkWaiting: { backgroundColor: '#242424', borderColor: '#424242' }, darkWaitingDivider: { backgroundColor: '#505050' },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }, plateFrame: { height: 55, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 9, borderRadius: 11, borderWidth: 1, borderColor: '#CAD8ED', backgroundColor: '#FFFFFF', shadowColor: '#7491B6', shadowOpacity: .13, shadowRadius: 7, shadowOffset: { width: 0, height: 2 }, elevation: 2 }, plateCountry: { width: 42, alignItems: 'center', justifyContent: 'center' }, plateRegion: { fontSize: 22, lineHeight: 25, fontWeight: '800', color: colors.ink }, plateCountryRow: { flexDirection: 'row', alignItems: 'center', gap: 2 }, plateFlag: { fontSize: 13, lineHeight: 16 }, plateCountryCode: { fontSize: 9, lineHeight: 12, fontWeight: '700', color: colors.muted }, plateDivider: { width: 1, height: 37, backgroundColor: '#B7C5DA', marginHorizontal: 8 }, plateRegistration: { flexShrink: 1, fontSize: 26, lineHeight: 32, fontWeight: '800', letterSpacing: 1, color: colors.ink }, oldPlateFrame: { height: 50 }, oldPlateFlag: { width: 36, height: 38, alignItems: 'center', justifyContent: 'center', marginRight: 10, backgroundColor: '#ED1C24' }, oldPlateFlagIcon: { fontSize: 26, lineHeight: 32 }, oldPlateRegistration: { flexShrink: 1, fontSize: 26, lineHeight: 32, fontWeight: '500', letterSpacing: .5, color: colors.ink }, platePlaceholder: { fontSize: 23, fontWeight: '700', color: colors.ink }, darkPlateFrame: { backgroundColor: '#242424', borderColor: '#5A5A5A', shadowOpacity: 0, elevation: 0 }, darkPlateDivider: { backgroundColor: '#696969' }, driver: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 }, contact: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F5FC' }, icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  darkContact: { backgroundColor: '#282828' },
  button: { minHeight: 52, borderRadius: 16, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 3 }, secondary: { backgroundColor: '#F0F2F5' }, buttonText: { color: 'white', fontSize: 16, fontWeight: '600' }, cancel: { paddingVertical: 9, alignItems: 'center' }, detailBody: { paddingHorizontal: 16, gap: 13, paddingBottom: 8 },
  darkButton: { backgroundColor: '#FFFFFF' }, darkButtonText: { color: '#050505' }, darkSecondary: { backgroundColor: '#303030', borderWidth: 1, borderColor: '#555555' },
});
