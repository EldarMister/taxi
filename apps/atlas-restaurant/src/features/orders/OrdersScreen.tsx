import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, FlatList, KeyboardAvoidingView, Linking, Modal,
  Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../data/api';
import { Photo } from '../../ui';
import { can, money, type DeliveryQuote, type DispatchInput, type Membership, type MerchantOrder, type OrderAction, type OrderStatus } from '../../domain/types';
import { useOrdersFeed } from './feed';
import { activeOrder, allowedActions, atlasLabels, canDispatch, destination, fallbackCoordinates, filterOrders, orderNumber, statusLabels, type OrderFilter } from './model';

const blue = '#087FFF';
const colors: Record<OrderStatus, string> = { PLACED: blue, CONFIRMED: blue, PREPARING: '#B26C13', READY: '#23815C', DELIVERING: blue, COMPLETED: '#697585', CANCELLED: '#C74646' };
const tones: Record<OrderStatus, string> = { PLACED: '#EAF3FF', CONFIRMED: '#EAF3FF', PREPARING: '#FFF4DF', READY: '#E8F5EE', DELIVERING: '#EAF3FF', COMPLETED: '#F0F2F5', CANCELLED: '#FCEDEC' };
const actionLabels: Record<OrderAction, string> = { ACCEPT: 'Принять заказ', PREPARING: 'Начать готовить', READY: 'Заказ готов', COMPLETE: 'Завершить заказ', CANCEL: 'Отменить заказ' };
const dateTime = (date: string) => new Date(date).toLocaleString('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const clockTime = (date: string) => new Date(date).toLocaleTimeString('ru-RU', { timeZone: 'Asia/Bishkek', hour: '2-digit', minute: '2-digit' });
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить действие. Попробуйте ещё раз.';

type Props = { restaurantId: string; membership: Membership; onChanged?: () => void };
export function OrdersScreen({ restaurantId, membership, onChanged }: Props) {
  const feed = useOrdersFeed();
  const [filter, setFilter] = useState<OrderFilter>('active');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = feed.orders.find(order => order.id === selectedId);
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    const event = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => event.remove();
  }, []);
  const visible = filterOrders(feed.orders, filter, search);
  const newCount = feed.orders.filter(order => order.status === 'PLACED').length;
  const manage = membership.restaurantId === restaurantId && can(membership, 'orders.manage');
  const filters: [OrderFilter, string][] = [['active', 'В работе'], ['new', `Новые${newCount ? ` · ${newCount}` : ''}`], ['preparing', 'Готовим'], ['ready', 'Выдача'], ['history', 'История']];
  const header = <View style={styles.header}>
    <View style={styles.row}><View style={styles.flex}><Text style={styles.eyebrow}>КУХНЯ НА СВЯЗИ</Text><Text style={styles.title}>Заказы</Text></View><View style={styles.counter}><Text style={styles.counterNumber}>{feed.orders.filter(activeOrder).length}</Text><Text style={styles.small}>в работе</Text></View></View>
    <Text style={styles.subtitle}>От первого «принят» до счастливого клиента</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>{filters.map(([id, label]) => <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: id === filter }} onPress={() => setFilter(id)} style={[styles.pill, id === filter && styles.pillActive]}><Text style={[styles.pillText, id === filter && styles.white]}>{label}</Text></Pressable>)}</ScrollView>
    <View style={styles.search}><Ionicons name="search-outline" size={20} color="#7C8795"/><TextInput accessibilityLabel="Поиск заказа" placeholder="Номер, имя или блюдо" placeholderTextColor="#8B95A1" value={search} onChangeText={setSearch} style={styles.searchInput}/>{search ? <Pressable accessibilityLabel="Очистить поиск" onPress={() => setSearch('')} style={styles.searchClear}><Ionicons name="close-circle" size={20} color="#8B95A1"/></Pressable> : null}</View>
    {feed.error ? <View accessibilityRole="alert" style={styles.warning}><Ionicons name="cloud-offline-outline" size={21} color="#A96813"/><View style={styles.flex}><Text style={styles.warningTitle}>Обновление задерживается</Text><Text style={styles.caption}>{feed.error}{feed.lastUpdated ? ` Последние данные: ${clockTime(new Date(feed.lastUpdated).toISOString())}.` : ''}</Text></View><Pressable accessibilityLabel="Обновить заказы" onPress={() => void feed.refresh().catch(() => undefined)} style={styles.iconButton}><Ionicons name="refresh" size={21} color={blue}/></Pressable></View> : null}
    {!manage ? <Text style={styles.caption}>Доступен просмотр. Действия с заказами выполняет сотрудник с правом управления.</Text> : null}
  </View>;
  return <View style={styles.screen}>
    <FlatList
      data={visible} keyExtractor={order => order.id} ListHeaderComponent={header}
      contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" initialNumToRender={8} maxToRenderPerBatch={8}
      refreshControl={<RefreshControl refreshing={feed.refreshing && !feed.loading} onRefresh={() => void feed.refresh().catch(() => undefined)} tintColor={blue} colors={[blue]}/>}
      renderItem={({ item }) => <OrderCard order={item} highlighted={feed.newOrderIds.includes(item.id)} reduced={reduced} onOpen={() => setSelectedId(item.id)}/>}
      ListEmptyComponent={feed.loading ? <View style={styles.skeletons}>{[1, 2, 3].map(key => <View key={key} style={styles.skeleton}><View style={[styles.skeletonLine, { width: '45%' }]}/><View style={styles.skeletonLine}/><View style={[styles.skeletonLine, { width: '65%' }]}/></View>)}</View> : <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name={filter === 'history' ? 'time-outline' : 'receipt-outline'} size={36} color={blue}/></View><Text style={styles.sectionTitle}>{search ? 'Не нашли такой заказ' : filter === 'history' ? 'История начинается здесь' : 'Всё под контролем'}</Text><Text style={styles.emptyBody}>{search ? 'Попробуйте другой номер, имя клиента или название блюда.' : filter === 'history' ? 'Завершённые и отменённые заказы появятся в этом разделе.' : 'Как только поступит новый заказ, вы увидите его здесь. Обновляем список автоматически.'}</Text></View>}
      ListFooterComponent={feed.orders.length ? <Text style={styles.footer}>Показаны последние {feed.orders.length} заказов · обновление автоматически</Text> : null}
    />
    {selected ? <OrderDetail key={selected.id} restaurantId={restaurantId} order={selected} manage={manage} reduced={reduced} onClose={() => setSelectedId(null)} onChanged={onChanged}/> : null}
  </View>;
}

