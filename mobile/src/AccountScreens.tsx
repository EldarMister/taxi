import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api, messageOf } from './api';
import { getNotificationPermissionState, openNotificationSettings, registerPushNotifications, requestNotificationAccess } from './native/push';
import { useTheme } from './design/theme';
import type { ThemePreference } from './design/theme';
import type { AppConfig, Balance, Language, Order, User } from './types';
import { Avatar, Button, Car, colors, Empty, Icon, km, mins, money, Route, s as lightUi, shortAddress, ToggleSwitch, tr } from './ui';
import { ClientHistoryRow, ClientTripHistoryDetail } from './ClientTripHistory';

export type Page = 'home' | 'profile' | 'history' | 'balance' | 'settings' | 'support' | 'payment';
const completedOrders = (orders: Order[]) => orders.filter(order => order.status === 'COMPLETED');
const income = (orders: Order[]) => completedOrders(orders).reduce((total, order) => total + Number(order.price), 0);
const orderStatus = { COMPLETED: 'Завершён', CANCELLED: 'Отменён', IN_PROGRESS: 'В пути', ASSIGNED: 'Найден', ARRIVED: 'Ожидание', SEARCHING: 'Поиск', NO_DRIVER: 'Нет водителя' };

function Stat({ value, label }: { value: string; label: string }) {
  const styles = useAccountStyles();
  return <View style={styles.stat}><Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>;
}

