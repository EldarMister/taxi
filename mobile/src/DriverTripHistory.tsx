import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import Svg, { Path, Rect } from 'react-native-svg';
import { api, messageOf } from './api';
import { LightThemeSurface } from './design/theme';
import type { Order, User } from './types';
import { Icon, money, Route, s, shortAddress, tr } from './ui';
import { historyBuckets, historyChartRange, historyDateLabel, historyDay, historyLocale, historyOrderCount, historyPeriodLabel, historyRange, historyTotals, ordersInHistoryRange, type DriverHistoryPeriod } from './driverHistory';

const c = { background: '#FDFDFF', ink: '#191C2B', secondary: '#52566B', muted: '#777B8D', segment: '#E9EAF3', bar: '#E0E1EB', blue: '#4A80FF', border: '#CDCEDD', line: '#E6E6EF' };
const font = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold', heavy: 'Inter_800ExtraBold' };
const orderStatus: Record<Order['status'], string> = { COMPLETED: 'Завершён', CANCELLED: 'Отменён', NO_DRIVER: 'Нет водителя', IN_PROGRESS: 'В пути', ASSIGNED: 'Найден', ARRIVED: 'Ожидание', SEARCHING: 'Поиск' };
const pickerDate = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 12);
const pickerDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

function CalendarIcon({ size }: { size: number }) {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none"><Rect x="3.5" y="4.5" width="17" height="17" rx="2.5" stroke={c.ink} strokeWidth="1.7"/><Path d="M7.5 2.5v5M16.5 2.5v5M3.5 9.5h17" stroke={c.ink} strokeWidth="1.7" strokeLinecap="round"/></Svg>;
}

function FinancialChip({ label, value, scale }: { label: string; value: number | null; scale: number }) {
  return <View style={[styles.chip, { minHeight: 33 * scale, paddingHorizontal: 13 * scale }]}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.7} style={[styles.chipText, { fontSize: 14 * scale, lineHeight: 19 * scale }]}>{label} · <Text style={styles.chipAmount}>{value == null ? '—' : value < 0 ? `−${money(Math.abs(value))}` : money(value)}</Text></Text></View>;
}

