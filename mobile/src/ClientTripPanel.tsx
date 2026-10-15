import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel, panelStyle } from './BottomPanel';
import { clientMapPanelStyle } from './clientMapPanelStyle';
import { ClientCompletionPanel } from './ClientCompletionPanel';
import { ClientOrderEndPanel } from './ClientOrderEndPanel';
import { TripPanel, statusText } from './TripPanel';
import { Avatar, Car, colors, Icon, km, money, shortAddress, tr } from './ui';
import { usePanelTransition } from './usePanelTransition';
import { useTheme } from './design/theme';
import { useWaiting, waitingClock } from './waiting';
import { fonts } from './design/typography';
import { TripContactButton } from './TripContactButton';
import { api } from './api';

import type { DriverLocation, DriverProfile } from './types';
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
function TripVehicleImage({ vehicle }: { vehicle?: DriverProfile | null }) {
  const photo = vehicle?.carPhotoUrl;
  const uri = photo ? /^https?:\/\//i.test(photo) ? photo : `${api.baseUrl}/${photo.replace(/^\/+/, '')}` : null;
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [uri]);
  return <View style={c.vehicleImage}>
    {uri && !failed ? <Image source={{ uri, ...(uri.startsWith(`${api.baseUrl}/`) && api.getTokens()?.accessToken ? { headers: { Authorization: `Bearer ${api.getTokens()?.accessToken}` } } : {}) }}
      resizeMode="contain" style={c.vehiclePhoto} accessibilityLabel={vehicle?.carMake} onError={() => setFailed(true)}/>
      : <Car size={120} color={vehicle?.transportClass === 'COMFORT' ? '#67788D' : undefined}/>}
  </View>;
}
export function ClientTripPanel({ order, user, busy, onAction, onChat, onDone, onReset, onRating, coming, onHeight, trackingStatus }: Props) {
  const { isDark } = useTheme();
  const accent = isDark ? '#FFFFFF' : colors.blue;
  const t = tr(user.language);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const horizontalPadding = Math.max(16, 20 * Math.min(1, width / 432));
  const { surface, navigate, onSheetClosed, reset, sheetClosing, rootVisible, rootTranslateY, onRootHeight } = usePanelTransition<'summary' | 'details' | 'cancel'>('summary');
  useEffect(() => { reset(); }, [order.id, order.status]);
  const waiting = useWaiting(order);
  const complete = order.status === 'COMPLETED';
  if (complete) return <ClientCompletionPanel order={order} user={user} busy={busy} onDone={onDone} onRating={onRating} onHeight={onHeight}/>;
  if (order.status === 'CANCELLED' || order.status === 'NO_DRIVER') return <ClientOrderEndPanel key={`${order.id}:${order.status}`} order={order} user={user} busy={busy} onRetry={onDone} onClose={onReset ?? onDone} onHeight={onHeight}/>;
  const ended = ['COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(order.status);
  const searching = order.status === 'SEARCHING';
  const delivery = order.kind !== undefined && order.kind !== 'RIDE';
  const deliveryStatus:Partial<Record<typeof order.status,string>>={SEARCHING:'Ищем водителя для доставки',ASSIGNED:'Водитель едет за грузом',ARRIVED:'Водитель прибыл за грузом',IN_PROGRESS:'Груз в пути'};
  const vehicle = order.driver?.driverProfile;
  const plateParts = vehicle?.carPlate ? splitKyrgyzPlate(vehicle.carPlate) : null;
  const oldPlate = vehicle?.carPlate && !plateParts ? splitOldKyrgyzPlate(vehicle.carPlate) : null;
  const close = () => navigate('summary');
  const route = <View style={[c.route, isDark && c.darkRoute]}>{([['person', order.pickup.address], ['flag', order.dropoff.address]] as const).map(([icon, address]) => <View key={icon} style={c.routeRow}><Icon name={icon} size={18} color={isDark ? '#FFFFFF' : undefined}/><Text style={[c.text, isDark && c.darkInk]} numberOfLines={1}>{shortAddress(address)}</Text></View>)}</View>;
  const button = (label: string, action: () => void, secondary = false, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={action} style={[c.button, isDark && c.darkButton, secondary && c.secondary, isDark && secondary && c.darkSecondary, (busy || disabled) && { opacity: .55 }]}><Text style={[c.buttonText, isDark && c.darkButtonText, secondary && { color: isDark ? '#FFFFFF' : colors.ink }]}>{t(label)}</Text></Pressable>;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
    <Animated.View pointerEvents={rootVisible ? 'auto' : 'none'} accessibilityElementsHidden={surface !== 'summary'} onLayout={event => { const measured = event.nativeEvent.layout.height; onRootHeight(measured); onHeight(measured); }} importantForAccessibility={surface === 'summary' ? 'auto' : 'no-hide-descendants'} testID="client-trip-panel" style={[panelStyle.surface, c.surface, clientMapPanelStyle.surface, isDark && c.darkSurface, { paddingLeft: Math.max(insets.left, horizontalPadding), paddingRight: Math.max(insets.right, horizontalPadding), paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY: rootTranslateY }] }]}>
      <ScrollView testID="client-trip-content" style={clientMapPanelStyle.scroll} contentContainerStyle={c.content} nestedScrollEnabled keyboardShouldPersistTaps="handled" bounces={false}>
      <View style={c.heading}><View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={[c.title, isDark && c.darkInk]}>{t(delivery ? deliveryStatus[order.status] || statusText[order.status] : statusText[order.status])}</Text>{searching && <Text style={[c.caption, isDark && c.darkMuted]}>{t(delivery ? 'Предлагаем доставку подходящим водителям' : 'Предлагаем заказ свободным водителям')}</Text>}{order.status === 'ASSIGNED' && <Text style={[c.caption, isDark && c.darkMuted]}>{t(delivery ? 'Водитель направляется к адресу отправки' : 'Водитель направляется к месту подачи')}</Text>}</View>{searching ? <ActivityIndicator color={accent}/> : ended ? <Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} disabled={busy} onPress={onReset ?? onDone} style={c.icon}><Icon name="close-circle-outline" color={accent} size={34}/></Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={t(delivery ? 'Детали доставки' : 'Детали поездки')} onPress={() => navigate('details')} style={c.icon}><Icon name="ellipsis-horizontal" size={22} color={isDark ? '#FFFFFF' : '#1E2028'}/></Pressable>}</View>
      {searching || ended ? <>{route}<View style={c.fare}><Icon name="cash-outline" color={accent} size={24}/><Text style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{t('Наличные')} · {order.tariff?.name}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(order.price)}</Text></View></> : <>
        <View style={c.vehicleBlock}><View style={c.vehicle}><View style={{ flex: 1, minWidth: 0 }}>
          {vehicle?.carPlate ? <View testID="client-vehicle-plate" accessibilityLabel={`Номер автомобиля ${vehicle.carPlate}`} style={[c.plateFrame, isDark && c.darkPlateFrame, oldPlate && c.oldPlateFrame]}>
            {plateParts ? <><View style={c.plateCountry}><Text style={[c.plateRegion, isDark && c.darkInk]}>{plateParts.region}</Text><View style={c.plateCountryRow}><Image source={require('../assets/flag.jpg')} accessibilityLabel="Флаг Кыргызстана" resizeMode="cover" style={c.plateFlag}/><Text style={[c.plateCountryCode, isDark && c.darkMuted]}>KG</Text></View></View><View style={[c.plateDivider, isDark && c.darkPlateDivider]}/><Text numberOfLines={1} adjustsFontSizeToFit style={[c.plateRegistration, isDark && c.darkInk]}>{plateParts.registration.replace(/ /g, '\u00a0')}</Text></>
              : oldPlate ? <><View testID="client-old-plate-flag" style={c.oldPlateFlag}><Image source={require('../assets/flag.jpg')} accessibilityLabel="Флаг Кыргызстана" resizeMode="cover" style={c.oldPlateFlagIcon}/></View><Text numberOfLines={1} adjustsFontSizeToFit style={[c.oldPlateRegistration, isDark && c.darkInk]}>{oldPlate.replace(/ /g, '\u00a0')}</Text></>
              : <Text numberOfLines={1} adjustsFontSizeToFit style={[c.plateRegistration, isDark && c.darkInk]}>{vehicle.carPlate.replace(/ /g, '\u00a0')}</Text>}
          </View> : <Text style={[c.platePlaceholder, isDark && c.darkInk]}>{t('Автомобиль')}</Text>}
        </View><TripVehicleImage vehicle={vehicle}/></View>
          <Text style={[c.text, isDark && c.darkInk]}>{vehicle ? [vehicle.carColor, vehicle.carMake].filter(Boolean).join(' ') : t('Данные водителя загружаются')}</Text>
        </View>
        {order.driver && <View style={c.driver}><Avatar user={order.driver} size={44} fallbackBackground={isDark ? '#292929' : '#EFF0F3'} fallbackColor={isDark ? '#FFFFFF' : '#1E2028'}/><View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={[c.text, isDark && c.darkInk]}>{order.driver.name || t('Водитель')}</Text>{vehicle?.rating != null && <View style={c.rating}><Icon name="star" size={12} color={isDark ? '#B8B8B8' : '#737B8C'}/><Text style={[c.caption, isDark && c.darkMuted]}>{Number(vehicle.rating).toFixed(1)}</Text></View>}</View><TripContactButton kind="call" label={t('Позвонить')} disabled={!order.driver.phone} onPress={() => { if (order.driver?.phone) void Linking.openURL('tel:' + order.driver.phone); }}/><TripContactButton kind="chat" label={t('Чат')} onPress={onChat}/></View>}
        {waiting && <View testID="client-waiting-card" style={[c.waiting, isDark && c.darkWaiting]}><Icon name="time-outline" size={29} color={isDark ? '#FFFFFF' : colors.ink}/><View style={c.waitingCopy}><Text style={[c.waitingTitle, isDark && c.darkInk]}>{t(waiting.phase === 'BEFORE_FREE' ? 'Ожидание начнётся через' : waiting.phase === 'FREE' ? 'Бесплатное ожидание' : 'Платное ожидание')} {waiting.phase === 'PAID' ? `· ${waiting.billedMinutes} ${t('мин')}` : `· ${waitingClock(waiting.remainingSeconds)}`}</Text><Text style={[c.waitingCaption, isDark && c.darkMuted]}>{waiting.phase === 'BEFORE_FREE' ? `${order.waiting?.freeMinutes ?? 5} ${t('мин бесплатно после начала')}` : waiting.phase === 'PAID' ? `+${money(waiting.charge)} · ${money(order.waiting?.pricePerMinute ?? 0)}/${t('мин')}` : `${t('Затем')} ${money(order.waiting?.pricePerMinute ?? 0)}/${t('мин')}`}</Text></View><View style={[c.waitingDivider, isDark && c.darkWaitingDivider]}/><Text numberOfLines={1} adjustsFontSizeToFit style={[c.waitingPrice, isDark && c.darkInk]}>{money(waiting.totalPrice)}</Text></View>}
        {order.status === 'IN_PROGRESS' && <View style={c.fare}><Icon name="flag" size={18} color={isDark ? '#FFFFFF' : undefined}/><Text numberOfLines={1} style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{shortAddress(order.dropoff.address)}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(order.price)}</Text></View>}
        {!!trackingStatus && <Text accessibilityRole="text" style={[c.caption, isDark && c.darkMuted]}>{t(trackingStatus)}</Text>}
      </>}
      </ScrollView>
      {ended ? button('Заказать снова', onDone) : <>
        {order.status === 'ARRIVED' && button(coming ? 'Уже отправлено' : delivery ? 'Передаю груз' : 'Я выхожу', () => onAction('coming'), false, coming)}
        {searching ? button('Отменить заказ', () => navigate('cancel'), true) : order.status !== 'IN_PROGRESS' && <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => navigate('cancel')} style={({ pressed }) => [c.cancel, (pressed || busy) && { opacity: busy ? .4 : .65 }]}><Text style={[c.cancelText, isDark && c.darkMuted]}>{t('Отменить заказ')}</Text></Pressable>}
      </>}
    </Animated.View>
    {surface !== 'summary' && <BottomPanel key={surface} closeRequested={sheetClosing} onClose={onSheetClosed} label={t('Закрыть')}><ScrollView style={clientMapPanelStyle.scroll} contentContainerStyle={c.detailBody} keyboardShouldPersistTaps="handled" bounces={false}>
      <View style={c.heading}><Text style={[c.title, isDark && c.darkInk, { flex: 1 }]}>{t(surface === 'cancel' ? delivery ? 'Отменить доставку?' : 'Отменить поездку?' : delivery ? 'Детали доставки' : 'Детали поездки')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={close} style={c.icon}><Icon name="close" color={isDark ? '#FFFFFF' : undefined}/></Pressable></View>
      {route}
      {surface === 'cancel' ? <>{button('Продолжить ожидание', close)}{button('Отменить заказ', () => onAction('cancel'), true)}</> : <><View style={c.fare}><Text style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{t('Наличные')} · {km(order.distanceMeters)}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(waiting?.totalPrice ?? order.price)}</Text></View>{delivery && order.deliveryDetails?.goodsDescription && <Text style={[c.caption, isDark && c.darkMuted]}>{t('Груз')}: {order.deliveryDetails.goodsDescription}{order.deliveryDetails.doorToDoor ? ` · ${t('от двери до двери')}` : ''}</Text>}{!!order.comment && <Text style={[c.caption, isDark && c.darkMuted]}>{order.comment}</Text>}{button('Готово', close)}</>}
    </ScrollView></BottomPanel>}
  </View>;
}
const c = StyleSheet.create({
  content: { gap: 14 },
  surface: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: 4, paddingTop: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24, shadowOpacity: 0, elevation: 0 },
  heading: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  title: { color: '#1E2028', fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23, letterSpacing: -.35 },
  caption: { color: '#737B8C', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  text: { color: '#1E2028', fontFamily: fonts.regular, fontSize: 14, lineHeight: 19, flexShrink: 1 },
  darkSurface: { backgroundColor: '#111111' }, darkInk: { color: '#FFFFFF' }, darkMuted: { color: '#B8B8B8' }, darkRoute: { borderColor: '#3A3A3A' },
  route: { gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line }, routeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  fare: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }, price: { fontFamily: fonts.semibold, fontSize: 19, color: '#1E2028' },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 13, borderRadius: 15, borderWidth: 1, borderColor: '#DCE8FA', backgroundColor: '#EAF3FF' }, waitingCopy: { flex: 1, gap: 3 }, waitingTitle: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18, color: '#1E2028' }, waitingCaption: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, color: '#737B8C' }, waitingDivider: { width: 1, height: 38, backgroundColor: '#CBD9EC' }, waitingPrice: { minWidth: 72, maxWidth: 94, textAlign: 'right', fontFamily: fonts.extraBold, fontSize: 18, color: '#1E2028' }, darkWaiting: { backgroundColor: '#242424', borderColor: '#424242' }, darkWaitingDivider: { backgroundColor: '#505050' },
  vehicleBlock: { gap: 3 }, vehicle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vehicleImage: { width: 100, height: 39, alignItems: 'center', justifyContent: 'center' }, vehiclePhoto: { width: 100, height: 39 },
  plateFrame: { width: 178, height: 39, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingLeft: 8, paddingRight: 16, borderRadius: 7, borderWidth: 1, borderColor: '#D3D8E1', backgroundColor: '#FDFDFE' },
  plateCountry: { width: 34, alignItems: 'center', justifyContent: 'center' }, plateRegion: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 17, color: '#1E2028' },
  plateCountryRow: { flexDirection: 'row', alignItems: 'center', gap: 2 }, plateFlag: { width: 14, height: 9, borderRadius: 1, overflow: 'hidden' }, plateCountryCode: { fontFamily: fonts.medium, fontSize: 9, lineHeight: 11, color: '#737B8C' },
  plateDivider: { width: 1, height: 29, backgroundColor: '#ACB2BF', marginLeft: 10, marginRight: 15 }, plateRegistration: { flex: 1, fontFamily: fonts.semibold, fontSize: 22, lineHeight: 27, letterSpacing: .4, color: '#1E2028' },
  oldPlateFrame: { height: 39 }, oldPlateFlag: { width: 27, height: 29, alignItems: 'center', justifyContent: 'center', marginRight: 8 }, oldPlateFlagIcon: { width: 24, height: 15, borderRadius: 2, overflow: 'hidden' }, oldPlateRegistration: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 21, lineHeight: 27, letterSpacing: .4, color: '#1E2028' },
  platePlaceholder: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 23, color: '#1E2028' }, darkPlateFrame: { backgroundColor: '#242424', borderColor: '#5A5A5A' }, darkPlateDivider: { backgroundColor: '#696969' },
  driver: { flexDirection: 'row', alignItems: 'center', gap: 12 }, rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -6, marginTop: -4 },
  button: { minHeight: 52, borderRadius: 16, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 3 }, secondary: { backgroundColor: '#F0F2F5' }, buttonText: { color: 'white', fontFamily: fonts.semibold, fontSize: 16 },
  cancel: { minHeight: 44, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' }, cancelText: { color: '#737B8C', fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  detailBody: { paddingHorizontal: 16, gap: 13, paddingBottom: 8 }, darkButton: { backgroundColor: '#FFFFFF' }, darkButtonText: { color: '#050505' }, darkSecondary: { backgroundColor: '#303030', borderWidth: 1, borderColor: '#555555' },
});