function HistoryRow({ order, user, expanded, onPress }: { order: Order; user: User; expanded: boolean; onPress: () => void }) {
  const styles = useAccountStyles();
  const s = useAccountUi();
  const { isDark, palette } = useTheme();
  const t = tr(user.language);
  const done = order.status === 'COMPLETED';
  return <View style={styles.historyCard}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${t('Детали поездки')}: ${order.pickup.address} — ${order.dropoff.address}`} accessibilityState={{ expanded }} onPress={onPress} style={({ pressed }) => [styles.historyRow, pressed && { opacity: .65 }]}>
      <View style={styles.timeColumn}><Text style={styles.historyTime}>{new Date(order.createdAt).toLocaleTimeString(user.language === 'ky' ? 'ky-KG' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}</Text></View>
      <View style={styles.historyRoute}>
        <View style={styles.routePins}><Icon name="radio-button-on" color={palette.accent} size={15}/><View style={styles.routeDash}/><Icon name="location" color={palette.ink} size={16}/></View>
        <View style={{ flex: 1, gap: 5 }}><Text style={styles.historyAddress} numberOfLines={1}>{shortAddress(order.pickup.address)}</Text><Text style={styles.historyAddress} numberOfLines={1}>{shortAddress(order.dropoff.address)}</Text><Text style={styles.historyMeta}>{km(order.distanceMeters)} · {mins(order.durationSeconds, user.language)}</Text></View>
      </View>
      <View style={styles.historyAmount}><View style={[styles.statusPill, { backgroundColor: isDark ? '#252525' : done ? '#E3F9ED' : colors.pale }]}><Text style={[styles.statusText, { color: isDark ? '#FFFFFF' : done ? '#159447' : palette.muted }]}>{t(orderStatus[order.status])}</Text></View><Text style={styles.historyPrice} numberOfLines={1} adjustsFontSizeToFit>{money(order.price)}</Text></View>
      <Icon name={expanded ? 'chevron-down' : 'chevron-forward'} color={palette.muted} size={17}/>
    </Pressable>
    {expanded && <View style={styles.historyDetails}><Route order={order} t={t}/><View style={s.divider}/><View style={s.spread}><Text style={s.muted}>{t('Наличные')}</Text><Text style={s.h3}>{money(order.price)}</Text></View>{order.comment ? <Text style={s.muted}>{order.comment}</Text> : null}{order.rating != null && <View style={s.row}><Icon name="star" color={palette.accent} size={17}/><Text style={s.body}>{order.rating}</Text></View>}</View>}
  </View>;
}

export function AccountScreen({ page, user, config, onUser, onError, onOnline, onNavigate, busy, themePreference, onThemePreferenceChange, historyDetailId, onHistoryDetailId }: { page: Page; user: User; config: AppConfig | null; onUser: (user: User) => void; onError: (error: string) => void; onOnline: (online: boolean) => void; onNavigate: (page: Page) => void; busy: boolean; themePreference: ThemePreference; onThemePreferenceChange: (preference: ThemePreference) => void; historyDetailId: string | null; onHistoryDetailId: (id: string | null) => void }) {
  const styles = useAccountStyles();
  const s = useAccountUi();
  const t = tr(user.language);
  const local = (ru: string, ky: string) => user.language === 'ky' ? ky : ru;
  const { isDark, palette } = useTheme();
  const [name, setName] = useState(user.name || '');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [period, setPeriod] = useState('today');
  const [history, setHistory] = useState<Order[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [earnings, setEarnings] = useState<{ today: Order[]; week: Order[] } | null>(null);
  const [loading, setLoading] = useState(['history', 'balance'].includes(page) || (page === 'profile' && user.role === 'DRIVER'));
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<boolean | null>(null);
  const requestVersion = useRef(0);

  async function refresh() {
    if (!['history', 'balance'].includes(page) && !(page === 'profile' && user.role === 'DRIVER')) return;
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      if (page === 'history') {
        const result = await api.request<Order[]>(`/orders/history?period=${period}`);
        if (version === requestVersion.current) setHistory(result);
      } else if (page === 'balance') {
        const result = await api.request<Balance>('/driver/balance');
        if (version === requestVersion.current) setBalance(result);
      } else {
        const [deposit, today, week] = await Promise.all([api.request<Balance>('/driver/balance'), api.request<Order[]>('/orders/history?period=today'), api.request<Order[]>('/orders/history?period=week')]);
        if (version === requestVersion.current) { setBalance(deposit); setEarnings({ today, week }); }
      }
    } catch (error) { if (version === requestVersion.current) onError(messageOf(error)); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }
  useEffect(() => { void refresh(); return () => { requestVersion.current += 1; }; }, [page, period]);
  useEffect(() => {
    if (page !== 'settings') return;
    const refreshPermission = () => { void getNotificationPermissionState().then(value => setNotificationPermission(value.granted)).catch(() => undefined); };
    refreshPermission();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refreshPermission(); });
    return () => subscription.remove();
  }, [page, user.id]);
  async function update(patch: Partial<Pick<User, 'name' | 'notifications' | 'language'>>) {
    setSaving(true);
    try {
      if (patch.notifications === true) {
        const permission = await requestNotificationAccess();
        if (permission.supported === false) throw new Error('Уведомления недоступны на этом устройстве. Заказы можно отслеживать в приложении.');
        if (!permission.granted) {
          if (!permission.canAskAgain) await openNotificationSettings();
          throw new Error(permission.canAskAgain ? 'Разрешите уведомления, чтобы не пропустить события поездки.' : 'Разрешите уведомления в настройках устройства.');
        }
        setNotificationPermission(true);
      }
      onUser(await api.patch<User>('/users/me', patch));
      if (patch.notifications === true) void registerPushNotifications();
      if (patch.name !== undefined) setEditing(false);
    }
    catch (error) { onError(messageOf(error)); }
    finally { setSaving(false); }
  }
  async function updatePreferences(patch: Partial<Pick<NonNullable<User['driverProfile']>, 'acceptsEconomy' | 'acceptsComfort' | 'acceptsDeliveryCar' | 'acceptsDeliveryTruck'>>) {
    if (!user.driverProfile) return;
    setSaving(true);
    try { onUser(await api.patch<User>('/driver/preferences', patch)); }
    catch (error) { onError(messageOf(error)); }
    finally { setSaving(false); }
  }
  async function chooseAvatar() {
    if (user.role !== 'DRIVER' || avatarSaving) return;
    setAvatarSaving(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: .8,
        allowsMultipleSelection: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const side = Math.min(asset.width, asset.height);
      const actions: ImageManipulator.Action[] = side > 0 ? [
        { crop: { originX: Math.max(0, (asset.width - side) / 2), originY: Math.max(0, (asset.height - side) / 2), width: side, height: side } },
        { resize: { width: Math.min(720, side), height: Math.min(720, side) } },
      ] : [{ resize: { width: 720, height: 720 } }];
      const normalized = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: .8, format: ImageManipulator.SaveFormat.JPEG });
      const form = new FormData();
      form.append('avatar', { uri: normalized.uri, name: 'avatar.jpg', type: 'image/jpeg' } as unknown as Blob);
      onUser(await api.upload<User>('/users/me/avatar', form));
    } catch (error) { onError(messageOf(error)); }
    finally { setAvatarSaving(false); }
  }
  const completed = completedOrders(history);
  const locale = user.language === 'ky' ? 'ky-KG' : 'ru-RU';
  const groups = history.reduce<Array<{ date: string; orders: Order[] }>>((result, order) => {
    const date = new Date(order.createdAt).toLocaleDateString(locale, { day: 'numeric', month: 'long', ...(new Date(order.createdAt).getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) });
    const group = result[result.length - 1];
    if (group?.date === date) group.orders.push(order); else result.push({ date, orders: [order] });
    return result;
  }, []);
  const driverProfile = user.driverProfile;

  return <ScrollView key={page === 'history' && user.role === 'CLIENT' ? historyDetailId || 'history-list' : page} showsVerticalScrollIndicator={false} style={{ backgroundColor: isDark ? palette.background : page === 'profile' ? '#F3F8FC' : '#FFFFFF' }} contentContainerStyle={styles.page} refreshControl={['history', 'balance'].includes(page) || (page === 'profile' && user.role === 'DRIVER') ? <RefreshControl refreshing={loading} onRefresh={refresh} tintColor={palette.accent}/> : undefined} keyboardShouldPersistTaps="handled">
    {page === 'profile' && <>
      <View style={styles.profileCard}>
        <Pressable accessibilityRole="button" accessibilityLabel={local('Редактировать профиль', 'Профилди түзөтүү')} accessibilityState={{ expanded: editing }} onPress={() => { setName(user.name || ''); setEditing(!editing); }} style={styles.profilePerson}>
          {user.role === 'DRIVER' && <View><Avatar user={user} size={76}/>{driverProfile && <View style={[styles.onlineDot, { backgroundColor: isDark ? driverProfile.online ? '#FFFFFF' : '#777777' : driverProfile.online ? colors.green : '#A5B3C2' }]}/>}</View>}
          <View style={{ flex: 1, gap: 7 }}><Text style={styles.profileName} numberOfLines={2}>{user.name || t('Профиль')}</Text><Text style={styles.profilePhone}>{user.phone}</Text>{driverProfile && <View style={[s.row, { gap: 6 }]}><Icon name="star" color={palette.accent} size={19}/><Text style={styles.rating}>{driverProfile.rating == null ? '—' : Number(driverProfile.rating).toFixed(1)}</Text>{driverProfile.completedTrips != null && <Text style={s.caption}>{local(`(${driverProfile.completedTrips} поездок)`, `(${driverProfile.completedTrips} сапар)`)}</Text>}</View>}</View>
          <Icon name={editing ? 'chevron-down' : 'chevron-forward'} color={palette.muted} size={19}/>
        </Pressable>
        {driverProfile && <>
          <View style={styles.divider}/>
          <View style={[s.row, { gap: 17, paddingVertical: 2 }]}><Car size={112}/><View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>{driverProfile.carMake}</Text><Text style={s.body}>{driverProfile.carPlate}</Text><Text style={s.muted}>{driverProfile.carColor}</Text></View></View>
          <View style={styles.divider}/>
          <View style={[s.spread, { gap: 10 }]}><View style={[styles.onlineIcon, { backgroundColor: isDark ? '#252525' : driverProfile.online ? '#E3F8E9' : colors.pale }]}><Icon name="speedometer-outline" color={isDark ? '#FFFFFF' : driverProfile.online ? '#28B452' : palette.muted} size={28}/></View><View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>{t(driverProfile.online ? 'На линии' : 'Не на линии')}</Text><Text style={s.caption}>{driverProfile.verified ? (driverProfile.online ? local('Готов принимать заказы', 'Буюртмаларды кабыл алууга даяр') : local('Включите, чтобы принимать заказы', 'Буюртмаларды алуу үчүн күйгүзүңүз')) : t('Ожидаем подтверждение')}</Text></View><ToggleSwitch label={t('На линии')} value={driverProfile.online} onValueChange={onOnline} disabled={busy || !driverProfile.verified}/></View>
        </>}
      </View>
      {editing && <View style={[styles.profileCard, { gap: 11 }]}>
        <Text style={s.h3}>{local('Личные данные', 'Жеке маалыматтар')}</Text>
        {user.role === 'DRIVER' && <>
          <View style={[s.row, { gap: 14 }]}><Avatar user={user} size={64}/><View style={{ flex: 1, gap: 3 }}><Text style={s.h3}>{t('Фотография профиля')}</Text><Text style={s.caption}>{t('Выберите квадратную область фотографии.')}</Text></View></View>
          <Button secondary label={t(user.photoUrl ? 'Изменить фото' : 'Выбрать фото')} busy={avatarSaving} disabled={saving} onPress={() => void chooseAvatar()}/>
        </>}
        <Text style={s.caption}>{t('Имя')}</Text>
        <TextInput style={s.input} value={name} onChangeText={setName} maxLength={80} accessibilityLabel={t('Имя')}/>
        <Button label={t('Сохранить')} busy={saving} disabled={avatarSaving || !name.trim()} onPress={() => update({ name: name.trim() })}/>
      </View>}
      {user.role === 'DRIVER' && <View style={styles.profileCard}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Баланс')} onPress={() => onNavigate('balance')} style={s.row}><View style={styles.walletIcon}><Icon name="wallet-outline" color={palette.accent} size={32}/></View><View style={{ flex: 1, gap: 4 }}><Text style={s.muted}>{t('Баланс')}</Text><Text style={styles.balanceValue}>{balance ? money(balance.deposit) : '—'}</Text></View><Icon name="chevron-forward" color={palette.muted} size={19}/></Pressable>
        <View style={styles.divider}/>
        <View style={styles.earningsRow}>
          <View style={styles.earning}><Icon name="bar-chart" color={palette.accent} size={24}/><View style={{ flex: 1, gap: 4 }}><Text style={s.caption}>{t('Сегодня')}</Text><Text style={styles.earningValue}>{earnings ? money(income(earnings.today)) : '—'}</Text><Text style={s.caption}>{earnings ? local(`${completedOrders(earnings.today).length} поездок`, `${completedOrders(earnings.today).length} сапар`) : '—'}</Text></View></View>
          <View style={styles.statDivider}/>
          <View style={styles.earning}><Icon name="calendar" color={palette.accent} size={24}/><View style={{ flex: 1, gap: 4 }}><Text style={s.caption}>{t('Неделя')}</Text><Text style={styles.earningValue}>{earnings ? money(income(earnings.week)) : '—'}</Text><Text style={s.caption}>{earnings ? local(`${completedOrders(earnings.week).length} поездок`, `${completedOrders(earnings.week).length} сапар`) : '—'}</Text></View></View>
        </View>
        <Button label={t('История операций')} onPress={() => onNavigate('balance')}/>
      </View>}
      <View style={[styles.profileCard, { paddingVertical: 2 }]}><MenuRow icon="settings-outline" label={t('Настройки')} onPress={() => onNavigate('settings')}/><View style={styles.menuDivider}/><MenuRow icon="help-circle-outline" label={t('Поддержка')} onPress={() => onNavigate('support')}/><View style={styles.menuDivider}/><MenuRow icon="receipt-outline" label={user.role === 'DRIVER' ? t('История заказов') : t('Способы оплаты')} onPress={() => onNavigate(user.role === 'DRIVER' ? 'history' : 'payment')}/></View>
    </>}

    {page === 'history' && user.role === 'CLIENT' && historyDetailId ? (
      history.find(order => order.id === historyDetailId) ? <ClientTripHistoryDetail order={history.find(order => order.id === historyDetailId)!} user={user} onError={onError}/> : loading ? <ActivityIndicator style={{ paddingVertical: 20 }} color={palette.accent}/> : <Empty icon="time-outline" title={t('Поездка не найдена')}/>
    ) : page === 'history' && <>
      <View style={styles.segments}>{[['today', 'Сегодня'], ['week', 'Неделя'], ['all', 'Все']].map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: period === value }} onPress={() => { if (value !== period) { setLoading(true); setHistory([]); setExpandedOrder(null); setPeriod(value); } }} style={[styles.segment, period === value && styles.segmentActive]}><Text style={[styles.segmentText, period === value && { color: isDark ? '#050505' : '#FFFFFF' }]}>{t(label)}</Text></Pressable>)}</View>
      {user.role === 'DRIVER' && <View style={styles.historySummary}>
        <View style={[s.row, { gap: 15 }]}><View style={styles.incomeIcon}><Icon name="bar-chart" color={palette.accent} size={29}/></View><View style={{ flex: 1, gap: 3 }}><Text style={s.muted}>{t('Доход наличными')}</Text><Text style={styles.summaryValue}>{loading && history.length === 0 ? '—' : money(income(history))}</Text></View></View>
        <View style={styles.summaryStats}><Stat value={loading && !history.length ? '—' : String(completed.length)} label={local('Выполнено заказов', 'Аткарылган буюртмалар')}/><View style={styles.statDivider}/><Stat value={loading && !history.length ? '—' : km(completed.reduce((total, order) => total + Number(order.distanceMeters), 0))} label={t('Расстояние')}/><View style={styles.statDivider}/><Stat value={driverProfile?.rating == null ? '—' : Number(driverProfile.rating).toFixed(1)} label={t('Рейтинг')}/></View>
      </View>}
      {loading && history.length === 0 && <ActivityIndicator style={{ paddingVertical: 20 }} color={palette.accent}/>}
      {!loading && history.length === 0 && <Empty icon="time-outline" title={t('Поездок пока нет')}/>}
      {groups.map(group => <View key={group.date} style={{ gap: 8 }}><Text style={styles.dateHeading}>{period === 'today' ? `${t('Сегодня')}, ` : ''}{group.date}</Text>{group.orders.map(order => user.role === 'CLIENT' ? <ClientHistoryRow key={order.id} order={order} user={user} onPress={() => onHistoryDetailId(order.id)}/> : <HistoryRow key={order.id} order={order} user={user} expanded={expandedOrder === order.id} onPress={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}/>)}</View>)}
    </>}

    {page === 'balance' && <>{balance ? <>
      <View style={[styles.profileCard, { backgroundColor: isDark ? '#1D1D1D' : palette.accent, gap: 10 }]}><View style={s.row}><Icon name="wallet-outline" color="#FFFFFF"/><Text style={{ color: isDark ? '#B0B0B0' : '#D9ECFF', fontSize: 16 }}>{t('Депозит для комиссии')}</Text></View><Text style={[s.h1, { color: '#FFFFFF', fontSize: 37 }]}>{money(balance.deposit)}</Text><Text style={{ color: isDark ? '#B0B0B0' : '#D9ECFF', lineHeight: 19, fontSize: 12 }}>{t('Пополнение через администратора. Комиссия списывается после завершения поездки.')}</Text></View>
      <View style={[styles.profileCard, { gap: 20 }]}><View style={s.spread}><Text style={s.muted}>{t('Доход наличными')}</Text><Text style={s.h3}>{money(balance.cashIncome)}</Text></View><View style={s.spread}><Text style={s.muted}>{t('Комиссия сервиса')}</Text><Text style={s.h3}>{money(balance.commissionTotal)}</Text></View><Text style={s.caption}>{t('Наличные вы получаете от пассажиров. Они не зачисляются на депозит.')}</Text></View>
      <Text style={s.h3}>{t('История операций')}</Text>{balance.operations.length === 0 && <Empty icon="receipt-outline" title={t('Операций пока нет')}/>}
      {balance.operations.map(operation => <View style={[s.card, s.spread]} key={operation.id}><View style={{ flex: 1, gap: 4 }}><Text style={s.h3}>{operation.note || t(operation.kind === 'COMMISSION' ? 'Комиссия за поездку' : 'Пополнение депозита')}</Text><Text style={s.caption}>{new Date(operation.createdAt).toLocaleString(locale)}</Text><Text style={s.caption}>{t('Остаток:')} {money(operation.balanceAfter)}</Text></View><Text style={[s.h3, { color: isDark ? '#FFFFFF' : Number(operation.amount) < 0 ? palette.ink : colors.green }]}>{Number(operation.amount) > 0 ? '+' : ''}{money(operation.amount)}</Text></View>)}
    </> : <Empty icon="wallet-outline" title={loading ? t('Подключаемся…') : t('Баланс')}/>}</>}

    {page === 'settings' && <>
      {driverProfile && <View style={[s.card, isDark && styles.darkSettingsCard, { gap: 4 }]}>
        <View style={{ gap: 4, paddingBottom: 9 }}><Text style={[s.h3, isDark && styles.darkSettingsText]}>{local('Какие заказы принимать', 'Кайсы буюртмаларды кабыл алуу')}</Text><Text style={s.caption}>{local(`Назначенный класс: ${driverProfile.transportClass === 'COMFORT' ? 'Комфорт' : driverProfile.transportClass === 'TRUCK' ? 'Грузовой' : 'Эконом'}`, `Унаа классы: ${driverProfile.transportClass}`)}</Text></View>
        {driverProfile.transportClass !== 'TRUCK' && <PreferenceRow title="Эконом" caption="Обычные поездки" value={!!driverProfile.acceptsEconomy} disabled={saving} onChange={acceptsEconomy => void updatePreferences({ acceptsEconomy })}/>}
        <PreferenceRow title="Комфорт" caption={driverProfile.transportClass === 'COMFORT' ? 'Поездки Комфорт' : 'Доступ назначает администратор'} value={!!driverProfile.acceptsComfort} disabled={saving || driverProfile.transportClass !== 'COMFORT'} onChange={acceptsComfort => void updatePreferences({ acceptsComfort })}/>
        {driverProfile.transportClass !== 'TRUCK' && <PreferenceRow title="Доставка на машине" caption="Небольшие чистые грузы" value={!!driverProfile.acceptsDeliveryCar} disabled={saving} onChange={acceptsDeliveryCar => void updatePreferences({ acceptsDeliveryCar })}/>}
        {driverProfile.transportClass === 'TRUCK' && <PreferenceRow title="Грузовая доставка" caption="Крупные грузы" value={!!driverProfile.acceptsDeliveryTruck} disabled={saving} onChange={acceptsDeliveryTruck => void updatePreferences({ acceptsDeliveryTruck })}/>}
      </View>}
      <View style={[s.card, isDark && styles.darkSettingsCard, { gap: 11 }]}>
        <View style={s.spread}>
          <View style={s.row}>
            <Icon name="notifications-outline" color={isDark ? '#FFFFFF' : palette.accent}/>
            <Text style={[s.h3, isDark && styles.darkSettingsText]}>{t('Уведомления')}</Text>
          </View>
          <ToggleSwitch label={t('Уведомления')} value={user.notifications && notificationPermission !== false} onValueChange={value => update({ notifications: value })} disabled={saving}/>
        </View>
        {user.notifications && notificationPermission === false && <Pressable accessibilityRole="button" onPress={() => void openNotificationSettings()} style={s.spread}>
          <Text style={[s.caption, { flex: 1, color: colors.danger }]}>{t('Разрешение телефона выключено')}</Text>
          <Text style={{ color: isDark ? '#FFFFFF' : palette.accent, fontWeight: '600' }}>{t('Открыть настройки')}</Text>
        </Pressable>}
      </View>
      <View style={[s.card, isDark && styles.darkSettingsCard, { gap: 12 }]}>
        <Text style={[s.h3, isDark && styles.darkSettingsText]}>{local('Тема оформления', 'Көрүнүш темасы')}</Text>
        {([
          { value: 'system', ru: 'Как в системе', ky: 'Түзмөктөгүдөй' },
          { value: 'light', ru: 'Светлая', ky: 'Жарык' },
          { value: 'dark', ru: 'Тёмная', ky: 'Караңгы' },
        ] as const).map(option => {
          const selected = themePreference === option.value;
          return <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={local(option.ru, option.ky)}
            accessibilityState={{ selected }}
            onPress={() => onThemePreferenceChange(option.value)}
            style={({ pressed }) => [
              styles.themeOption,
              isDark && styles.themeOptionDark,
              selected && (isDark ? styles.themeSelectedDark : styles.themeSelectedLight),
              pressed && { opacity: .7 },
            ]}
          >
            <Text style={[s.body, isDark && styles.darkSettingsText, { flex: 1 }]}>{local(option.ru, option.ky)}</Text>
            <Icon name={selected ? 'radio-button-on' : 'radio-button-off'} color={isDark ? selected ? '#FFFFFF' : '#888888' : selected ? palette.accent : palette.muted}/>
          </Pressable>;
        })}
      </View>
      <View style={[s.card, isDark && styles.darkSettingsCard, { gap: 15 }]}>
        <Text style={[s.h3, isDark && styles.darkSettingsText]}>{t('Язык интерфейса')}</Text>
        {(['ru', 'ky'] as Language[]).map(language => <Pressable key={language} accessibilityRole="button" accessibilityState={{ selected: user.language === language }} onPress={() => update({ language })} disabled={saving} style={[s.spread, { paddingVertical: 8 }]}>
          <Text style={[s.body, isDark && styles.darkSettingsText]}>{language === 'ru' ? 'Русский' : 'Кыргызча'}</Text>
          <Icon name={user.language === language ? 'radio-button-on' : 'radio-button-off'} color={isDark ? user.language === language ? '#FFFFFF' : '#888888' : user.language === language ? palette.accent : palette.muted}/>
        </Pressable>)}
      </View>
    </>}
    {page === 'payment' && <><View style={[s.card, s.row]}><View style={s.emptyIcon}><Icon name="cash" color={isDark ? '#FFFFFF' : colors.green} size={32}/></View><View style={{ flex: 1 }}><Text style={s.h2}>{t('Наличные')}</Text><Text style={s.muted}>{t('Оплата водителю')}</Text></View><Icon name="checkmark-circle" color={palette.accent}/></View><Text style={s.muted}>{t('Все поездки оплачиваются наличными в сомах после завершения. Стоимость фиксируется перед заказом.')}</Text></>}
    {page === 'support' && <><Empty icon="headset-outline" title={t('Поддержка')} subtitle={t('Если возникла проблема с поездкой, сообщите время заказа и номер телефона аккаунта.')}/>{config?.supportPhone ? <Button label={config.supportPhone} icon="call-outline" onPress={() => void Linking.openURL(`tel:${config.supportPhone}`)}/> : <View style={s.card}><Text style={s.muted}>{t('Контакт поддержки пока не настроен. Обратитесь к диспетчеру сервиса.')}</Text></View>}<View style={[s.card, { gap: 12 }]}><Text style={s.h3}>{user.role === 'DRIVER' ? 'Atlas pro' : 'Atlas'}</Text><Text style={s.caption}>{t('Карты — OpenStreetMap, маршруты — OSRM.')}</Text><Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}><Text style={{ color: palette.accent }}>{t('© Участники OpenStreetMap ↗')}</Text></Pressable>{process.env.EXPO_PUBLIC_PRIVACY_URL && <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(process.env.EXPO_PUBLIC_PRIVACY_URL!)}><Text style={{ color: palette.accent }}>{t('Политика конфиденциальности ↗')}</Text></Pressable>}</View></>}
  </ScrollView>;
}

function PreferenceRow({ title, caption, value, disabled, onChange }: { title: string; caption: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  const s = useAccountUi();
  const { palette } = useTheme();
  return <View style={[s.spread, { minHeight: 58, gap: 12 }]}><View style={{ flex: 1, gap: 3 }}><Text style={[s.body, { color: palette.ink, fontWeight: '600' }]}>{title}</Text><Text style={s.caption}>{caption}</Text></View><ToggleSwitch label={title} value={value} disabled={disabled} onValueChange={onChange}/></View>;
}

export function MenuRow({ icon, label, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void }) {
  const s = useAccountUi();
  const { palette } = useTheme();
  return <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [s.spread, { paddingVertical: 17, opacity: pressed ? .6 : 1 }]}><View style={[s.row, { flex: 1, gap: 18 }]}><Icon name={icon} color={palette.ink} size={26}/><Text style={[s.body, { flex: 1, fontWeight: '500' }]}>{label}</Text></View><Icon name="chevron-forward" color={palette.muted} size={19}/></Pressable>;
}

const baseStyles = StyleSheet.create({
  page: { padding: 16, paddingTop: 9, paddingBottom: 26, gap: 14 },
  profileCard: { padding: 15, borderRadius: 23, backgroundColor: 'white', gap: 10, shadowColor: '#587DA0', shadowOpacity: .06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  profilePerson: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  profileName: { fontSize: 21, fontWeight: '700', letterSpacing: -.4, color: colors.ink },
  profilePhone: { fontSize: 14, color: colors.muted },
  rating: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  onlineDot: { position: 'absolute', bottom: 3, right: 3, width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: 'white' },
  divider: { height: 1, backgroundColor: colors.line },
  onlineIcon: { width: 46, height: 41, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  walletIcon: { width: 61, height: 61, borderRadius: 31, backgroundColor: '#E7F3FF', alignItems: 'center', justifyContent: 'center' },
  balanceValue: { color: colors.ink, fontSize: 28, fontWeight: '700', letterSpacing: -.5 },
  earningsRow: { flexDirection: 'row', gap: 15 },
  earning: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  earningValue: { fontSize: 19, fontWeight: '700', color: colors.ink },
  menuDivider: { height: 1, backgroundColor: colors.line, marginLeft: 44, marginVertical: -16 },
  segments: { flexDirection: 'row', backgroundColor: '#F2F7FD', borderRadius: 17, padding: 3 },
  segment: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 14 },
  segmentActive: { backgroundColor: colors.blue, shadowColor: colors.blue, shadowOpacity: .17, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  segmentText: { color: '#4D6380', fontSize: 16, fontWeight: '600' },
  historySummary: { backgroundColor: '#EEF6FF', borderRadius: 21, padding: 16, gap: 17 },
  incomeIcon: { width: 47, height: 47, borderRadius: 24, backgroundColor: '#DDEEFF', alignItems: 'center', justifyContent: 'center' },
  summaryValue: { fontSize: 28, color: '#0B1832', fontWeight: '700', letterSpacing: -.5 },
  summaryStats: { flexDirection: 'row', gap: 14 },
  stat: { flex: 1, gap: 4 },
  statValue: { fontSize: 17, fontWeight: '700', color: colors.ink },
  statLabel: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: '#DFEAF5' },
  dateHeading: { color: '#536C8A', fontSize: 16, fontWeight: '600', marginTop: 2, marginBottom: 3 },
  historyCard: { borderRadius: 16, borderColor: colors.line, borderWidth: 1, backgroundColor: 'white', overflow: 'hidden' },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 10 },
  timeColumn: { alignSelf: 'stretch', width: 40, paddingTop: 1, borderRightWidth: 1, borderRightColor: colors.line },
  historyTime: { color: colors.ink, fontSize: 12, lineHeight: 18 },
  historyRoute: { flex: 1, flexDirection: 'row', gap: 8 },
  routePins: { height: 41, alignItems: 'center', paddingTop: 1 },
  routeDash: { flex: 1, borderLeftWidth: 1, borderColor: colors.blue, borderStyle: 'dashed', marginVertical: 2 },
  historyAddress: { color: colors.ink, fontSize: 13, lineHeight: 17 },
  historyMeta: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  historyAmount: { alignItems: 'flex-end', gap: 8, maxWidth: 89 },
  statusPill: { borderRadius: 12, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 10, lineHeight: 14 },
  historyPrice: { color: '#0A1730', fontSize: 17, fontWeight: '700' },
  historyDetails: { borderTopWidth: 1, borderColor: colors.line, padding: 16, gap: 12 },
  themeOption: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: 'transparent' },
  themeOptionDark: { borderColor: '#272727' },
  themeSelectedLight: { backgroundColor: '#EDF5FF', borderColor: '#BEDDFF' },
  themeSelectedDark: { backgroundColor: '#242424', borderColor: '#FFFFFF' },
  darkSettingsCard: { backgroundColor: '#111111', borderColor: '#353535', shadowOpacity: 0 },
  darkSettingsText: { color: '#FFFFFF' },
});

const darkStyles = StyleSheet.create({
  profileCard: { ...baseStyles.profileCard,  backgroundColor: '#111111', borderWidth: 1, borderColor: '#353535', shadowOpacity: 0, elevation: 0 },
  profileName: { ...baseStyles.profileName,  color: '#FFFFFF' },
  profilePhone: { ...baseStyles.profilePhone,  color: '#B0B0B0' },
  rating: { ...baseStyles.rating,  color: '#FFFFFF' },
  onlineDot: { ...baseStyles.onlineDot,  borderColor: '#111111' },
  divider: { ...baseStyles.divider,  backgroundColor: '#353535' },
  onlineIcon: { ...baseStyles.onlineIcon,  backgroundColor: '#1D1D1D' },
  walletIcon: { ...baseStyles.walletIcon,  backgroundColor: '#1D1D1D' },
  balanceValue: { ...baseStyles.balanceValue,  color: '#FFFFFF' },
  earningValue: { ...baseStyles.earningValue,  color: '#FFFFFF' },
  menuDivider: { ...baseStyles.menuDivider,  backgroundColor: '#353535' },
  segments: { ...baseStyles.segments,  backgroundColor: '#1D1D1D' },
  segmentActive: { ...baseStyles.segmentActive,  backgroundColor: '#FFFFFF', shadowOpacity: 0, elevation: 0 },
  segmentText: { ...baseStyles.segmentText,  color: '#B0B0B0' },
  historySummary: { ...baseStyles.historySummary,  backgroundColor: '#111111', borderWidth: 1, borderColor: '#353535' },
  incomeIcon: { ...baseStyles.incomeIcon,  backgroundColor: '#1D1D1D' },
  summaryValue: { ...baseStyles.summaryValue,  color: '#FFFFFF' },
  statValue: { ...baseStyles.statValue,  color: '#FFFFFF' },
  statLabel: { ...baseStyles.statLabel,  color: '#B0B0B0' },
  statDivider: { ...baseStyles.statDivider,  backgroundColor: '#353535' },
  dateHeading: { ...baseStyles.dateHeading,  color: '#B0B0B0' },
  historyCard: { ...baseStyles.historyCard,  borderColor: '#353535', backgroundColor: '#111111' },
  timeColumn: { ...baseStyles.timeColumn,  borderRightColor: '#353535' },
  historyTime: { ...baseStyles.historyTime,  color: '#FFFFFF' },
  routeDash: { ...baseStyles.routeDash,  borderColor: '#FFFFFF' },
  historyAddress: { ...baseStyles.historyAddress,  color: '#FFFFFF' },
  historyMeta: { ...baseStyles.historyMeta,  color: '#B0B0B0' },
  statusText: { ...baseStyles.statusText,  color: '#FFFFFF' },
  historyPrice: { ...baseStyles.historyPrice,  color: '#FFFFFF' },
  historyDetails: { ...baseStyles.historyDetails,  borderColor: '#353535' },
});

function useAccountStyles() {
  const { isDark } = useTheme();
  return isDark ? { ...baseStyles, ...darkStyles } : baseStyles;
}

const darkUi = StyleSheet.create({
  h1: { ...lightUi.h1,  color: '#FFFFFF' }, h2: { ...lightUi.h2,  color: '#FFFFFF' }, h3: { ...lightUi.h3,  color: '#FFFFFF' },
  body: { ...lightUi.body,  color: '#FFFFFF' }, muted: { ...lightUi.muted,  color: '#B0B0B0' }, caption: { ...lightUi.caption,  color: '#B0B0B0' },
  card: { ...lightUi.card,  backgroundColor: '#111111', borderColor: '#353535' },
  input: { ...lightUi.input,  backgroundColor: '#1D1D1D', borderColor: '#353535', color: '#FFFFFF' },
  emptyIcon: { ...lightUi.emptyIcon, backgroundColor: '#1D1D1D' },
  divider: { ...lightUi.divider,  backgroundColor: '#353535' },
});

function useAccountUi() {
  const { isDark } = useTheme();
  return isDark ? { ...lightUi, ...darkUi } : lightUi;
}