function OrderCard({ order, highlighted, onOpen, reduced }: { order: MerchantOrder; highlighted: boolean; onOpen: () => void; reduced: boolean }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!highlighted || reduced) return;
    opacity.setValue(0.6);
    const animation = Animated.timing(opacity, { toValue: 1, duration: 180, easing: Easing.bezier(0.23, 1, 0.32, 1), useNativeDriver: true });
    animation.start(); return () => animation.stop();
  }, [highlighted, reduced, opacity]);
  const quantities = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return <Animated.View style={{ opacity }}><Pressable accessibilityRole="button" accessibilityLabel={`Заказ ${orderNumber(order)}, ${statusLabels[order.status]}, ${money(order.total)}`} onPress={onOpen} style={({ pressed }) => [styles.card, highlighted && styles.cardHighlighted, pressed && styles.pressed]}>
    <View style={styles.row}><View style={styles.flex}><Text style={styles.orderNumber}>№ {orderNumber(order)}</Text><Text style={styles.caption}>{dateTime(order.createdAt)}</Text></View><StatusBadge order={order}/></View>
    <View style={[styles.row, { marginTop: 3 }]}><View style={styles.foodThumb}><Photo imageUrl={order.items[0]?.imageUrl} imageKey={order.items[0]?.imageKey} style={styles.fill} label={order.items[0]?.name}/></View><View style={styles.flex}><Text style={styles.orderDishes} numberOfLines={2}>{order.items.map(item => `${item.quantity} × ${item.name}`).join(', ')}</Text><Text style={styles.caption}>{quantities} шт. · {order.client?.name || 'Клиент'}</Text></View></View>
    {order.comment ? <View style={styles.commentPreview}><Ionicons name="chatbubble-outline" size={15} color="#7F8B98"/><Text numberOfLines={1} style={[styles.caption, styles.flex]}>{order.comment}</Text></View> : null}
    <View style={styles.cardBottom}><View style={styles.flex}><View style={styles.row}><Ionicons name={order.fulfillment === 'PICKUP' ? 'bag-handle-outline' : 'bicycle-outline'} color="#6F7B8A" size={17}/><Text style={styles.caption}>{order.fulfillment === 'PICKUP' ? 'Самовывоз' : order.deliveryMethod === 'ATLAS_CAR' ? 'Доставка Atlas' : 'Доставка'}</Text></View><Text style={styles.cardPrice}>{money(order.total)}</Text></View><View style={styles.openCircle}><Ionicons name="arrow-forward" color={blue} size={22}/></View></View>
  </Pressable></Animated.View>;
}

