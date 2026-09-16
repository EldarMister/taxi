import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from './design/theme';
import type { Order, User } from './types';
import { Avatar, Icon, km, mins, money, shortAddress, tr } from './ui';
import { HistoryRouteMap } from './native/HistoryRouteMap';

const statusNames: Record<Order['status'], string> = {
  COMPLETED: 'Завершён', CANCELLED: 'Отменён', IN_PROGRESS: 'В пути', ASSIGNED: 'Найден', ARRIVED: 'Ожидание', SEARCHING: 'Поиск', NO_DRIVER: 'Нет водителя',
};

function Status({ order, language }: { order: Order; language: User['language'] }) {
  const { isDark } = useTheme();
  const complete = order.status === 'COMPLETED';
  return <View style={[styles.status, { backgroundColor: complete ? isDark ? '#153628' : '#E5F8EE' : isDark ? '#292B30' : '#EFF2F6' }]}>
    <Text style={{ color: complete ? isDark ? '#7CE2A7' : '#178C50' : isDark ? '#D4D7DE' : '#68758A', fontSize: 12, fontWeight: '700' }}>{tr(language)(statusNames[order.status])}</Text>
  </View>;
}

function RoutePins() {
  const { palette } = useTheme();
  return <View style={styles.pins}><View style={styles.startDot}/><View style={styles.pinDash}/><Icon name="location" color={palette.ink} size={20}/></View>;
}

export function ClientHistoryRow({ order, user, onPress }: { order: Order; user: User; onPress: () => void }) {
  const { palette } = useTheme();
  const time = new Date(order.createdAt).toLocaleTimeString(user.language === 'ky' ? 'ky-KG' : 'ru-RU', { hour: '2-digit', minute: '2-digit' });
  return <Pressable accessibilityRole="button" accessibilityLabel={`${tr(user.language)('Детали поездки')}: ${order.pickup.address} — ${order.dropoff.address}`} onPress={onPress} style={({ pressed }) => [styles.listCard, { backgroundColor: palette.surface, borderColor: palette.line, opacity: pressed ? .72 : 1 }]}>
    <View style={styles.listTop}>
      <View style={[styles.listTimeColumn, { borderColor: palette.line }]}><Text style={[styles.listTime, { color: palette.ink }]}>{time}</Text></View>
      <View style={styles.listRoute}><RoutePins/><View style={{ flex: 1, justifyContent: 'space-between', gap: 6 }}><Text numberOfLines={1} style={[styles.listAddress, { color: palette.ink }]}>{shortAddress(order.pickup.address)}</Text><Text numberOfLines={1} style={[styles.listAddress, { color: palette.ink }]}>{shortAddress(order.dropoff.address)}</Text></View></View>
    </View>
    <View style={styles.listBottom}><Text style={[styles.listMeta, { color: palette.muted }]}>{km(order.distanceMeters)} · {mins(order.durationSeconds, user.language)}</Text><View style={styles.listBottomRight}><Status order={order} language={user.language}/><Text style={[styles.listFare, { color: palette.ink }]}>{money(order.status === 'CANCELLED' ? 0 : order.price)}</Text><Icon name="chevron-forward" size={18} color={palette.muted}/></View></View>
  </Pressable>;
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  const { palette } = useTheme();
  return <View style={[styles.detailCard, { backgroundColor: palette.surface, borderColor: palette.line }]}>{title && <Text style={[styles.cardTitle, { color: palette.ink }]}>{title}</Text>}{children}</View>;
}

function InfoRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const { palette } = useTheme();
  return <View style={styles.infoRow}><Text style={[styles.infoLabel, { color: palette.muted }]}>{label}</Text><Text style={[strong ? styles.infoStrong : styles.infoValue, { color: palette.ink }]} numberOfLines={2}>{value}</Text></View>;
}

