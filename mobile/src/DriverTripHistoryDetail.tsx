import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from './design/theme';
import { historyLocale } from './driverHistory';
import { HistoryRouteMap } from './native/HistoryRouteMap';
import type { Order, User } from './types';
import { Icon, km, mins, money, Route, tr } from './ui';

const statusNames: Record<Order['status'], string> = { COMPLETED: 'Завершён', CANCELLED: 'Отменён', NO_DRIVER: 'Нет водителя', IN_PROGRESS: 'В пути', ASSIGNED: 'Найден', ARRIVED: 'Ожидание', SEARCHING: 'Поиск' };

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { palette } = useTheme();
  return <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.line }]}>
    <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.ink }]}>{title}</Text>{children}
  </View>;
}

function DetailRow({ label, value, selectable = false }: { label: string; value: string; selectable?: boolean }) {
  const { palette } = useTheme();
  return <View style={styles.row}><Text style={[styles.label, { color: palette.muted }]}>{label}</Text><Text selectable={selectable} style={[styles.value, { color: palette.ink }]}>{value}</Text></View>;
}

export function DriverTripHistoryDetail({ order, user, onBack, onError }: { order: Order; user: User; onBack: () => void; onError: (message: string) => void }) {
  const { palette, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [mapActive, setMapActive] = useState(false);
  const t = tr(user.language);
  const completed = order.status === 'COMPLETED';
  const unpaid = order.status === 'CANCELLED' || order.status === 'NO_DRIVER';
  const dateTime = (value: string) => new Date(value).toLocaleString(historyLocale(user.language), { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const signedMoney = (value: number) => value < 0 ? `−${money(Math.abs(value))}` : money(value);
  const passenger = order.passenger ?? order.client;
  const duration = completed ? order.actualDurationSeconds ?? order.durationSeconds : order.durationSeconds;

  return <View testID="driver-history-detail" style={[styles.screen, { backgroundColor: palette.background }]}>
    <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={palette.background}/>
    <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: palette.background }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Назад')} onPress={onBack} style={({ pressed }) => [styles.back, { opacity: pressed ? .5 : 1 }]}><Icon name="arrow-back" size={25} color={palette.ink}/></Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>{t('Детали поездки')}</Text>
    </View>
    <ScrollView testID="driver-history-detail-scroll" scrollEnabled={!mapActive} showsVerticalScrollIndicator={false} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
      <HistoryRouteMap order={order} language={user.language} onError={onError} onInteractionChange={setMapActive}/>
      <DetailCard title={t('Маршрут поездки')}><Route order={order} fullAddresses t={t}/><DetailRow label={t('Расстояние')} value={km(order.distanceMeters)}/></DetailCard>
      <DetailCard title={t('Информация о поездке')}>
        <DetailRow label={t('Номер заказа')} value={order.id} selectable/>
        <DetailRow label={t('Статус')} value={t(statusNames[order.status])}/>
        <DetailRow label={t('Время заказа')} value={dateTime(order.createdAt)}/>
        {order.completedAt && <DetailRow label={t('Время завершения')} value={dateTime(order.completedAt)}/>}
        <DetailRow label={t(completed && order.actualDurationSeconds != null ? 'Время в пути' : 'Расчётное время в пути')} value={mins(duration, user.language)}/>
        {order.tariff?.name ? <DetailRow label={t('Тариф')} value={t(order.tariff.name)}/> : null}
      </DetailCard>
      {passenger && <DetailCard title={t('Пассажир')}>
        {passenger.name ? <Text style={[styles.comment, { color: palette.ink }]}>{passenger.name}</Text> : null}
        {passenger.phone ? <Text selectable style={[styles.comment, { color: palette.muted }]}>{passenger.phone}</Text> : null}
      </DetailCard>}
      <DetailCard title={t('Оплата')}>
        <DetailRow label={t(completed ? 'Стоимость поездки' : 'Предварительная стоимость')} value={money(order.price)}/>
        {completed ? <>
          <DetailRow label={t('Способ оплаты')} value={t(order.paymentMethod === 'CARD' ? 'Картой' : 'Наличные')}/>
          {order.waiting && <><DetailRow label={t('Ожидание')} value={mins(order.waiting.billedMinutes * 60, user.language)}/><DetailRow label={t('Платное ожидание')} value={money(order.waiting.charge)}/></>}
          <DetailRow label={t('Комиссия сервиса')} value={order.commissionAmount == null ? '—' : signedMoney(order.commissionAmount)}/>
        </> : unpaid ? <Text style={[styles.comment, { color: palette.muted }]}>{t('Оплата не проводилась')}</Text> : null}
        <DetailRow label={t('Итого')} value={completed ? money(order.price) : unpaid ? money(0) : '—'}/>
      </DetailCard>
      {order.rating != null || order.driverRating != null ? <DetailCard title={t('Рейтинг')}>
        {order.rating != null && <DetailRow label={t('Оценка пассажира')} value={`${order.rating} / 5`}/>}
        {order.driverRating != null && <DetailRow label={t('Ваша оценка')} value={`${order.driverRating} / 5`}/>}
      </DetailCard> : null}
      {order.comment ? <DetailCard title={t('Комментарий')}><Text style={[styles.comment, { color: palette.ink }]}>{order.comment}</Text></DetailCard> : null}
      {order.deliveryDetails?.goodsDescription ? <DetailCard title={t('Груз')}><Text style={[styles.comment, { color: palette.ink }]}>{order.deliveryDetails.goodsDescription}</Text></DetailCard> : null}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: 'Inter_700Bold', fontSize: 20 },
  content: { padding: 16, gap: 14 },
  card: { padding: 17, borderWidth: 1, borderRadius: 20, gap: 14 },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  label: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  value: { flex: 1, textAlign: 'right', fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 19 },
  comment: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21 },
});
