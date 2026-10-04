import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, Text, Vibration, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { restaurantApi, RestaurantApiError } from './api';
import { Catalog, Membership, MerchantOrder, Profile, RestaurantDetail, can } from './types';
import { Button, Card, Empty, Field, Sheet, c, s } from './ui';
import { OrdersScreen } from './OrdersScreen';
import { MenuScreen } from './MenuScreen';
import { StatsScreen } from './StatsScreen';
import { SettingsScreen } from './SettingsScreen';

type Tab = 'orders' | 'menu' | 'stats' | 'settings';
const tabs: { id: Tab; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; permission?: 'orders.read' | 'menu.manage' | 'stats.read' }[] = [
  { id: 'orders', label: 'Заказы', icon: 'receipt-outline', permission: 'orders.read' },
  { id: 'menu', label: 'Меню', icon: 'restaurant-outline', permission: 'menu.manage' },
  { id: 'stats', label: 'Статистика', icon: 'bar-chart-outline', permission: 'stats.read' },
  { id: 'settings', label: 'Настройки', icon: 'settings-outline' },
];

export function RestaurantApp({ ready }: { ready: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RestaurantDetail | null>(null);
  const catalogVersions = useRef(new WeakMap<Catalog, string>()).current;
  const receiveDetail = useCallback((next: RestaurantDetail) => { catalogVersions.set(next.catalog, next.updatedAt); setDetail(next); }, [catalogVersions]);
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [tab, setTab] = useState<Tab>('orders');
  const [choosing, setChoosing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const knownOrders = useRef(new Set<string>());
  const [newOrders, setNewOrders] = useState(0);
  const activeRestaurant = useRef<string | null>(restaurantId);
  activeRestaurant.current = restaurantId;
  const membership = profile?.memberships.find(item => item.restaurantId === restaurantId);
  const allowedTabs = tabs.filter(item => !item.permission || can(membership, item.permission));
  const activeTab = allowedTabs.some(item => item.id === tab) ? tab : allowedTabs[0]?.id || 'settings';
  const scroll = useRef<ScrollView>(null);

  const receiveProfile = useCallback((next: Profile | null) => {
    setProfile(next);
    setRestaurantId(previous => next?.memberships.some(item => item.restaurantId === previous) ? previous : next?.memberships[0]?.restaurantId || null);
  }, []);
  const bootstrap = useCallback(async () => {
    setBooting(true); setBootError('');
    try { receiveProfile(await restaurantApi.restore()); }
    catch (error) { if (!(error instanceof RestaurantApiError && error.status === 401)) setBootError((error as Error).message); }
    finally { setBooting(false); }
  }, [receiveProfile]);
  useEffect(() => { void bootstrap(); return restaurantApi.subscribe(() => { receiveProfile(null); setDetail(null); setOrders([]); }); }, [bootstrap, receiveProfile]);

  const reloadOrders = useCallback(async () => {
    const id = restaurantId;
    if (!id || !can(membership, 'orders.read')) return;
    const result = await restaurantApi.request<{ orders: MerchantOrder[] }>(`/${id}/orders`);
    if (activeRestaurant.current === id) {
      const added = result.orders.filter(order => order.status === 'PLACED' && !knownOrders.current.has(order.id));
      if (added.length) { setNewOrders(added.length); Vibration.vibrate([0, 120, 90, 120]); }
      knownOrders.current = new Set(result.orders.map(order => order.id));
      setOrders(result.orders);
    }
  }, [restaurantId, membership]);
  const load = useCallback(async () => {
    const id = restaurantId;
    if (!id) return;
    setLoading(true); setError('');
    try {
      const [next, me] = await Promise.all([restaurantApi.request<RestaurantDetail>(`/${id}`), restaurantApi.request<Profile>('/me')]);
      if (activeRestaurant.current !== id) return;
      receiveDetail(next); receiveProfile(me);
      const access = me.memberships.find(item => item.restaurantId === id);
      if (can(access, 'orders.read')) {
        const result = await restaurantApi.request<{ orders: MerchantOrder[] }>(`/${id}/orders`);
        if (activeRestaurant.current === id) { knownOrders.current = new Set(result.orders.map(order => order.id)); setOrders(result.orders); }
      }
    } catch (error) { if (activeRestaurant.current === id) setError((error as Error).message); }
    finally { if (activeRestaurant.current === id) setLoading(false); }
  }, [restaurantId, receiveProfile, receiveDetail]);
  useEffect(() => { setDetail(null); setOrders([]); setNewOrders(0); knownOrders.current = new Set(); if (restaurantId) void load(); }, [restaurantId, load]);
  useEffect(() => {
    if (!restaurantId) return;
    const foreground = AppState.addEventListener('change', state => { if (state === 'active') void load(); });
    const timer = setInterval(() => { if (AppState.currentState === 'active') void reloadOrders().catch(error => setError((error as Error).message)); }, 10000);
    return () => { foreground.remove(); clearInterval(timer); };
  }, [restaurantId, load, reloadOrders]);
  async function save(catalog: Catalog, baseCatalog: Catalog) {
    if (!restaurantId || !detail) return;
    const updatedAt = catalogVersions.get(baseCatalog);
    if (!updatedAt) throw new Error('Обновите ресторан перед сохранением изменений.');
    const saved = await restaurantApi.request<RestaurantDetail>(`/${restaurantId}/catalog`, 'PUT', { catalog, updatedAt });
    if (activeRestaurant.current !== restaurantId) return;
    if (saved?.catalog) receiveDetail(saved);
    else receiveDetail(await restaurantApi.request<RestaurantDetail>(`/${restaurantId}`));
  }
  async function logout() {
    setLoading(true);
    try { await restaurantApi.logout(); } catch { /* Local session is cleared even if the connection was lost. */ }
    finally { setLoading(false); }
  }

  if (!ready || booting) return <SafeAreaView style={[s.screen, { alignItems: 'center', justifyContent: 'center', gap: 18 }]}><StatusBar style="dark"/><Text style={[s.title, { letterSpacing: 4 }]}>ATLAS</Text><Text style={[s.label, { color: c.blue }]}>Restaurant</Text><ActivityIndicator color={c.blue}/></SafeAreaView>;
  if (bootError) return <SafeAreaView style={s.screen}><StatusBar style="dark"/><View style={s.form}><Empty title="Не удалось открыть приложение" body={bootError} icon="cloud-offline-outline"/><Button title="Повторить" onPress={bootstrap}/><Button title="Войти заново" secondary onPress={() => { setBootError(''); void logout(); }}/></View></SafeAreaView>;
  if (!profile) return <Login onLogin={receiveProfile}/>;
  if (!membership || !restaurantId) return <SafeAreaView style={s.screen}><StatusBar style="dark"/><View style={s.form}><Empty title="Ресторан ещё не назначен" body="Обратитесь к администратору Atlas или владельцу ресторана, чтобы получить доступ."/><Button title="Обновить доступ" onPress={() => { void restaurantApi.request<Profile>('/me').then(receiveProfile).catch(error => setError(error.message)); }}/>{error ? <Text style={s.error}>{error}</Text> : null}<Button title="Выйти" secondary onPress={logout}/></View></SafeAreaView>;
  return <SafeAreaView style={s.screen}><StatusBar style="dark"/>
    <View style={{ paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.line }}><View style={s.row}>
      <View style={[s.iconButton, { width: 48, height: 48, backgroundColor: c.blue }]}><Ionicons name="restaurant" color="white" size={25}/></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Выбрать ресторан" disabled={profile.memberships.length < 2} onPress={() => setChoosing(true)} style={s.flex}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text numberOfLines={1} style={[s.heading, { flexShrink: 1, fontSize: 20 }]}>{detail?.catalog.name || membership.restaurantName}</Text>{profile.memberships.length > 1 ? <Ionicons name="chevron-down" size={18} color={c.ink}/> : null}</View><Text style={s.caption}>{membership.role === 'OWNER' ? 'Владелец' : 'Менеджер'} · Atlas Restaurant</Text></Pressable>
      <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: detail?.catalog.isOpen === false ? c.muted : c.green }}/>
    </View></View>
    <ScrollView ref={scroll} style={{ backgroundColor: c.canvas }} contentContainerStyle={[s.form, { paddingTop: 18, paddingBottom: 30 }]} refreshControl={<RefreshControl refreshing={loading && !!detail} onRefresh={load} tintColor={c.blue} colors={[c.blue]}/>} keyboardShouldPersistTaps="handled">
      {newOrders ? <Pressable onPress={() => { setTab('orders'); setNewOrders(0); }} style={[s.card, { backgroundColor: c.soft }]}><Text style={[s.body, { color: c.blue }]}>Новых заказов: {newOrders} · Открыть</Text></Pressable> : null}
      {error ? <Pressable onPress={load}><Text style={s.error}>{error}{'\n'}Нажмите, чтобы обновить</Text></Pressable> : null}
      {!detail ? loading ? <View style={s.empty}><ActivityIndicator color={c.blue}/><Text style={s.caption}>Загружаем ресторан…</Text></View> : <Button title="Загрузить ресторан" onPress={load}/> : <React.Fragment key={restaurantId}>
        {!detail.active ? <Text style={s.error}>Ресторан пока не опубликован. Обратитесь к администратору Atlas.</Text> : null}
        {detail.catalog.isOpen === false ? <View style={[s.card, { backgroundColor: '#F0F2F5' }]}><Text style={s.body}>Приём новых заказов приостановлен</Text></View> : null}
        {activeTab === 'orders' ? <OrdersScreen restaurantId={restaurantId} orders={orders} canManage={can(membership, 'orders.manage')} reload={reloadOrders}/> : null}
        {activeTab === 'menu' ? <MenuScreen catalog={detail.catalog} save={save}/> : null}
        {activeTab === 'stats' ? <StatsScreen restaurantId={restaurantId}/> : null}
        {activeTab === 'settings' ? <SettingsScreen catalog={detail.catalog} membership={membership} profile={profile} save={save} logout={logout}/> : null}
      </React.Fragment>}
    </ScrollView>
    <View style={{ flexDirection: 'row', paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, borderTopWidth: 1, borderTopColor: c.line, backgroundColor: 'white' }}>{allowedTabs.map(item => <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected: activeTab === item.id }} onPress={() => { setTab(item.id); scroll.current?.scrollTo({ y: 0, animated: false }); }} style={{ flex: 1, alignItems: 'center', gap: 5, paddingVertical: 5 }}><Ionicons name={item.icon} size={24} color={activeTab === item.id ? c.blue : c.muted}/><Text style={{ color: activeTab === item.id ? c.blue : c.muted, fontSize: 10, fontFamily: 'Inter_600SemiBold' }}>{item.label}</Text></Pressable>)}</View>
    <Sheet title="Мои рестораны" visible={choosing} onClose={() => setChoosing(false)}>{profile.memberships.map(item => <Pressable key={item.restaurantId} onPress={() => { setChoosing(false); setRestaurantId(item.restaurantId); setTab('orders'); scroll.current?.scrollTo({ y: 0, animated: false }); }}><Card><View style={s.row}><Ionicons name="storefront-outline" size={24} color={c.blue}/><View style={s.flex}><Text style={s.body}>{item.restaurantName}</Text><Text style={s.caption}>{item.role === 'OWNER' ? 'Владелец' : 'Менеджер'}</Text></View>{item.restaurantId === restaurantId ? <Ionicons name="checkmark-circle" color={c.blue} size={24}/> : null}</View></Card></Pressable>)}</Sheet>
  </SafeAreaView>;
}

