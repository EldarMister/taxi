import React, { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Empty, Field, Sheet, c, s } from './ui';
import type { MerchantOrder, OrderAction } from './types';
import { money } from './types';
import { restaurantApi } from './api';

const statusTitles: Record<string, string> = { PLACED: 'Новый', CONFIRMED: 'Принят', PREPARING: 'Готовится', READY: 'Готов к выдаче', DELIVERING: 'В доставке', COMPLETED: 'Завершён', CANCELLED: 'Отменён' };
const statusColors: Record<string, string> = { PLACED: c.blue, CONFIRMED: c.blue, PREPARING: '#AD7200', READY: c.green, DELIVERING: c.blue, COMPLETED: c.muted, CANCELLED: c.danger };
const time = (date: string) => new Date(date).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const orderNumber = (order: MerchantOrder) => order.id.slice(-6).toUpperCase();
const active = (order: MerchantOrder) => !['COMPLETED', 'CANCELLED'].includes(order.status);
type Props = { restaurantId: string; orders: MerchantOrder[]; canManage: boolean; reload: () => Promise<void> };
export function OrdersScreen({ restaurantId, orders, canManage, reload }: Props) {
  const [filter, setFilter] = useState<'active' | 'new' | 'history'>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visible = orders.filter(order => filter === 'active' ? active(order) : filter === 'new' ? order.status === 'PLACED' : !active(order));
  const selected = orders.find(order => order.id === selectedId);
  return <>
    <View style={s.row}><View style={s.flex}><Text style={s.title}>Заказы</Text><Text style={s.caption}>{orders.filter(active).length} в работе</Text></View><View style={[s.iconButton, { backgroundColor: c.soft }]}><Ionicons name="receipt-outline" size={24} color={c.blue}/></View></View>
    <View style={s.chips}>{([['active', 'В работе'], ['new', `Новые · ${orders.filter(order => order.status === 'PLACED').length}`], ['history', 'История']] as const).map(([id, label]) => <Pressable key={id} onPress={() => setFilter(id)} style={[s.chip, filter === id && { backgroundColor: c.blue }]}><Text style={[s.label, filter === id && { color: 'white' }]}>{label}</Text></Pressable>)}</View>
    {visible.length ? visible.map(order => <Pressable key={order.id} onPress={() => setSelectedId(order.id)}><Card>
      <View style={s.row}><Text style={[s.heading, s.flex]}>№ {orderNumber(order)}</Text><Text style={[s.label, { color: statusColors[order.status] }]}>{statusTitles[order.status] || order.status}</Text></View>
      <Text style={s.caption}>{time(order.createdAt)}</Text><Text style={s.body} numberOfLines={2}>{order.items.map(item => `${item.quantity} × ${item.name}`).join(', ')}</Text>
      <View style={s.row}><Ionicons name="location-outline" size={17} color={c.muted}/><Text style={[s.caption, s.flex]} numberOfLines={1}>{order.address || 'Адрес не указан'}</Text></View>
      <View style={s.row}><Text style={[s.heading, s.flex]}>{money(order.total)}</Text><Text style={[s.label, { color: c.blue }]}>Открыть</Text><Ionicons name="chevron-forward" size={16} color={c.blue}/></View>
    </Card></Pressable>) : <Empty icon="receipt-outline" title={filter === 'history' ? 'История пока пуста' : 'Заказов пока нет'} body={filter === 'history' ? 'Завершённые и отменённые заказы появятся здесь.' : 'Новые заказы появятся автоматически. Потяните экран вниз, чтобы обновить.'}/>}
    {selected ? <OrderDetail restaurantId={restaurantId} order={selected} canManage={canManage} reload={reload} onClose={() => setSelectedId(null)}/> : null}
  </>;
}