function StatusBadge({ order }: { order: MerchantOrder }) {
  return <View style={[styles.badge, { backgroundColor: tones[order.status] }]}><View style={[styles.dot, { backgroundColor: colors[order.status] }]}/><Text style={[styles.badgeText, { color: colors[order.status] }]}>{statusLabels[order.status] || order.status}</Text></View>;
}

function OrderDetail({ restaurantId, order, manage, reduced, onClose, onChanged }: {
  restaurantId: string; order: MerchantOrder; manage: boolean; reduced: boolean; onClose: () => void; onChanged?: () => void;
}) {
  const feed = useOrdersFeed();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [delivery, setDelivery] = useState<'OWN' | 'ATLAS_CAR' | null>(null);
  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [quote, setQuote] = useState<(DeliveryQuote & { fingerprint: string }) | null>(null);
  const point = destination(order);
  const fingerprint = `${order.id}|${order.updatedAt}|${latitude}|${longitude}`;
  const currentQuote = quote?.fingerprint === fingerprint ? quote : null;
  const actions = allowedActions(order);
  const primary = actions.find(action => action !== 'CANCEL');
  const atlasStatus = order.atlasStatus || order.atlasDelivery?.status;
  const driver = order.atlasDelivery?.driver;
  async function perform(task: () => Promise<unknown>, message: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setSuccess('');
    try { await task(); if (mounted.current) { setSuccess(message); onChanged?.(); } }
    catch (failure) { if (mounted.current) { setError(errorText(failure)); setQuote(null); } }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function update(action: OrderAction) {
    void perform(async () => { await feed.action(order.id, action, action === 'CANCEL' ? reason.trim() : undefined); if (mounted.current) setCancelOpen(false); }, action === 'CANCEL' ? 'Заказ отменён' : 'Статус заказа обновлён');
  }
  function calculate() {
    void perform(async () => {
      const coordinates = point ? {} : fallbackCoordinates(latitude, longitude);
      const result = await api.request<DeliveryQuote>(`/${encodeURIComponent(restaurantId)}/orders/${encodeURIComponent(order.id)}/dispatch-quote`, 'POST', { method: 'ATLAS_CAR', ...coordinates });
      if (!Number.isSafeInteger(result.price) || result.price <= 0) throw new Error('Не удалось получить стоимость. Повторите расчёт.');
      if (mounted.current) setQuote({ ...result, fingerprint });
    }, 'Расчёт готов. Подтвердите стоимость для вызова.');
  }
  function sendDelivery() {
    void perform(async () => {
      let input: DispatchInput;
      if (delivery === 'OWN') {
        if (courierPhone.trim() && !/^\+?[\d\s()-]{7,30}$/.test(courierPhone.trim())) throw new Error('Проверьте телефон курьера.');
        input = { method: 'OWN', ...(courierName.trim() ? { courierName: courierName.trim() } : {}), ...(courierPhone.trim() ? { courierPhone: courierPhone.trim() } : {}) };
      } else {
        if (!currentQuote) throw new Error('Сначала рассчитайте стоимость Atlas.');
        input = { method: 'ATLAS_CAR', expectedPrice: currentQuote.price, ...(point ? {} : fallbackCoordinates(latitude, longitude)) };
      }
      await feed.dispatch(order.id, input);
      if (mounted.current) { setDelivery(null); setQuote(null); }
    }, delivery === 'OWN' ? 'Заказ передан вашему курьеру' : 'Вызов Atlas подтверждён');
  }
  async function openUrl(url: string) {
    try { await Linking.openURL(url); } catch { setError('Не удалось открыть приложение. Скопируйте адрес или номер из заказа.'); }
  }
  const progress: OrderStatus[] = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY', ...(order.fulfillment === 'DELIVERY' ? ['DELIVERING' as const] : []), 'COMPLETED'];
  return <Modal visible transparent animationType={reduced ? 'none' : 'slide'} onRequestClose={onClose} statusBarTranslucent>
    <View style={styles.overlay}><Pressable style={styles.backdrop} accessibilityLabel="Закрыть заказ" onPress={onClose}/><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.sheet, { marginTop: insets.top + 20, paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.handle}/><View style={styles.sheetHeader}><View style={styles.flex}><Text style={styles.sheetTitle}>Заказ № {orderNumber(order)}</Text><Text style={styles.caption}>{dateTime(order.createdAt)}</Text></View><Pressable accessibilityLabel="Закрыть заказ" onPress={onClose} style={styles.close}><Ionicons name="close" color="#384454" size={25}/></Pressable></View>
      <ScrollView style={{ flex: 1, minHeight: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.detailContent}>
        <View style={styles.row}><StatusBadge order={order}/><Text style={styles.caption}>{order.fulfillment === 'PICKUP' ? 'Самовывоз' : 'Доставка'}</Text></View>
        {order.status !== 'CANCELLED' ? <View style={styles.progress}>{progress.map((status, index) => <View key={status} style={[styles.progressPart, index <= progress.indexOf(order.status) && { backgroundColor: blue }]}/>)}</View> : null}
        <View style={styles.detailCard}><Text style={styles.sectionTitle}>Что готовим</Text>{order.items.map((item, index) => <View key={`${item.dishId}-${index}`} style={styles.lineItem}>
          <View style={styles.row}><View style={styles.quantity}><Text style={styles.quantityText}>{item.quantity}×</Text></View><View style={styles.flex}><Text style={styles.bodyStrong}>{item.name}</Text><Text style={styles.caption}>{item.portion}{item.unitPrice != null ? ` · ${money(item.unitPrice)} / шт.` : ''}</Text></View><Text style={styles.bodyStrong}>{money(item.lineTotal)}</Text></View>
          {item.options?.map((option, optionIndex) => <View key={`${option.id}-${optionIndex}`} style={styles.modifier}><Text style={[styles.caption, styles.flex]}>+ {option.name}</Text><Text style={styles.caption}>{option.price ? `+${money(option.price)}${option.priceScope === 'PER_ITEM' ? ' за заказанную позицию' : ' / шт.'}` : 'включено'}</Text></View>)}
        </View>)}<View style={styles.row}><Text style={[styles.caption, styles.flex]}>Блюда и дополнения</Text><Text style={styles.body}>{money(order.subtotal)}</Text></View><View style={styles.row}><Text style={[styles.caption, styles.flex]}>Доставка клиенту</Text><Text style={styles.body}>{money(order.deliveryFee)}</Text></View><View style={[styles.row, styles.totalRow]}><Text style={[styles.sectionTitle, styles.flex]}>Итого</Text><Text style={styles.total}>{money(order.total)}</Text></View><View style={styles.payment}><Ionicons name="cash-outline" color="#258461" size={19}/><Text style={styles.body}>{order.paymentMethod === 'CASH' ? 'Оплата наличными' : 'Способ оплаты требует уточнения'}</Text></View></View>
        <View style={styles.detailCard}><Text style={styles.sectionTitle}>Клиент</Text><View style={styles.row}><View style={styles.avatar}><Ionicons name="person-outline" color={blue} size={21}/></View><View style={styles.flex}><Text selectable style={styles.bodyStrong}>{order.client?.name || 'Клиент'}</Text>{order.client?.phone ? <Pressable accessibilityRole="link" onPress={() => void openUrl(`tel:${order.client.phone.replace(/[^+\d]/g, '')}`)}><Text selectable style={styles.link}>{order.client.phone}</Text></Pressable> : <Text style={styles.caption}>Телефон не указан</Text>}</View>{order.client?.phone ? <Pressable accessibilityLabel="Позвонить клиенту" onPress={() => void openUrl(`tel:${order.client.phone.replace(/[^+\d]/g, '')}`)} style={styles.call}><Ionicons name="call-outline" color={blue} size={22}/></Pressable> : null}</View>
          {order.fulfillment === 'DELIVERY' ? <><View style={styles.divider}/><Text style={styles.caption}>АДРЕС ДОСТАВКИ</Text><Text selectable style={styles.body}>{order.address || 'Адрес не указан'}</Text>{point ? <Pressable accessibilityRole="link" onPress={() => void openUrl(`https://www.google.com/maps/search/?api=1&query=${point.latitude},${point.longitude}`)} style={styles.row}><Ionicons name="navigate-outline" size={18} color={blue}/><Text style={styles.link}>Открыть на карте</Text><Text selectable style={[styles.small, styles.flex]}>{point.latitude.toFixed(5)}, {point.longitude.toFixed(5)}</Text></Pressable> : <Text style={styles.caption}>В заказе нет точки на карте</Text>}</> : null}
          {order.comment ? <View style={styles.comment}><Text style={styles.caption}>Комментарий клиента</Text><Text selectable style={styles.body}>{order.comment}</Text></View> : null}
        </View>
        {order.deliveryMethod ? <View style={styles.detailCard}><View style={styles.row}><Ionicons name={order.deliveryMethod === 'OWN' ? 'bicycle-outline' : 'car-outline'} color={blue} size={25}/><Text style={styles.sectionTitle}>{order.deliveryMethod === 'OWN' ? 'Ваш курьер' : 'Доставка Atlas'}</Text></View>{order.deliveryMethod === 'OWN' ? <><Text style={styles.body}>{order.courierName || 'Имя курьера не указано'}</Text>{order.courierPhone ? <Pressable onPress={() => void openUrl(`tel:${order.courierPhone!.replace(/[^+\d]/g, '')}`)}><Text selectable style={styles.link}>{order.courierPhone}</Text></Pressable> : <Text style={styles.caption}>Телефон курьера не указан</Text>}</> : <>
          <Text style={styles.bodyStrong}>{atlasStatus ? atlasLabels[atlasStatus] || atlasStatus : 'Обновляем данные доставки'}</Text>{order.atlasOrderId || order.atlasDelivery?.id ? <Text style={styles.caption}>Заявка № {(order.atlasOrderId || order.atlasDelivery!.id).slice(-6).toUpperCase()}</Text> : null}{driver ? <View style={styles.comment}><Text style={styles.bodyStrong}>{driver.name || 'Водитель Atlas'}</Text>{driver.phone ? <Pressable onPress={() => void openUrl(`tel:${driver.phone.replace(/[^+\d]/g, '')}`)}><Text selectable style={styles.link}>{driver.phone}</Text></Pressable> : null}</View> : null}{order.deliveryPrice != null || order.atlasDelivery?.price != null ? <View style={styles.row}><Text style={[styles.caption, styles.flex]}>Поездку оплачивает ресторан</Text><Text style={styles.bodyStrong}>{money(order.deliveryPrice ?? order.atlasDelivery!.price)}</Text></View> : null}<Text style={styles.caption}>Статусы поездки обновляются вместе с заказом. Завершение активной доставки подтверждает водитель Atlas.</Text></>}</View> : null}
        {error ? <View accessibilityRole="alert" style={styles.errorBox}><Ionicons name="alert-circle-outline" size={21} color="#C74646"/><Text style={[styles.error, styles.flex]}>{error}</Text></View> : null}
        {success ? <View accessibilityLiveRegion="polite" style={styles.successBox}><Ionicons name="checkmark-circle" size={21} color="#23815C"/><Text style={[styles.success, styles.flex]}>{success}</Text></View> : null}
        {manage && canDispatch(order) ? <View style={styles.detailCard}><Text style={styles.sectionTitle}>Заказ готов. Отправляем?</Text><Text style={styles.caption}>Выберите способ доставки до клиента</Text><View style={styles.deliveryChoices}>{(['OWN', 'ATLAS_CAR'] as const).map(method => <Pressable key={method} disabled={busy} accessibilityState={{ selected: delivery === method, disabled: busy }} onPress={() => { setDelivery(method); setQuote(null); setError(''); setSuccess(''); }} style={[styles.deliveryChoice, delivery === method && styles.deliverySelected]}><Ionicons name={method === 'OWN' ? 'bicycle-outline' : 'car-outline'} color={delivery === method ? blue : '#667586'} size={28}/><Text style={[styles.bodyStrong, delivery === method && { color: blue }]}>{method === 'OWN' ? 'Свой курьер' : 'Машина Atlas'}</Text><Text style={styles.small}>{method === 'OWN' ? 'Доставим сами' : 'Вызов с расчётом'}</Text></Pressable>)}</View>
          {delivery === 'OWN' ? <><Input label="Имя курьера" value={courierName} onChange={setCourierName} placeholder="Необязательно" maxLength={150}/><Input label="Телефон курьера" value={courierPhone} onChange={setCourierPhone} placeholder="+996" keyboard="phone-pad" maxLength={30}/><ActionButton label="Передать своему курьеру" busy={busy} onPress={sendDelivery}/></> : null}
          {delivery === 'ATLAS_CAR' ? <><Text style={styles.caption}>Стоимость машины оплачивает ресторан. Цена заказа для клиента остаётся прежней.</Text>{!point ? <><Text style={styles.warningTitle}>Укажите точку доставки клиента</Text><Input label="Широта" value={latitude} onChange={value => { setLatitude(value); setQuote(null); }} placeholder="Например, 42.8746" keyboard="numbers-and-punctuation"/><Input label="Долгота" value={longitude} onChange={value => { setLongitude(value); setQuote(null); }} placeholder="Например, 74.5698" keyboard="numbers-and-punctuation"/></> : null}{currentQuote ? <><View style={styles.quote}><Text style={styles.caption}>Стоимость автомобиля Atlas</Text><Text style={styles.quotePrice}>{money(currentQuote.price)}</Text><Text style={styles.caption}>Оплачивает ресторан</Text></View><ActionButton label={`Подтвердить вызов · ${money(currentQuote.price)}`} busy={busy} onPress={sendDelivery}/><ActionButton label="Обновить расчёт" secondary disabled={busy} onPress={calculate}/></> : <ActionButton label="Рассчитать стоимость Atlas" busy={busy} onPress={calculate}/>}</> : null}
        </View> : null}
        <View style={styles.detailCard}><Text style={styles.sectionTitle}>История заказа</Text>{order.history?.length ? [...order.history].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((event, index) => <View key={event.id} style={styles.historyRow}><View style={styles.historyRail}><View style={[styles.historyDot, { backgroundColor: colors[event.status] }]}/>{index < order.history!.length - 1 ? <View style={styles.historyLine}/> : null}</View><View style={styles.flex}><Text style={styles.bodyStrong}>{statusLabels[event.status] || event.status}</Text><Text style={styles.caption}>{dateTime(event.createdAt)}</Text>{event.reason ? <Text style={styles.small}>{historyReason(event.reason)}</Text> : null}</View></View>) : <Text style={styles.caption}>Сервер пока не передал историю этого заказа.</Text>}</View>
        {manage && actions.includes('CANCEL') ? cancelOpen ? <View style={styles.detailCard}><Text style={styles.sectionTitle}>Отмена заказа</Text><Input label="Причина отмены" value={reason} onChange={setReason} placeholder="Объясните, почему заказ не получится выполнить" multiline maxLength={500}/><ActionButton label="Подтвердить отмену" danger busy={busy} disabled={!reason.trim()} onPress={() => update('CANCEL')}/><ActionButton label="Вернуться к заказу" secondary disabled={busy} onPress={() => setCancelOpen(false)}/></View> : <ActionButton label="Отменить заказ" secondary danger disabled={busy} onPress={() => setCancelOpen(true)}/> : null}
      </ScrollView>
      {manage && primary ? <View style={styles.actionFooter}><ActionButton label={primary === 'COMPLETE' && order.fulfillment === 'PICKUP' ? 'Выдать заказ клиенту' : actionLabels[primary]} busy={busy} onPress={() => update(primary)}/></View> : null}
    </KeyboardAvoidingView></View>
  </Modal>;
}

function historyReason(reason: string): string {
  if (reason === 'CLIENT_CANCELLED') return 'Отменён клиентом';
  if (reason === 'OWN_COURIER') return 'Передан своему курьеру';
  if (reason.startsWith('OWN_AFTER_ATLAS:')) return 'Передан своему курьеру после вызова Atlas';
  if (reason.startsWith('ATLAS_DISPATCH:')) return 'Создана заявка Atlas';
  if (reason.startsWith('ATLAS_')) return atlasLabels[reason.slice(6).split(':')[0]] || 'Обновление доставки Atlas';
  return reason;
}
function Input({ label, value, onChange, placeholder, keyboard = 'default', multiline, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
  keyboard?: 'default' | 'phone-pad' | 'numbers-and-punctuation'; multiline?: boolean; maxLength?: number;
}) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#929CA8" keyboardType={keyboard} multiline={multiline} maxLength={maxLength} style={[styles.input, multiline && { minHeight: 90, textAlignVertical: 'top' }]}/></View>;
}
function ActionButton({ label, onPress, disabled, busy, secondary, danger }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.buttonSecondary, danger && !secondary && { backgroundColor: '#C74646' }, (disabled || busy) && { opacity: 0.55 }, pressed && styles.pressed]}>{busy ? <ActivityIndicator color={secondary ? blue : 'white'}/> : <Text style={[styles.buttonText, secondary && { color: blue }, secondary && danger && { color: '#C74646' }]}>{label}</Text>}</Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F7F9' }, flex: { flex: 1 }, row: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  list: { paddingHorizontal: 18, paddingBottom: 28, gap: 13, width: '100%', maxWidth: 900, alignSelf: 'center' }, header: { paddingTop: 8, gap: 17, paddingBottom: 5 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.5, color: '#8A96A3', marginBottom: 6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 32, letterSpacing: -1.1, color: '#172431' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#8A95A1', marginTop: -10, lineHeight: 20 },
  counter: { alignItems: 'center', backgroundColor: 'white', paddingHorizontal: 17, paddingVertical: 10, borderRadius: 19 }, counterNumber: { fontFamily: 'Inter_700Bold', fontSize: 24, color: blue },
  filters: { gap: 7 }, pill: { paddingHorizontal: 16, paddingVertical: 13, minHeight: 44, borderRadius: 25, backgroundColor: '#EDEFF2' }, pillActive: { backgroundColor: '#172431' }, pillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#727F8D' }, white: { color: 'white' },
  search: { borderRadius: 17, backgroundColor: 'white', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, minHeight: 50, gap: 9 }, searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: '#172431', paddingVertical: 14 }, searchClear: { minWidth: 40, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  card: { padding: 18, backgroundColor: 'white', borderRadius: 24, gap: 16, borderWidth: 1, borderColor: 'white' }, cardHighlighted: { borderColor: '#ACD3FF' }, pressed: { opacity: 0.76 },
  orderNumber: { fontFamily: 'Inter_700Bold', fontSize: 19, color: '#172431', letterSpacing: -0.4, marginBottom: 5 }, badge: { flexDirection: 'row', alignItems: 'center', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 8, gap: 5 }, badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 }, dot: { width: 5, height: 5, borderRadius: 3 },
  caption: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#7E8997', lineHeight: 19 }, small: { fontFamily: 'Inter_400Regular', fontSize: 10, color: '#8A95A1', lineHeight: 16 },
  foodThumb: { width: 58, height: 58, borderRadius: 17, backgroundColor: '#EFF4F9', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }, fill: { width: '100%', height: '100%' }, orderDishes: { fontFamily: 'Inter_500Medium', fontSize: 14, color: '#243140', lineHeight: 21, marginBottom: 3 },
  commentPreview: { flexDirection: 'row', gap: 6, alignItems: 'center', backgroundColor: '#F7F8FA', borderRadius: 11, paddingHorizontal: 10, paddingVertical: 6 }, cardBottom: { borderTopWidth: 1, borderTopColor: '#F1F3F5', paddingTop: 13, flexDirection: 'row', alignItems: 'center' }, cardPrice: { fontFamily: 'Inter_700Bold', fontSize: 22, color: '#172431', marginTop: 5 }, openCircle: { backgroundColor: '#EEF5FE', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  warning: { padding: 13, borderRadius: 16, gap: 9, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF4DF' }, warningTitle: { fontFamily: 'Inter_600SemiBold', color: '#9D651B', fontSize: 13, lineHeight: 20 }, iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingHorizontal: 25, paddingVertical: 48, gap: 15 }, emptyIcon: { width: 78, height: 78, borderRadius: 27, backgroundColor: '#E7F1FE', alignItems: 'center', justifyContent: 'center', marginBottom: 5 }, emptyBody: { fontFamily: 'Inter_400Regular', color: '#87929F', fontSize: 14, lineHeight: 22, textAlign: 'center' }, footer: { fontFamily: 'Inter_400Regular', fontSize: 10, color: '#9AA3AE', textAlign: 'center', marginTop: 4, padding: 10 },
  skeletons: { gap: 13 }, skeleton: { padding: 22, gap: 20, borderRadius: 24, backgroundColor: 'white' }, skeletonLine: { backgroundColor: '#EDF0F4', height: 18, width: '95%', borderRadius: 8 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#10223A66' }, backdrop: { ...StyleSheet.absoluteFillObject }, sheet: { height: '94%', maxHeight: '96%', width: '100%', maxWidth: 680, alignSelf: 'center', backgroundColor: '#F6F7F9', borderTopLeftRadius: 30, borderTopRightRadius: 30, overflow: 'hidden', flexShrink: 1 }, handle: { width: 34, height: 4, borderRadius: 2, backgroundColor: '#D6DDE6', alignSelf: 'center', marginTop: 10 }, sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 22, paddingVertical: 17, gap: 10 }, sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 23, color: '#172431', letterSpacing: -0.5, marginBottom: 5 }, close: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E9EDF2', alignItems: 'center', justifyContent: 'center' }, detailContent: { paddingHorizontal: 18, paddingBottom: 20, gap: 15 },
  progress: { flexDirection: 'row', gap: 5, marginTop: -3 }, progressPart: { flex: 1, height: 4, borderRadius: 3, backgroundColor: '#DFE5EC' }, detailCard: { backgroundColor: 'white', padding: 19, borderRadius: 23, gap: 13 }, sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#172431', letterSpacing: -0.35 }, body: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#374452', lineHeight: 22 }, bodyStrong: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#253241', lineHeight: 21 },
  lineItem: { gap: 8, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F0F3F6' }, quantity: { width: 35, height: 35, borderRadius: 12, backgroundColor: '#F0F5FB', alignItems: 'center', justifyContent: 'center' }, quantityText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: blue }, modifier: { flexDirection: 'row', gap: 9, paddingLeft: 44 }, totalRow: { paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F0F3F6' }, total: { fontFamily: 'Inter_700Bold', fontSize: 23, color: blue }, payment: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  avatar: { width: 43, height: 43, backgroundColor: '#EDF4FE', borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, link: { fontFamily: 'Inter_500Medium', color: blue, fontSize: 14, lineHeight: 24 }, call: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EDF4FE', justifyContent: 'center', alignItems: 'center' }, divider: { height: 1, backgroundColor: '#F0F3F6' }, comment: { padding: 13, gap: 5, backgroundColor: '#F5F7FA', borderRadius: 14 },
  errorBox: { padding: 15, backgroundColor: '#FCEDEC', borderRadius: 16, flexDirection: 'row', gap: 8 }, error: { color: '#B43B3B', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 21 }, successBox: { padding: 15, backgroundColor: '#E8F5EE', borderRadius: 16, flexDirection: 'row', gap: 8 }, success: { color: '#23815C', fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 21 },
  deliveryChoices: { flexDirection: 'row', gap: 10 }, deliveryChoice: { flex: 1, padding: 14, borderWidth: 1.5, borderColor: '#E9EEF4', borderRadius: 18, gap: 6, alignItems: 'flex-start' }, deliverySelected: { borderColor: blue, backgroundColor: '#F0F6FE' },
  field: { gap: 7 }, fieldLabel: { fontFamily: 'Inter_500Medium', color: '#657282', fontSize: 12 }, input: { backgroundColor: '#F3F5F8', color: '#243241', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 14, minHeight: 49, fontFamily: 'Inter_400Regular', fontSize: 14 },
  quote: { padding: 17, borderRadius: 17, backgroundColor: '#EAF3FF', gap: 7 }, quotePrice: { fontFamily: 'Inter_700Bold', color: blue, fontSize: 30 },
  historyRow: { flexDirection: 'row', gap: 11 }, historyRail: { alignItems: 'center', width: 16 }, historyDot: { width: 9, height: 9, borderRadius: 5, marginTop: 6 }, historyLine: { width: 1, flex: 1, backgroundColor: '#E2E8F0', minHeight: 25, marginTop: 5 },
  button: { backgroundColor: blue, minHeight: 52, borderRadius: 17, paddingHorizontal: 15, paddingVertical: 15, justifyContent: 'center', alignItems: 'center' }, buttonSecondary: { backgroundColor: '#EAF2FC' }, buttonText: { fontFamily: 'Inter_600SemiBold', color: 'white', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  actionFooter: { flexShrink: 0, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 4, backgroundColor: '#F6F7F9', borderTopWidth: 1, borderTopColor: '#E9EDF2' },
});