function Login({ onLogin }: { onLogin: (profile: Profile) => void }) {
  const [phone, setPhone] = useState('+996');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  async function submit() {
    setBusy(true); setError('');
    try { onLogin(await restaurantApi.login(phone.trim(), password)); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <SafeAreaView style={s.screen}><StatusBar style="dark"/><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.form, { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 26, gap: 22 }]}>
    <View style={{ marginBottom: 24, gap: 10 }}><View style={[s.emptyIcon, { width: 78, height: 78, backgroundColor: c.blue, marginBottom: 16 }]}><Ionicons name="restaurant" size={36} color="white"/></View><Text style={[s.title, { fontSize: 39, letterSpacing: 4 }]}>ATLAS</Text><Text style={[s.heading, { color: c.blue }]}>Restaurant</Text><Text style={[s.caption, { fontSize: 15, lineHeight: 22, marginTop: 9 }]}>Заказы, меню и команда вашего ресторана</Text></View>
    <Text style={s.heading}>Войти в ресторан</Text>
    <Field label="Номер телефона" value={phone} onChange={setPhone} placeholder="+996 XXX XXX XXX"/>
    <View><Field label="Пароль" value={password} onChange={setPassword} secure={!visible}/><Pressable accessibilityLabel={visible ? 'Скрыть пароль' : 'Показать пароль'} onPress={() => setVisible(!visible)} style={{ position: 'absolute', right: 14, bottom: 14 }}><Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} color={c.muted} size={23}/></Pressable></View>
    {error ? <Text style={s.error}>{error}</Text> : null}<Button title="Войти" busy={busy} disabled={!password || phone.replace(/\D/g, '').length < 9} onPress={submit}/>
    <Text style={[s.caption, { textAlign: 'center', lineHeight: 20 }]}>Владельца регистрирует администратор Atlas.{`\n`}Доступ менеджеру выдаёт владелец ресторана.{`\n`}Если забыли пароль, обратитесь к тому, кто выдал доступ.</Text>
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