export function ClientTripHistoryDetail({ order, user, onError }: { order: Order; user: User; onError: (message: string) => void }) {
  const { palette } = useTheme();
  const t = tr(user.language);
  const locale = user.language === 'ky' ? 'ky-KG' : 'ru-RU';
  const date = new Date(order.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const orderTime = new Date(order.createdAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const completedTime = order.completedAt ? new Date(order.completedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : null;
  const driver = order.driver;
  const car = driver?.driverProfile;
  const vehicle = [car?.carColor, car?.carMake].filter(Boolean).join(' ');
  const canCall = !!driver?.phone && order.status === 'COMPLETED';

  return <View style={styles.detailPage}>
    <HistoryRouteMap order={order} language={user.language} onError={onError}/>
    <Card>
      <View style={styles.detailRoute}><RoutePins/><View style={{ flex: 1, gap: 18 }}><Text style={[styles.detailAddress, { color: palette.ink }]}>{order.pickup.address}</Text><Text style={[styles.detailAddress, { color: palette.ink }]}>{order.dropoff.address}</Text></View></View>
      <View style={[styles.cardDivider, { backgroundColor: palette.line }]}/>
      <Text style={[styles.routeMeta, { color: palette.muted }]}>{km(order.distanceMeters)} · {mins(order.durationSeconds, user.language)}</Text>
    </Card>
    {driver && <Card title={t('Ваш водитель')}>
      <View style={styles.driverRow}><Avatar user={driver} size={50}/><View style={{ flex: 1, gap: 5 }}><Text style={[styles.driverName, { color: palette.ink }]}>{driver.name || t('Водитель')}</Text>{car?.rating != null && <View style={styles.rating}><Icon name="star" size={16} color="#EBAF26"/><Text style={[styles.ratingText, { color: palette.ink }]}>{Number(car.rating).toFixed(1)}</Text></View>}</View>
        {canCall && <Pressable accessibilityRole="button" accessibilityLabel={t('Позвонить')} onPress={() => void Linking.openURL(`tel:${driver.phone}`).catch(() => onError(t('Не удалось позвонить')))} style={[styles.call, { backgroundColor: palette.elevated, borderColor: palette.line }]}><Icon name="call" color={palette.ink} size={20}/></Pressable>}
      </View>
      {!!vehicle && <Text style={[styles.vehicleText, { color: palette.muted }]}>{vehicle}</Text>}
      {!!car?.carPlate && <View style={[styles.plate, { backgroundColor: palette.elevated }]}><Text style={[styles.plateText, { color: palette.ink }]}>{car.carPlate}</Text></View>}
    </Card>}
    <Card title={t('Информация о поездке')}>
      <InfoRow label={t('Дата')} value={date}/>
      <InfoRow label={t('Время заказа')} value={orderTime}/>
      {completedTime && <InfoRow label={t('Время завершения')} value={completedTime}/>}
      <InfoRow label={t('Расстояние')} value={km(order.distanceMeters)}/>
      <InfoRow label={t('Расчётное время в пути')} value={mins(order.durationSeconds, user.language)}/>
      <View style={styles.infoRow}><Text style={[styles.infoLabel, { color: palette.muted }]}>{t('Статус')}</Text><Status order={order} language={user.language}/></View>
    </Card>
    <Card title={t('Оплата')}>
      <InfoRow label={t(order.status === 'COMPLETED' ? 'Стоимость поездки' : 'Предварительная стоимость')} value={money(order.price)}/>
      {order.status === 'COMPLETED' ? <><InfoRow label={t('Способ оплаты')} value={t('Наличные')}/><View style={[styles.cardDivider, { backgroundColor: palette.line }]}/><InfoRow label={t('Итого')} value={money(order.price)} strong/></> : <Text style={[styles.noPayment, { color: palette.muted }]}>{t('Оплата не проводилась')}</Text>}
    </Card>
    {order.rating != null && <Card title={t('Ваша оценка')}><View style={styles.stars}>{[1, 2, 3, 4, 5].map(star => <Icon key={star} name={star <= Number(order.rating) ? 'star' : 'star-outline'} color={star <= Number(order.rating) ? '#EBAF26' : palette.muted} size={27}/>)}</View></Card>}
    {order.comment ? <Card title={t('Комментарий')}><Text style={[styles.comment, { color: palette.ink }]}>{order.comment}</Text></Card> : null}
  </View>;
}

const styles = StyleSheet.create({
  status: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },
  pins: { width: 22, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', paddingVertical: 2 },
  startDot: { width: 14, height: 14, borderRadius: 7, borderWidth: 4, borderColor: '#1686EF' },
  pinDash: { flex: 1, borderLeftWidth: 1.5, borderColor: '#1686EF', borderStyle: 'dashed', marginVertical: 3 },
  listCard: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 16, gap: 13 },
  listTop: { flexDirection: 'row', minHeight: 58, gap: 12 },
  listTimeColumn: { width: 62, borderRightWidth: 1, paddingTop: 1 },
  listTime: { fontSize: 17, fontWeight: '800' },
  listRoute: { flex: 1, flexDirection: 'row', gap: 10 },
  listAddress: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  listBottom: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 74 },
  listMeta: { fontSize: 11, flexShrink: 1 },
  listBottomRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 7 },
  listFare: { fontSize: 15, fontWeight: '800' },
  detailPage: { gap: 14, paddingBottom: 18 },
  detailCard: { borderRadius: 20, borderWidth: 1, padding: 17, gap: 13 },
  cardTitle: { fontSize: 18, fontWeight: '800', marginBottom: 1 },
  cardDivider: { height: 1 },
  detailRoute: { flexDirection: 'row', gap: 13 },
  detailAddress: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  routeMeta: { fontSize: 13, paddingLeft: 35 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  driverName: { fontSize: 16, fontWeight: '700' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontSize: 13, fontWeight: '700' },
  call: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  vehicleText: { fontSize: 13, marginLeft: 62 },
  plate: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginLeft: 62 },
  plateText: { fontSize: 13, fontWeight: '700', letterSpacing: .5 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 14 },
  infoLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  infoValue: { flex: 1, textAlign: 'right', fontSize: 13, fontWeight: '600' },
  infoStrong: { flex: 1, textAlign: 'right', fontSize: 18, fontWeight: '800' },
  noPayment: { fontSize: 13 },
  stars: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6, paddingVertical: 5 },
  comment: { fontSize: 14, lineHeight: 20 },
});