function DriverOrderRow({ order, user, scale, expanded, onPress }: { order: Order; user: User; scale: number; expanded: boolean; onPress: () => void }) {
  const t = tr(user.language);
  const completed = order.status === 'COMPLETED';
  const unpaid = order.status === 'CANCELLED' || order.status === 'NO_DRIVER';
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('Детали поездки')}: ${order.pickup.address} — ${order.dropoff.address}`} accessibilityState={{ expanded }} onPress={onPress} style={({ pressed }) => [styles.orderRow, { minHeight: 57 * scale, paddingVertical: 9 * scale, opacity: pressed ? .6 : 1 }]}>
      <View style={[styles.carCircle, { width: 37 * scale, height: 37 * scale, borderRadius: 19 * scale, marginRight: 12 * scale }]}><Icon name="car-outline" size={20 * scale} color={c.muted}/></View>
      <View style={styles.orderContent}>
        <View style={styles.orderTop}><Text style={[styles.orderTime, { fontSize: 15 * scale, lineHeight: 19 * scale }]}>{new Date(order.createdAt).toLocaleTimeString(historyLocale(user.language), { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit', hour12: false })}</Text><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.75} style={[styles.orderAmount, { fontSize: 15 * scale, lineHeight: 19 * scale, maxWidth: '70%' }]}>{completed ? money(order.price) : unpaid ? money(0) : '—'}</Text></View>
        <Text numberOfLines={1} style={[styles.orderAddress, { fontSize: 12 * scale, lineHeight: 17 * scale, marginTop: 2 * scale }]}>{completed ? user.language === 'en' ? 'Order' : user.language === 'ky' ? 'Буюртма' : 'Заказ' : `${t(orderStatus[order.status])} ·`} {shortAddress(order.pickup.address)}</Text>
      </View>
      <View style={{ alignSelf: 'flex-start', marginTop: 3 * scale, marginLeft: 8 * scale }}><Icon name={expanded ? 'chevron-down' : 'chevron-forward'} size={18 * scale} color={c.muted}/></View>
    </Pressable>
    {expanded && <View style={styles.orderDetails}><Route order={order} fullAddresses t={t}/><View style={s.divider}/><View style={s.spread}><Text style={[s.muted, { color: c.secondary }]}>{t(completed ? order.paymentMethod === 'CARD' ? 'Картой' : 'Наличные' : unpaid ? 'Оплата не проводилась' : 'Стоимость')}</Text><Text style={[s.h3, { color: c.ink }]}>{money(unpaid ? 0 : order.price)}</Text></View>{order.comment ? <Text style={[s.muted, { color: c.secondary }]}>{order.comment}</Text> : null}{order.rating != null && <View style={s.row}><Icon name="star" color={c.blue} size={17}/><Text style={[s.body, { color: c.ink }]}>{order.rating}</Text></View>}</View>}
  </View>;
}

export function DriverTripHistory(props: { user: User; onBack: () => void; onError: (message: string) => void }) {
  return <LightThemeSurface><DriverTripHistoryContent {...props}/></LightThemeSurface>;
}

function DriverTripHistoryContent({ user, onBack, onError }: { user: User; onBack: () => void; onError: (message: string) => void }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scale = Math.min(1.2, Math.max(.74, width / 432));
  const t = tr(user.language);
  const [period, setPeriod] = useState<DriverHistoryPeriod>('today');
  const [day, setDay] = useState(() => historyDay());
  const [history, setHistory] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draft, setDraft] = useState(() => pickerDate(day));
  const [infoOpen, setInfoOpen] = useState(false);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true); setFailed(false);
    const range = historyChartRange(period, day);
    try {
      const result = await api.request<Order[]>(`/orders/history?period=${period}&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`);
      if (requestVersion.current === version) { setHistory(result); setLoaded(true); }
    } catch (error) { if (requestVersion.current === version) { setFailed(true); onError(messageOf(error)); } }
    finally { if (requestVersion.current === version) setLoading(false); }
  }, [period, day, onError]);
  useEffect(() => { setHistory([]); setLoaded(false); setExpanded(null); void refresh(); return () => { requestVersion.current += 1; }; }, [refresh]);
  const orders = useMemo(() => ordersInHistoryRange(history, historyRange(period, day)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)), [history, period, day]);
  const totals = historyTotals(orders);
  const buckets = historyBuckets(history, period, day);
  const maximum = Math.max(1, ...buckets.map(bucket => bucket.amount));
  const groups = orders.reduce<Array<{ day: string; orders: Order[] }>>((result, order) => {
    const key = historyDay(order.createdAt), last = result[result.length - 1];
    if (last?.day === key) last.orders.push(order); else result.push({ day: key, orders: [order] });
    return result;
  }, []);
  const openCalendar = () => {
    const value = pickerDate(day);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value, mode: 'date', display: 'default', maximumDate: pickerDate(historyDay()), onChange: (event, selected) => { if (event.type === 'set' && selected) setDay(pickerDay(selected)); } });
    } else { setDraft(value); setCalendarOpen(true); }
  };
  const ready = loaded && !failed;
  const modalTitle = user.language === 'en' ? 'Select date' : user.language === 'ky' ? 'Күндү тандоо' : 'Выберите дату';

  return <View style={styles.screen}>
    <StatusBar style="dark" backgroundColor={c.background}/>
    <View style={[styles.header, { paddingTop: insets.top + 12 * scale, paddingBottom: 8 * scale, paddingHorizontal: 10 * scale }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Назад')} onPress={onBack} hitSlop={6} style={({ pressed }) => [styles.headerButton, { opacity: pressed ? .5 : 1, width: 40 * scale, height: 40 * scale, marginRight: 29 * scale }]}><Icon name="arrow-back" size={27 * scale} color={c.ink}/></Pressable>
      <View style={[styles.segments, { height: 33 * scale, padding: 2 * scale }]}>{(['today', 'week', 'month'] as const).map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={t(value === 'today' ? 'Сегодня' : value === 'week' ? 'Неделя' : 'Месяц')} accessibilityState={{ selected: period === value }} onPress={() => setPeriod(value)} style={[styles.segment, period === value && styles.activeSegment]}><Text style={[styles.segmentText, { fontSize: 13 * scale }, period === value && styles.activeSegmentText]}>{t(value === 'today' ? 'Сегодня' : value === 'week' ? 'Неделя' : 'Месяц')}</Text></Pressable>)}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Выберите дату')} onPress={openCalendar} hitSlop={6} style={({ pressed }) => [styles.headerButton, { opacity: pressed ? .5 : 1, width: 40 * scale, height: 40 * scale, marginLeft: 17 * scale }]}><CalendarIcon size={24 * scale}/></Pressable>
    </View>
    <ScrollView showsVerticalScrollIndicator={false} style={styles.screen} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 12 * scale }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor={c.blue}/>}>
      <View style={{ paddingTop: 8.5 * scale, alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={user.language === 'en' ? 'About income' : user.language === 'ky' ? 'Киреше жөнүндө' : 'Информация о доходе'} onPress={() => setInfoOpen(true)} style={styles.summaryCaption}><Text numberOfLines={1} adjustsFontSizeToFit style={[styles.summaryDate, { fontSize: 13 * scale, lineHeight: 18 * scale, maxWidth: '85%' }]}>{historyPeriodLabel(period, day, user.language)} · {ready ? historyOrderCount(totals.count, user.language) : '—'}</Text><Icon name="information-circle-outline" size={19 * scale} color={c.secondary}/></Pressable>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.6} style={[styles.income, { marginTop: 4.5 * scale, fontSize: 42 * scale, lineHeight: 51 * scale, paddingHorizontal: 16 * scale }]}>{ready ? money(totals.income) : '—'}</Text>
      </View>
      <View style={[styles.chart, { marginTop: 26 * scale, paddingHorizontal: 14 * scale, gap: 2 * scale }]}>{buckets.map(bucket => {
        const selected = day >= bucket.key && day <= bucket.lastDay;
        const month = new Date(`${bucket.key}T12:00:00Z`).toLocaleDateString(historyLocale(user.language), { timeZone: 'UTC', month: 'short' }).replace(/\.$/, '');
        const future = bucket.key > historyDay();
        return <Pressable key={bucket.key} accessibilityRole="button" accessibilityLabel={`${historyDateLabel(bucket.key, user.language)}${bucket.lastDay !== bucket.key ? ` – ${historyDateLabel(bucket.lastDay, user.language)}` : ''}: ${ready ? money(bucket.amount) : '—'}`} accessibilityState={{ selected, disabled: future }} disabled={future} onPress={() => setDay(bucket.key)} style={styles.chartColumn}>
          <View style={[styles.barTrack, { height: 100 * scale }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={.6} style={[styles.barAmount, { fontSize: 10.5 * scale, lineHeight: 14 * scale }, selected && styles.selectedText]}>{ready ? Number(bucket.amount).toLocaleString(historyLocale(user.language), { maximumFractionDigits: 1 }) : '—'}</Text>
            <View style={{ width: '100%', height: ready && bucket.amount > 0 ? 82 * scale * bucket.amount / maximum : 2 * scale, borderTopLeftRadius: 7 * scale, borderTopRightRadius: 7 * scale, borderBottomLeftRadius: 5 * scale, borderBottomRightRadius: 5 * scale, backgroundColor: selected ? c.blue : c.bar }}/>
          </View>
          <Text style={[styles.barDay, { fontSize: 11 * scale, lineHeight: 14 * scale, marginTop: 3 * scale }, selected && styles.selectedText]}>{Number(bucket.key.slice(8))}{bucket.key !== bucket.lastDay ? `–${Number(bucket.lastDay.slice(8))}` : ''}</Text>
          <Text style={[styles.barMonth, { fontSize: 11 * scale, lineHeight: 14 * scale }, selected && styles.selectedText]}>{month}</Text>
        </Pressable>;
      })}</View>
      <View style={[styles.financials, { marginTop: 32 * scale, paddingHorizontal: 17 * scale, gap: 7 * scale }]}>
        <View style={[styles.financialRow, { gap: 7 * scale }]}><View style={{ width: 150 * scale }}><FinancialChip label={t('Картой')} value={ready ? totals.card : null} scale={scale}/></View><View style={styles.rightFinancial}><FinancialChip label={t('Наличными')} value={ready ? totals.cash : null} scale={scale}/></View></View>
        <View style={[styles.financialRow, { gap: 7 * scale }]}><View style={{ width: 150 * scale }}><FinancialChip label={t('Бонусы')} value={ready ? totals.bonus : null} scale={scale}/></View><View style={styles.rightFinancial}><FinancialChip label={t('Комиссия сервиса')} value={ready ? totals.commission : null} scale={scale}/></View></View>
      </View>
      <View style={{ paddingHorizontal: 17 * scale, marginTop: 24 * scale }}>
        {groups.map((group, groupIndex) => <View key={group.day} style={{ marginTop: groupIndex === 0 ? 0 : 20 * scale }}><Text style={[styles.dateHeading, { fontSize: 20 * scale, lineHeight: 26 * scale, marginBottom: 11 * scale }]}>{historyDateLabel(group.day, user.language)}</Text>{group.orders.map((order, index) => <View key={order.id}><DriverOrderRow order={order} user={user} scale={scale} expanded={expanded === order.id} onPress={() => setExpanded(expanded === order.id ? null : order.id)}/>{index < group.orders.length - 1 && <View style={styles.separator}/>}</View>)}</View>)}
        {loading && !loaded && <ActivityIndicator style={{ paddingVertical: 26 }} color={c.blue}/>}
        {!loading && !failed && orders.length === 0 && <Text style={styles.empty}>{t('Поездок пока нет')}</Text>}
        {failed && <Pressable accessibilityRole="button" onPress={refresh} style={{ paddingVertical: 24 }}><Text style={[styles.empty, { color: c.blue }]}>{t('Обновить')}</Text></Pressable>}
      </View>
    </ScrollView>
    <Modal visible={calendarOpen} transparent animationType="slide" onRequestClose={() => setCalendarOpen(false)}><View style={styles.modalRoot}><Pressable accessibilityLabel={t('Закрыть')} style={styles.backdrop} onPress={() => setCalendarOpen(false)}/><View style={[styles.dateSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}><View style={styles.sheetHeader}><Pressable onPress={() => setCalendarOpen(false)}><Text style={styles.sheetAction}>{t('Отмена')}</Text></Pressable><Text style={styles.sheetTitle}>{modalTitle}</Text><Pressable onPress={() => { setDay(pickerDay(draft)); setCalendarOpen(false); }}><Text style={styles.sheetAction}>{t('Готово')}</Text></Pressable></View><DateTimePicker value={draft} mode="date" display="spinner" themeVariant="light" maximumDate={pickerDate(historyDay())} onChange={(_, date) => date && setDraft(date)}/><Text style={styles.dateHint}>{user.language === 'en' ? 'The selected date determines the day, week or month.' : user.language === 'ky' ? 'Тандалган күнгө жараша күн, жума же ай көрсөтүлөт.' : 'Выбранная дата определяет день, неделю или месяц.'}</Text></View></View></Modal>
    <Modal visible={infoOpen} transparent animationType="fade" onRequestClose={() => setInfoOpen(false)}><View style={styles.modalRoot}><Pressable accessibilityLabel={t('Закрыть')} style={styles.backdrop} onPress={() => setInfoOpen(false)}/><View style={[styles.dateSheet, { paddingBottom: Math.max(insets.bottom, 16) }]}><View style={styles.sheetHeader}><Text style={styles.sheetTitle}>{user.language === 'en' ? 'Income' : user.language === 'ky' ? 'Киреше' : 'Доход'}</Text><Pressable onPress={() => setInfoOpen(false)}><Text style={styles.sheetAction}>{t('Закрыть')}</Text></Pressable></View><Text style={styles.dateHint}>{user.language === 'en' ? 'Income is the total of completed orders. The service commission is charged separately from your deposit.' : user.language === 'ky' ? 'Киреше — аткарылган буюртмалардын суммасы. Кызматтын комиссиясы депозиттен өзүнчө алынат.' : 'Доход — сумма завершённых заказов. Комиссия сервиса списывается отдельно с депозита.'}</Text></View></View></Modal>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.background },
  headerButton: { justifyContent: 'center', alignItems: 'center' },
  segments: { flex: 1, flexDirection: 'row', borderRadius: 20, backgroundColor: c.segment },
  segment: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  activeSegment: { backgroundColor: '#FFFFFF' },
  segmentText: { color: c.secondary, fontFamily: font.regular },
  activeSegmentText: { color: '#080808', fontFamily: font.semibold },
  summaryCaption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  summaryDate: { color: c.secondary, fontFamily: font.regular },
  income: { color: c.ink, fontFamily: font.heavy, letterSpacing: -1.8, textAlign: 'center' },
  chart: { flexDirection: 'row', alignItems: 'flex-end' },
  chartColumn: { flex: 1, minWidth: 0, alignItems: 'center' },
  barTrack: { width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  barAmount: { color: c.ink, fontFamily: font.regular, textAlign: 'center', width: '100%', marginBottom: 1 },
  barDay: { color: c.ink, fontFamily: font.semibold },
  barMonth: { color: c.secondary, fontFamily: font.regular },
  selectedText: { color: c.blue, fontFamily: font.semibold },
  financials: {},
  financialRow: { flexDirection: 'row', alignItems: 'flex-start' },
  rightFinancial: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  chip: { borderWidth: 1, borderColor: c.border, borderRadius: 30, justifyContent: 'center', maxWidth: '100%' },
  chipText: { color: '#090909', fontFamily: font.regular },
  chipAmount: { fontFamily: font.semibold },
  dateHeading: { color: c.ink, fontFamily: font.bold, letterSpacing: -.4 },
  orderRow: { flexDirection: 'row', alignItems: 'center' },
  carCircle: { backgroundColor: c.segment, justifyContent: 'center', alignItems: 'center' },
  orderContent: { flex: 1, minWidth: 0 },
  orderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  orderTime: { color: '#090909', fontFamily: font.semibold },
  orderAmount: { color: '#090909', fontFamily: font.semibold },
  orderAddress: { color: c.secondary, fontFamily: font.regular },
  orderDetails: { paddingVertical: 16, gap: 12 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: c.line },
  empty: { color: c.secondary, fontSize: 14, fontFamily: font.regular, textAlign: 'center', paddingVertical: 20 },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(25,28,43,.3)' },
  dateSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 18 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  sheetAction: { color: c.blue, fontFamily: font.medium, fontSize: 15, paddingVertical: 8 },
  sheetTitle: { color: c.ink, fontFamily: font.semibold, fontSize: 16 },
  dateHint: { color: c.secondary, fontFamily: font.regular, fontSize: 14, lineHeight: 21, paddingVertical: 16 },
});