function OrderDetail({ restaurantId, order, canManage, reload, onClose }: Omit<Props, 'orders'> & { order: MerchantOrder; onClose: () => void }) {
  const [dispatch, setDispatch] = useState<'OWN' | 'ATLAS_CAR' | null>(null);
  const [courierName, setCourierName] = useState('');
  const [courierPhone, setCourierPhone] = useState('');
  const destination = order.deliveryPoint || (order.deliveryLat != null && order.deliveryLng != null ? { latitude: order.deliveryLat, longitude: order.deliveryLng } : null);
  const [latitude, setLatitude] = useState(destination ? String(destination.latitude) : '');
  const [longitude, setLongitude] = useState(destination ? String(destination.longitude) : '');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<{ price: number } | null>(null);
  const coordinates = () => destination ? {} : { deliveryLat: Number(latitude), deliveryLng: Number(longitude) };
  function validateCoordinates() {
    if (!destination && (!latitude.trim() || !longitude.trim() || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)) || Math.abs(Number(latitude)) > 90 || Math.abs(Number(longitude)) > 180)) throw new Error('Для автомобильной доставки укажите координаты адреса клиента.');
  }
  async function calculateDelivery() {
    setBusy(true); setError(''); setQuote(null);
    try {
      validateCoordinates();
      const next = await restaurantApi.request<{ price: number }>(`/${restaurantId}/orders/${order.id}/dispatch-quote`, 'POST', { method: 'ATLAS_CAR', ...coordinates() });
      setQuote(next);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function update(action: OrderAction) {
    setBusy(true); setError('');
    try { await restaurantApi.request(`/${restaurantId}/orders/${order.id}`, 'PATCH', { action, ...(action === 'CANCEL' ? { reason: reason.trim() } : {}) }); await reload(); setCancelOpen(false); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function send() {
    setBusy(true); setError('');
    try {
      if (dispatch === 'ATLAS_CAR') { validateCoordinates(); if (!quote) throw new Error('Сначала рассчитайте стоимость автомобиля.'); }
      await restaurantApi.request(`/${restaurantId}/orders/${order.id}/dispatch`, 'POST', {
        method: dispatch,
        ...(dispatch === 'OWN' ? { ...(courierName.trim() ? { courierName: courierName.trim() } : {}), ...(courierPhone.trim() ? { courierPhone: courierPhone.trim() } : {}) } : { ...coordinates(), expectedPrice: quote!.price }),
      }); await reload(); setDispatch(null);
    } catch (error) { setError((error as Error).message); setQuote(null); } finally { setBusy(false); }
  }
  const next = ({ PLACED: ['ACCEPT', 'Принять заказ'], CONFIRMED: ['PREPARING', 'Начать готовить'], PREPARING: ['READY', 'Заказ готов'] } as const)[order.status as 'PLACED' | 'CONFIRMED' | 'PREPARING'];
  return <Sheet title={`Заказ № ${orderNumber(order)}`} visible onClose={onClose}>
    <View style={[s.chip, { alignSelf: 'flex-start', backgroundColor: c.soft }]}><Text style={[s.body, { color: statusColors[order.status] }]}>{statusTitles[order.status]}</Text></View>
    <Text style={s.caption}>{time(order.createdAt)}</Text>
    <Card><Text style={s.heading}>Состав заказа</Text>{order.items.map((item, index) => <View key={`${item.dishId}-${index}`} style={{ paddingVertical: 10, gap: 5, borderBottomColor: c.line, borderBottomWidth: 1 }}><View style={s.row}><Text style={[s.body, s.flex]}>{item.quantity} × {item.name}</Text><Text style={s.body}>{money(item.lineTotal)}</Text></View>{item.options.length ? <Text style={s.caption}>{item.options.map(option => option.name).join(', ')}</Text> : null}<Text style={s.caption}>{item.portion}</Text></View>)}<View style={s.row}><Text style={[s.body, s.flex]}>Доставка</Text><Text style={s.body}>{money(order.deliveryFee)}</Text></View><View style={s.row}><Text style={[s.heading, s.flex]}>Итого</Text><Text style={[s.heading, { color: c.blue }]}>{money(order.total)}</Text></View><Text style={s.caption}>{order.paymentMethod === 'CASH' ? 'Оплата наличными' : order.paymentMethod === 'CARD' ? 'Оплата картой' : 'Онлайн-оплата'}</Text></Card>
    <Card><Text style={s.heading}>Клиент и доставка</Text><Text style={s.body}>{order.client?.name || 'Клиент'}</Text>{order.client?.phone ? <Pressable onPress={() => Linking.openURL(`tel:${order.client.phone}`)}><Text style={[s.body, { color: c.blue }]}>{order.client.phone}</Text></Pressable> : null}<Text style={s.body}>{order.address}</Text>{order.comment ? <View style={{ padding: 13, backgroundColor: c.canvas, borderRadius: 13 }}><Text style={s.caption}>Комментарий</Text><Text style={s.body}>{order.comment}</Text></View> : null}{order.deliveryMethod ? <Text style={s.body}>{order.deliveryMethod === 'ATLAS_CAR' ? 'Автомобильная доставка Atlas' : 'Собственный курьер'}{order.courierName ? ` · ${order.courierName}` : ''}</Text> : null}{order.atlasOrderId ? <Text style={s.caption}>Доставка № {order.atlasOrderId.slice(-6).toUpperCase()}</Text> : null}{order.deliveryMethod === 'ATLAS_CAR' && order.deliveryPrice != null ? <Text style={s.caption}>К оплате рестораном за автомобиль: {money(order.deliveryPrice)}</Text> : null}{order.atlasStatus ? <Text style={s.caption}>{({ SEARCHING: 'Ищем автомобиль', ASSIGNED: 'Водитель назначен', ARRIVED: 'Водитель у ресторана', IN_PROGRESS: 'Водитель в пути к клиенту', COMPLETED: 'Доставлено', CANCELLED: 'Вызов отменён', NO_DRIVER: 'Автомобиль не найден' } as Record<string, string>)[order.atlasStatus] || 'Доставка в работе'}</Text> : null}</Card>
    {error ? <Text style={s.error}>{error}</Text> : null}
    {canManage && next ? <Button title={next[1]} busy={busy} onPress={() => update(next[0])}/> : null}
    {canManage && order.status === 'READY' && (!order.deliveryMethod || order.deliveryMethod === 'ATLAS_CAR' && ['NO_DRIVER', 'CANCELLED'].includes(order.atlasStatus || '')) ? <Card><Text style={s.heading}>Отправить заказ</Text><Text style={s.caption}>Выберите, кто доставит заказ клиенту. Поездку автомобиля Atlas по тарифу доставки оплачивает ресторан.</Text><Button title="Собственный курьер" secondary onPress={() => { setDispatch('OWN'); setError(''); setQuote(null); }}/><Button title="Автомобиль Atlas" onPress={() => { setDispatch('ATLAS_CAR'); setError(''); setQuote(null); }}/></Card> : null}
    {dispatch ? <Card><Text style={s.heading}>{dispatch === 'OWN' ? 'Собственный курьер' : 'Доставка автомобилем Atlas'}</Text>{dispatch === 'OWN' ? <><Field label="Имя курьера (необязательно)" value={courierName} onChange={setCourierName}/><Field label="Телефон курьера (необязательно)" value={courierPhone} onChange={setCourierPhone}/></> : <><Text style={s.caption}>Atlas отправит заказ водителям автомобильной доставки. Курьер заберёт его по адресу ресторана.</Text>{!destination ? <><Text style={s.caption}>В старом заказе нет точки на карте. Укажите координаты адреса клиента.</Text><Field label="Широта адреса клиента" value={latitude} onChange={value => { setLatitude(value); setQuote(null); }} numeric/><Field label="Долгота адреса клиента" value={longitude} onChange={value => { setLongitude(value); setQuote(null); }} numeric/></> : null}{quote ? <View style={{ padding: 16, backgroundColor: c.soft, borderRadius: 15, gap: 5 }}><Text style={s.caption}>Стоимость автомобиля Atlas</Text><Text style={[s.heading, { color: c.blue }]}>{money(quote.price)}</Text><Text style={s.caption}>Оплачивает ресторан. Условия доставки для клиента не меняются.</Text></View> : null}</>}<Button title={dispatch === 'OWN' ? 'Передать курьеру' : quote ? `Вызвать Atlas · ${money(quote.price)}` : 'Рассчитать стоимость автомобиля'} busy={busy} onPress={dispatch === 'ATLAS_CAR' && !quote ? calculateDelivery : send}/><Button title="Отмена" secondary disabled={busy} onPress={() => { setDispatch(null); setQuote(null); }}/></Card> : null}
    {canManage && order.status === 'DELIVERING' && order.deliveryMethod === 'OWN' ? <Button title="Заказ доставлен" busy={busy} onPress={() => update('COMPLETE')}/> : null}
    {canManage && active(order) && order.status !== 'DELIVERING' ? cancelOpen ? <Card><Field label="Причина отмены" value={reason} onChange={setReason} multiline/><Button title="Подтвердить отмену заказа" danger busy={busy} disabled={!reason.trim()} onPress={() => update('CANCEL')}/><Button title="Вернуться к заказу" secondary onPress={() => setCancelOpen(false)}/></Card> : <Button title="Отменить заказ" danger disabled={busy} onPress={() => setCancelOpen(true)}/> : null}
  </Sheet>;
}
