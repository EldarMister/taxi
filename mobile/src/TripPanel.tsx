import React, { useEffect, useRef, useState } from "react";
import { Animated, Easing, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Avatar, Button, Car, colors, Icon, km, mins, money, Route, s as sharedStyles, shortAddress, tr } from "./ui";
import { Order, User } from "./types";
import { useTheme } from './design/theme';
import { useThemeStyles } from './design/themeStyles';

export const statusText = {
  SEARCHING: "Ищем водителя", ASSIGNED: "Водитель выехал к вам", ARRIVED: "Водитель приехал",
  IN_PROGRESS: "Поездка началась", COMPLETED: "Заказ успешно выполнен", CANCELLED: "Заказ отменён", NO_DRIVER: "Водитель не найден",
};

function SearchIndicator() {
  const { isDark } = useTheme();
  const styles = useThemeStyles(baseStyles);
  const rotation = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(rotation, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [rotation]);
  return <View style={styles.searchArt} accessible={false}>
    <View style={styles.searchHalo}/>
    <Animated.View style={[styles.searchRing, { transform: [{ rotate: rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}/>
    <View style={styles.searchCenter}><Icon name="car-sport" color={isDark ? '#FFFFFF' : colors.blue} size={33}/></View>
  </View>;
}

function SuccessIndicator() {
  const { isDark } = useTheme();
  const styles = useThemeStyles(baseStyles);
  return <View style={styles.successArt} accessible={false}>
    <View style={styles.successHalo}><View style={styles.successCenter}><Icon name="checkmark" color={isDark ? '#050505' : 'white'} size={38}/></View></View>
    {[[17, 32, '#1995FF', -30], [32, 11, '#D3E7FC', -30], [145, 19, '#96D0FF', 40], [159, 46, '#73B7FE', -40], [32, 78, '#69C892', 0], [147, 79, '#138AFF', 0]].map(([left, top, color, angle], index) => <View key={index} style={[styles.confetti, { left: Number(left), top: Number(top), backgroundColor: isDark ? index % 2 ? '#777777' : '#FFFFFF' : String(color), transform: [{ rotate: `${angle}deg` }] }]}/>)}
  </View>;
}

function ContactAction({ icon, label, onPress, disabled, outlined = false }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; disabled?: boolean; outlined?: boolean }) {
  const { isDark } = useTheme();
  const styles = useThemeStyles(baseStyles);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [outlined ? styles.outlineAction : styles.contactAction, (pressed || disabled) && { opacity: disabled ? .4 : .65 }]}>
    <View style={!outlined && styles.contactCircle}><Icon name={icon} size={outlined ? 24 : 29} color={isDark ? '#FFFFFF' : colors.blue}/></View>
    <Text style={outlined ? styles.outlineActionText : styles.contactText}>{label}</Text>
  </Pressable>;
}

export function TripPanel({ order, user, busy, onAction, onChat, onDone, onRating, coming }: {
  order: Order; user: User; busy: boolean; onAction: (action: string) => void; onChat: () => void; onDone: () => void; onRating: (score: number) => void; coming: boolean;
}) {
  const { isDark } = useTheme();
  const styles = useThemeStyles(baseStyles);
  const s = useThemeStyles(sharedStyles);
  const t = tr(user.language);
  const local = (ru: string, ky: string) => user.language === 'ky' ? ky : ru;
  const driver = user.role === 'DRIVER';
  const [score, setScore] = useState(0);
  const [details, setDetails] = useState(false);
  useEffect(() => { setScore(0); setDetails(false); }, [order.id]);
  const other = driver && order.passenger && order.client ? { ...order.client, name: order.passenger.name, phone: order.passenger.phone || '' } : driver ? order.client : order.driver;
  const vehicle = order.driver?.driverProfile;
  const completed = order.status === 'COMPLETED';
  const terminal = ['COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(order.status);
  const searching = order.status === 'SEARCHING';
  const arrived = order.status === 'ARRIVED';
  const title = driver ? ({ ASSIGNED: 'Следуйте к пассажиру', ARRIVED: 'Ожидайте пассажира', IN_PROGRESS: 'Поездка началась' } as Record<string, string>)[order.status] || statusText[order.status] : statusText[order.status];
  const call = () => other?.phone && void Linking.openURL(`tel:${other.phone}`);

  if (terminal && !completed) return <>
    <View style={styles.heading}>
      <View style={s.emptyIcon}><Icon name={order.status === 'NO_DRIVER' ? 'car-outline' : 'close'} color={colors.blue} size={34}/></View>
      <Text style={[styles.title, isDark && { color: '#FFFFFF' }]}>{t(title)}</Text>
      <Text style={styles.subtitle}>{t(order.status === 'NO_DRIVER' ? 'Сейчас нет свободных водителей. Попробуйте ещё раз.' : 'Вы можете оформить новую поездку.')}</Text>
    </View>
    <View style={styles.receipt}><Route order={order} t={t}/></View>
    <Button label={t('Заказать снова')} onPress={onDone}/>
  </>;

  return <>
    <View style={[styles.heading, !searching && !completed && { paddingTop: 12, paddingBottom: 8 }]}>
      {searching && <SearchIndicator/>}
      {completed && <SuccessIndicator/>}
      <Text style={[styles.title, isDark && { color: '#FFFFFF' }, completed && { fontSize: 23 }]}>{t(title)}{searching ? '…' : ''}</Text>
      {searching && <Text style={styles.subtitle}>{t('Предлагаем заказ свободным водителям')}</Text>}
      {completed && <Text style={styles.subtitle}>{t('Спасибо, что выбрали Atlas')}</Text>}
      {arrived && vehicle && <Text style={styles.subtitle}>{vehicle.carColor} {vehicle.carMake} · {vehicle.carPlate}</Text>}
    </View>

    {searching && <>
      <View style={styles.tariffCard}>
        <Car size={91}/>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={s.h3}>{order.tariff ? t(order.tariff.name) : t('Автомобиль')}</Text>
          <Text style={s.caption} numberOfLines={2}>{order.tariff?.description ? t(order.tariff.description) : local('Поездка по вашему маршруту', 'Сиз тандаган багыт боюнча сапар')}</Text>
        </View>
      </View>
      <View style={styles.searchRoute}>
        <View style={styles.routePins}><Icon name="radio-button-on" size={17} color={isDark ? '#FFFFFF' : colors.blue}/><View style={styles.dottedLine}/><Icon name="location" size={18} color={isDark ? '#FFFFFF' : colors.ink}/></View>
        <View style={{ flex: 1, gap: 10 }}><Text style={styles.compactAddress} numberOfLines={1}>{shortAddress(order.pickup.address)}</Text><Text style={styles.compactAddress} numberOfLines={1}>{shortAddress(order.dropoff.address)}</Text></View>
        <View style={{ alignItems: 'flex-end', gap: 5 }}><Text style={s.h3}>{money(order.price)}</Text><Text style={s.caption}>{km(order.distanceMeters)}</Text></View>
      </View>
    </>}

    {other && !terminal && <View style={styles.driverRow}>
      <View style={styles.avatarWrap}>
        {driver ? <View style={styles.passengerIcon}><Icon name="person" size={39} color="white"/></View> : <Avatar user={other} size={76}/>}
        {!driver && vehicle?.rating != null && <View style={styles.ratingBadge}><Icon name="star" color={isDark ? '#FFFFFF' : '#FFB617'} size={15}/><Text style={styles.ratingText}>{Number(vehicle.rating).toFixed(1)}</Text></View>}
      </View>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.driverName} numberOfLines={1}>{driver ? order.passenger?.name || t('Пассажир') : other.name || t('Водитель')}</Text>
        {!driver && vehicle && <>
          <Text style={s.muted} numberOfLines={1}>{arrived && vehicle.completedTrips != null ? local(`${vehicle.completedTrips} поездок`, `${vehicle.completedTrips} сапар`) : `${vehicle.carColor} ${vehicle.carMake}`}</Text>
          {!arrived && <View style={styles.plate}><Text style={styles.plateText}>{vehicle.carPlate}</Text></View>}
        </>}
        {driver && <Text style={s.muted}>{other.phone}</Text>}
      </View>
      {!driver && <View style={{ alignItems: 'center', gap: 7 }}>
        {arrived && vehicle && <View style={styles.plate}><Text style={styles.plateText}>{vehicle.carPlate}</Text></View>}
        <Car size={arrived ? 96 : 102}/>
      </View>}
    </View>}

    {other && !terminal && <View style={[s.row, { gap: arrived ? 10 : 12, paddingVertical: arrived ? 4 : 6 }]}>
      <ContactAction icon="call" label={t('Позвонить')} onPress={call} disabled={!other.phone} outlined={arrived}/>
      <ContactAction icon={arrived ? 'chatbubble-ellipses' : 'chatbubbles'} label={arrived ? t('Чат') : local('Написать', 'Жазуу')} onPress={onChat} outlined={arrived}/>
      {!arrived && !driver && <ContactAction icon="ellipsis-horizontal" label={local('Детали', 'Чоо-жайы')} onPress={() => setDetails(!details)}/>}
    </View>}

    {(completed || driver || details || order.status === 'IN_PROGRESS') && <View style={styles.receipt}>
      <Route order={order} t={t}/>
      <View style={styles.receiptDivider}/>
      {completed && <>
        <View style={styles.receiptRow}>
          <View style={styles.receiptIcon}><Icon name="car-sport" size={21}/></View>
          <View style={{ flex: 1 }}><Text style={s.caption}>{t('Тариф')}</Text><Text style={s.body}>{order.tariff ? t(order.tariff.name) : t('Стоимость')}</Text></View>
          <Text style={styles.price}>{money(order.price)}</Text>
        </View>
        <View style={styles.receiptRow}>
          <View style={styles.receiptIcon}><Icon name="cash" color={isDark ? '#FFFFFF' : colors.green} size={21}/></View>
          <View style={{ flex: 1 }}><Text style={s.caption}>{t('Платёж')}</Text><Text style={s.body}>{t('Наличные')}</Text></View>
          <Text style={s.caption}>{t('Оплата водителю')}</Text>
        </View>
      </>}
      <View style={styles.receiptRow}>
        <View style={styles.receiptIcon}><Icon name="navigate" color={isDark ? '#FFFFFF' : colors.muted} size={20}/></View>
        <View style={{ flex: 1 }}><Text style={s.caption}>{t('Маршрут поездки')}</Text><Text style={s.body}>{km(order.distanceMeters)} · {mins(completed ? order.actualDurationSeconds ?? order.durationSeconds : order.durationSeconds, user.language)}</Text></View>
        {!completed && <Text style={styles.price}>{money(order.price)}</Text>}
      </View>
    </View>}

    {order.comment && driver && <View style={[s.row, styles.comment]}><Icon name="chatbox-outline" color={isDark ? '#FFFFFF' : colors.blue}/><Text style={[s.body, { flex: 1 }]}>{order.comment}</Text></View>}
    {driver && coming && !terminal && <Text style={[styles.coming, isDark && { color: '#FFFFFF' }]}>{t('Пассажир выходит')}</Text>}
    {!driver && arrived && <Button label={t(coming ? 'Уже отправлено' : 'Я выхожу')} onPress={() => onAction('coming')} disabled={coming} busy={busy}/>}
    {driver && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status) && <Button label={t(({ ASSIGNED: 'Приехал', ARRIVED: 'Начать поездку', IN_PROGRESS: 'Завершить поездку' } as Record<string, string>)[order.status])} onPress={() => onAction(({ ASSIGNED: 'arrive', ARRIVED: 'start', IN_PROGRESS: 'complete' } as Record<string, string>)[order.status])} busy={busy}/>}
    {!terminal && order.status !== 'IN_PROGRESS' && (!arrived || driver) && <Button secondary label={t('Отменить заказ')} onPress={() => onAction('cancel')} busy={busy}/>}
    {!driver && arrived && <Pressable accessibilityRole="button" disabled={busy} onPress={() => onAction('cancel')} style={styles.cancelLink}><Text style={s.caption}>{t('Отменить заказ')}</Text></Pressable>}

    {completed && <>
      {!driver && !order.rating && <View style={styles.ratingCard}>
        <Text style={s.h3}>{t('Оцените поездку')}</Text>
        <View style={[s.row, { gap: 8 }]}>{[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityLabel={`${t('Оценка')} ${value}`} accessibilityRole="button" accessibilityState={{ selected: value === score }} hitSlop={3} onPress={() => setScore(value)} style={{ padding: 3 }}><Icon name={value <= score ? 'star' : 'star-outline'} color={isDark ? value <= score ? '#FFFFFF' : '#888888' : value <= score ? colors.blue : '#BACADC'} size={34}/></Pressable>)}</View>
      </View>}
      <Button label={t('Готово')} busy={busy} onPress={() => !driver && score && !order.rating ? onRating(score) : onDone()}/>
    </>}
  </>;
}

const baseStyles = StyleSheet.create({
  heading: { alignItems: 'center', gap: 7, paddingTop: 2 },
  title: { fontSize: 25, lineHeight: 31, fontWeight: '700', letterSpacing: -.6, color: '#0B1732', textAlign: 'center' },
  subtitle: { fontSize: 15, lineHeight: 21, color: colors.muted, textAlign: 'center' },
  searchArt: { height: 116, width: 116, alignItems: 'center', justifyContent: 'center', marginTop: -4 },
  searchHalo: { position: 'absolute', width: 114, height: 114, borderRadius: 57, borderWidth: 3, borderColor: '#F0F7FF' },
  searchRing: { position: 'absolute', width: 94, height: 94, borderRadius: 47, borderWidth: 3, borderColor: '#ACD3FF', borderRightColor: colors.blue, borderBottomColor: 'transparent' },
  searchCenter: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#E8F3FF', alignItems: 'center', justifyContent: 'center' },
  successArt: { width: 180, height: 96, alignItems: 'center', justifyContent: 'center' },
  successHalo: { width: 82, height: 82, borderRadius: 41, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F3FF' },
  successCenter: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  confetti: { position: 'absolute', width: 6, height: 10, borderRadius: 3 },
  tariffCard: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 13 },
  searchRoute: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingHorizontal: 5, paddingVertical: 1 },
  routePins: { alignItems: 'center', height: 49, justifyContent: 'space-between' },
  dottedLine: { height: 14, borderLeftWidth: 1.5, borderStyle: 'dashed', borderColor: '#A1BAD3' },
  compactAddress: { fontSize: 15, color: colors.ink, lineHeight: 20 },
  driverRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10 },
  avatarWrap: { paddingBottom: 6, alignItems: 'center' },
  passengerIcon: { width: 76, height: 76, borderRadius: 19, backgroundColor: '#293448', alignItems: 'center', justifyContent: 'center' },
  ratingBadge: { position: 'absolute', bottom: -1, backgroundColor: 'white', borderRadius: 15, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', gap: 4, alignItems: 'center', shadowColor: '#34506E', shadowOpacity: .13, shadowOffset: { width: 0, height: 3 }, shadowRadius: 5, elevation: 3 },
  ratingText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  driverName: { fontSize: 20, color: colors.ink, fontWeight: '700' },
  plate: { alignSelf: 'flex-start', backgroundColor: '#F8FBFE', borderWidth: 1, borderColor: '#DFE8F2', borderRadius: 9, paddingHorizontal: 9, paddingVertical: 5 },
  plateText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  contactAction: { flex: 1, alignItems: 'center', gap: 8 },
  contactCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F0F6FD', alignItems: 'center', justifyContent: 'center' },
  contactText: { fontSize: 14, color: '#223952', textAlign: 'center' },
  outlineAction: { flex: 1, minHeight: 60, paddingHorizontal: 10, borderWidth: 1, borderColor: '#DFEDFF', borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  outlineActionText: { fontSize: 15, fontWeight: '600', color: colors.blue },
  receipt: { borderWidth: 1, borderColor: colors.line, padding: 15, borderRadius: 21, gap: 11 },
  receiptDivider: { height: 1, backgroundColor: colors.line, marginTop: 3 },
  receiptRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  receiptIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#EFF5FB', alignItems: 'center', justifyContent: 'center' },
  price: { fontSize: 19, color: colors.ink, fontWeight: '700' },
  comment: { backgroundColor: colors.pale, padding: 13, borderRadius: 15 },
  coming: { color: colors.green, textAlign: 'center', fontWeight: '600' },
  ratingCard: { alignItems: 'center', backgroundColor: '#F2F7FC', padding: 13, borderRadius: 20, gap: 7 },
  cancelLink: { alignItems: 'center', paddingVertical: 3 },
});
