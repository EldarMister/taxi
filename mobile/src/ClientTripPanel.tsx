import React, { useEffect } from 'react';
import { ActivityIndicator, Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel, panelStyle } from './BottomPanel';
import { ClientCompletionPanel } from './ClientCompletionPanel';
import { TripPanel, statusText } from './TripPanel';
import { Avatar, Car, colors, Icon, km, money, shortAddress, tr } from './ui';
import { usePanelTransition } from './usePanelTransition';
import { useTheme } from './design/theme';

import type { DriverLocation } from './types';
import type { DrivingRoute } from './navigation';
type Props = Omit<React.ComponentProps<typeof TripPanel>, 'onRating'> & { onRating: (score: number, comment?: string) => Promise<boolean>; onHeight: (height: number) => void; driverPosition?: DriverLocation | null; trackingWaiting?: boolean; trackingStatus?: string; approach?: DrivingRoute | null };
export function ClientTripPanel({ order, user, busy, onAction, onChat, onDone, onRating, coming, onHeight, trackingStatus }: Props) {
  const { isDark } = useTheme();
  const accent = isDark ? '#FFFFFF' : colors.blue;
  const t = tr(user.language);
  const insets = useSafeAreaInsets();
  const { surface, navigate, onSheetClosed, reset, sheetClosing, rootVisible, rootTranslateY, onRootHeight } = usePanelTransition<'summary' | 'details' | 'cancel'>('summary');
  useEffect(() => { reset(); }, [order.id, order.status]);
  const complete = order.status === 'COMPLETED';
  if (complete) return <ClientCompletionPanel order={order} user={user} busy={busy} onDone={onDone} onRating={onRating} onHeight={onHeight}/>;
  const ended = ['COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(order.status);
  const searching = order.status === 'SEARCHING';
  const vehicle = order.driver?.driverProfile;
  const close = () => navigate('summary');
  const route = <View style={[c.route, isDark && c.darkRoute]}>{([['person', order.pickup.address], ['flag', order.dropoff.address]] as const).map(([icon, address]) => <View key={icon} style={c.routeRow}><Icon name={icon} size={18} color={isDark ? '#FFFFFF' : undefined}/><Text style={[c.text, isDark && c.darkInk]} numberOfLines={1}>{shortAddress(address)}</Text></View>)}</View>;
  const button = (label: string, action: () => void, secondary = false, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy || disabled }} disabled={busy || disabled} onPress={action} style={[c.button, isDark && c.darkButton, secondary && c.secondary, isDark && secondary && c.darkSecondary, (busy || disabled) && { opacity: .55 }]}><Text style={[c.buttonText, isDark && c.darkButtonText, secondary && { color: isDark ? '#FFFFFF' : colors.ink }]}>{t(label)}</Text></Pressable>;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
    <Animated.View pointerEvents={rootVisible ? 'auto' : 'none'} accessibilityElementsHidden={surface !== 'summary'} onLayout={event => { const measured = event.nativeEvent.layout.height; onRootHeight(measured); onHeight(measured); }} importantForAccessibility={surface === 'summary' ? 'auto' : 'no-hide-descendants'} style={[panelStyle.surface, c.surface, isDark && c.darkSurface, { paddingBottom: Math.max(insets.bottom, 12), transform: [{ translateY: rootTranslateY }] }]}>
      <View style={c.heading}><View style={{ flex: 1, gap: 5 }}><Text style={[c.title, isDark && c.darkInk]}>{t(statusText[order.status])}</Text>{searching && <Text style={[c.caption, isDark && c.darkMuted]}>{t('Предлагаем заказ свободным водителям')}</Text>}{order.status === 'ASSIGNED' && <Text style={[c.caption, isDark && c.darkMuted]}>{t('Водитель направляется к месту подачи')}</Text>}</View>{searching ? <ActivityIndicator color={accent}/> : ended ? <Icon name="close-circle-outline" color={accent} size={34}/> : <Pressable accessibilityRole="button" accessibilityLabel={t('Детали поездки')} onPress={() => navigate('details')} style={c.icon}><Icon name="ellipsis-horizontal" color={isDark ? '#FFFFFF' : undefined}/></Pressable>}</View>
      {searching || ended ? <>{route}<View style={c.fare}><Icon name="cash-outline" color={accent} size={24}/><Text style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{t('Наличные')} · {order.tariff?.name}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(order.price)}</Text></View></> : <>
        <View style={c.vehicle}><View style={{ flex: 1, gap: 6 }}><Text style={[c.plate, isDark && c.darkInk]}>{vehicle?.carPlate || t('Автомобиль')}</Text><Text style={[c.text, isDark && c.darkInk]}>{vehicle ? vehicle.carColor + ' ' + vehicle.carMake : t('Данные водителя загружаются')}</Text></View><Car size={112}/></View>
        {order.driver && <View style={c.driver}><Avatar user={order.driver} size={42}/><View style={{ flex: 1, gap: 3 }}><Text style={[c.text, isDark && c.darkInk]}>{order.driver.name || t('Водитель')}</Text>{vehicle?.rating != null && <Text style={[c.caption, isDark && c.darkMuted]}>★ {Number(vehicle.rating).toFixed(1)}</Text>}</View><Pressable accessibilityRole="button" accessibilityLabel={t('Позвонить')} disabled={!order.driver.phone} onPress={() => { if (order.driver?.phone) void Linking.openURL('tel:' + order.driver.phone); }} style={[c.contact, isDark && c.darkContact]}><Icon name="call-outline" color={accent}/></Pressable><Pressable accessibilityRole="button" accessibilityLabel={t('Чат')} onPress={onChat} style={[c.contact, isDark && c.darkContact]}><Icon name="chatbubble-outline" color={accent}/></Pressable></View>}
        {order.status === 'IN_PROGRESS' && <View style={c.fare}><Icon name="flag" size={18} color={isDark ? '#FFFFFF' : undefined}/><Text numberOfLines={1} style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{shortAddress(order.dropoff.address)}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(order.price)}</Text></View>}
        {!!trackingStatus && <Text accessibilityRole="text" style={[c.caption, isDark && c.darkMuted]}>{t(trackingStatus)}</Text>}
      </>}
      {ended ? button('Заказать снова', onDone) : <>
        {order.status === 'ARRIVED' && button(coming ? 'Уже отправлено' : 'Я выхожу', () => onAction('coming'), false, coming)}
        {searching ? button('Отменить заказ', () => navigate('cancel'), true) : order.status !== 'IN_PROGRESS' && <Pressable accessibilityRole="button" disabled={busy} onPress={() => navigate('cancel')} style={c.cancel}><Text style={[c.caption, isDark && c.darkMuted]}>{t('Отменить заказ')}</Text></Pressable>}
      </>}
    </Animated.View>
    {surface !== 'summary' && <BottomPanel key={surface} closeRequested={sheetClosing} onClose={onSheetClosed} label={t('Закрыть')}><View style={c.detailBody}>
      <View style={c.heading}><Text style={[c.title, isDark && c.darkInk, { flex: 1 }]}>{t(surface === 'cancel' ? 'Отменить поездку?' : 'Детали поездки')}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Закрыть')} onPress={close} style={c.icon}><Icon name="close" color={isDark ? '#FFFFFF' : undefined}/></Pressable></View>
      {route}
      {surface === 'cancel' ? <>{button('Продолжить ожидание', close)}{button('Отменить заказ', () => onAction('cancel'), true)}</> : <><View style={c.fare}><Text style={[c.text, isDark && c.darkInk, { flex: 1 }]}>{t('Наличные')} · {km(order.distanceMeters)}</Text><Text style={[c.price, isDark && c.darkInk]}>{money(order.price)}</Text></View>{!!order.comment && <Text style={[c.caption, isDark && c.darkMuted]}>{order.comment}</Text>}{button('Готово', close)}</>}
    </View></BottomPanel>}
  </View>;
}
const c = StyleSheet.create({
  surface: { position: 'absolute', bottom: 0, left: 0, right: 0, gap: 9, paddingTop: 14 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 4 }, title: { color: colors.ink, fontSize: 22, fontWeight: '700' }, caption: { color: colors.muted, fontSize: 12, lineHeight: 17 }, text: { color: colors.ink, fontSize: 15, flexShrink: 1 },
  darkSurface: { backgroundColor: '#111111' }, darkInk: { color: '#FFFFFF' }, darkMuted: { color: '#B8B8B8' }, darkRoute: { borderColor: '#3A3A3A' },
  route: { gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line }, routeRow: { flexDirection: 'row', alignItems: 'center', gap: 14 }, fare: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 }, price: { fontSize: 19, fontWeight: '600', color: colors.ink },
  vehicle: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }, plate: { fontSize: 26, fontWeight: '700', color: colors.ink }, driver: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 9 }, contact: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F5FC' }, icon: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  darkContact: { backgroundColor: '#282828' },
  button: { minHeight: 52, borderRadius: 16, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 3 }, secondary: { backgroundColor: '#F0F2F5' }, buttonText: { color: 'white', fontSize: 16, fontWeight: '600' }, cancel: { paddingVertical: 9, alignItems: 'center' }, detailBody: { paddingHorizontal: 16, gap: 13, paddingBottom: 8 },
  darkButton: { backgroundColor: '#FFFFFF' }, darkButtonText: { color: '#050505' }, darkSecondary: { backgroundColor: '#303030', borderWidth: 1, borderColor: '#555555' },
});
