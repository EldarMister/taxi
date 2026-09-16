import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Keyboard, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../design/theme';
import { api, ApiError, messageOf, requestId } from '../api';
import { ServiceHomeScreen } from './HomeScreen';
import { DishScreen, RestaurantsScreen, RestaurantScreen } from './CatalogScreens';
import { CartScreen, CheckoutScreen, type CheckoutDetails } from './CheckoutScreens';
import { FoodHistoryScreen, FoodOrderScreen } from './OrderScreens';
import { addCartLine, cartLineKey, cartSummary, changeCartQuantity, MAX_FOOD_QUANTITY } from './cart';
import { readFoodState, writeFoodState, type FoodState } from './storage';
import { ScreenTransition, type ScreenDirection } from './ScreenTransition';
import type { CartLine, FoodCatalog, FoodDish, FoodOrder, FoodRestaurant, HomeBanner } from './types';

type Screen = 'home' | 'restaurants' | 'restaurant' | 'dish' | 'cart' | 'checkout' | 'order' | 'history';
export type FoodEntry = { screen: 'home' | 'restaurants' | 'history'; key: number };
const emptyCatalog: FoodCatalog = { restaurants: [], paymentMethods: [], isDemo: false };
const terminal = (order: FoodOrder) => order.status === 'COMPLETED' || order.status === 'CANCELLED';
const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
const foodError = (error: unknown) => error instanceof ApiError && error.status === 404
  ? 'Доставка временно недоступна. Попробуйте обновить раздел немного позже.' : messageOf(error);

export function FoodExperience({ userId, active, entry, defaultAddress, onTaxi, onTruck, onTaxiSearch, onMenu, contentRevision = 0, orderRevision = 0 }: {
  userId: string; active: boolean; entry: FoodEntry; defaultAddress: string; onTaxi: () => void; onTruck: () => void; onTaxiSearch: () => void; onMenu: () => void; contentRevision?: number; orderRevision?: number;
}) {
  const theme = useTheme();
  const [screen, setScreen] = useState<Screen>('home');
  const [screenDirection, setScreenDirection] = useState<ScreenDirection>('forward');
  const [catalog, setCatalog] = useState<FoodCatalog>(emptyCatalog);
  const [banners, setBanners] = useState<HomeBanner[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const [dishId, setDishId] = useState<string | null>(null);
  const [cartRestaurantId, setCartRestaurantId] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteDishes, setFavoriteDishes] = useState<string[]>([]);
  const [restoredUserId, setRestoredUserId] = useState<string | null>(null);
  const [details, setDetails] = useState<CheckoutDetails>({ fulfillment: 'DELIVERY', address: defaultAddress, comment: '', paymentMethod: 'CASH' });
  const [selectedOrder, setSelectedOrder] = useState<FoodOrder | null>(null);
  const [activeOrder, setActiveOrder] = useState<FoodOrder | null>(null);
  const [orders, setOrders] = useState<FoodOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [orderError, setOrderError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const mounted = useRef(true);
  const currentUserId = useRef(userId);
  const busy = useRef(false);
  const pending = useRef<FoodState['pending']>(undefined);
  const catalogVersion = useRef(0);
  const bannerVersion = useRef(0);
  const historyVersion = useRef(0);
  const refreshingOrder = useRef(false);
  const queuedOrderRefresh = useRef(false);
  const latestOrderRefresh = useRef<() => Promise<void>>(async () => {});
  const orderOrigin = useRef<'history' | 'home'>('home');
  const cartOrigin = useRef<'restaurants' | 'restaurant'>('restaurants');
  const wantedPromo = useRef<string | null>(null);
  const defaultAddressRef = useRef(defaultAddress);
  const persistenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistenceContext = useRef<{ userId: string; state: FoodState } | null>(null);
  const restored = restoredUserId === userId;
  currentUserId.current = userId;
  defaultAddressRef.current = defaultAddress;
  const restaurant = catalog.restaurants.find(item => item.id === selectedRestaurantId);
  const cartRestaurant = catalog.restaurants.find(item => item.id === cartRestaurantId);
  const selectedDish = restaurant?.dishes.find(item => item.id === dishId);
  const summary = cartSummary(cartRestaurant, lines);
  const dishQuantities = summary.items.reduce<Record<string, number>>((result, item) => {
    result[item.dish.id] = (result[item.dish.id] || 0) + item.quantity;
    return result;
  }, {});
  const savedState = (): FoodState => ({ restaurantId: cartRestaurantId, lines, favorites, favoriteDishes, address: details.address, checkout: { fulfillment: details.fulfillment, comment: details.comment, paymentMethod: details.paymentMethod }, pending: pending.current });
  if (restored) persistenceContext.current = { userId, state: savedState() };

  const cancelScheduledPersistence = useCallback(() => {
    if (persistenceTimer.current !== null) clearTimeout(persistenceTimer.current);
    persistenceTimer.current = null;
  }, []);
  const flushPersistence = useCallback(() => {
    cancelScheduledPersistence();
    const context = persistenceContext.current;
    if (!context) return;
    void writeFoodState(context.userId, context.state).catch(() => undefined);
  }, [cancelScheduledPersistence]);
  const navigate = (next: Screen, direction: ScreenDirection = 'forward') => {
    Keyboard.dismiss();
    setScreenDirection(direction);
    setScreen(next);
  };

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const sessionUserId = userId;
    return () => {
      cancelScheduledPersistence();
      const context = persistenceContext.current;
      if (context?.userId === sessionUserId) void writeFoodState(context.userId, context.state).catch(() => undefined);
    };
  }, [cancelScheduledPersistence, userId]);
  useEffect(() => {
    let cancelled = false;
    void readFoodState(userId).then(state => {
      if (cancelled) return;
      if (state) {
        setCartRestaurantId(state.restaurantId); setLines(state.lines); setFavorites(state.favorites); setFavoriteDishes(state.favoriteDishes);
        setDetails({ fulfillment: 'DELIVERY', address: state.address || defaultAddressRef.current, comment: state.checkout?.comment ?? '', paymentMethod: state.checkout?.paymentMethod ?? 'CASH' });
      } else {
        setCartRestaurantId(null); setLines([]); setFavorites([]); setFavoriteDishes([]);
        setDetails({ fulfillment: 'DELIVERY', address: defaultAddressRef.current, comment: '', paymentMethod: 'CASH' });
      }
      pending.current = state?.pending;
      setRestoredUserId(userId);
    }).catch(() => {
      if (!cancelled) {
        setCartRestaurantId(null); setLines([]); setFavorites([]); setFavoriteDishes([]); pending.current = undefined;
        setDetails({ fulfillment: 'DELIVERY', address: defaultAddressRef.current, comment: '', paymentMethod: 'CASH' });
        setRestoredUserId(userId);
      }
    });
    return () => { cancelled = true; };
  }, [userId]);
  useEffect(() => {
    if (!restored) return;
    cancelScheduledPersistence();
    void writeFoodState(userId, savedState()).catch(() => undefined);
  }, [userId, restored, cartRestaurantId, lines, favorites, favoriteDishes, details.fulfillment, details.paymentMethod]);
  useEffect(() => {
    if (!restored) return;
    cancelScheduledPersistence();
    const sessionUserId = userId;
    persistenceTimer.current = setTimeout(() => {
      persistenceTimer.current = null;
      const context = persistenceContext.current;
      if (context?.userId === sessionUserId) void writeFoodState(context.userId, context.state).catch(() => undefined);
    }, 450);
    return cancelScheduledPersistence;
  }, [cancelScheduledPersistence, userId, restored, details.address, details.comment]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') flushPersistence(); });
    return () => subscription.remove();
  }, [flushPersistence]);
  useEffect(() => { if (!active) flushPersistence(); }, [active, flushPersistence]);

  const loadCatalog = useCallback(async () => {
    const version = ++catalogVersion.current;
    setLoading(true); setCatalogError('');
    try {
      const data = await api.request<FoodCatalog>('/food/catalog');
      if (!mounted.current || version !== catalogVersion.current) return;
      setCatalog(data);
      if (wantedPromo.current) {
        const promo = data.restaurants.find(item => item.id === wantedPromo.current);
        wantedPromo.current = null;
        if (promo) { setSelectedRestaurantId(promo.id); navigate('restaurant'); }
      }
    } catch (error) {
      if (mounted.current && version === catalogVersion.current) setCatalogError(foodError(error));
    } finally { if (mounted.current && version === catalogVersion.current) setLoading(false); }
  }, []);
  const loadBanners = useCallback(async () => {
    const version = ++bannerVersion.current;
    try {
      const data = await api.request<{ banners: HomeBanner[] }>('/content/banners');
      if (mounted.current && version === bannerVersion.current) setBanners(data.banners.filter(banner => banner.active).sort((a, b) => a.sortOrder - b.sortOrder).slice(0, 3));
    } catch { /* Promotions are optional; an unavailable feed does not block services. */ }
  }, []);
  useEffect(() => { if (active) { void loadCatalog(); void loadBanners(); } }, [active, contentRevision, loadCatalog, loadBanners]);
  useEffect(() => { navigate(entry.screen, entry.screen === 'home' ? 'back' : 'forward'); setSubmitError(''); wantedPromo.current = null; }, [entry.key, entry.screen]);

  const loadHistory = useCallback(async () => {
    const version = ++historyVersion.current;
    setHistoryLoading(true); setHistoryError('');
    try { const data = await api.request<FoodOrder[]>('/food/orders/history'); if (mounted.current && version === historyVersion.current) setOrders(data); }
    catch (error) { if (mounted.current && version === historyVersion.current) setHistoryError(foodError(error)); }
    finally { if (mounted.current && version === historyVersion.current) setHistoryLoading(false); }
  }, []);
  useEffect(() => { if (active && screen === 'history') void loadHistory(); }, [active, screen, orderRevision, loadHistory]);

  const refreshOrder = useCallback(async () => {
    if (refreshingOrder.current) { queuedOrderRefresh.current = true; return; }
    refreshingOrder.current = true;
    try {
      const current = await api.request<FoodOrder | null>('/food/orders/active');
      if (!mounted.current) return;
      setActiveOrder(current);
      if (screen === 'order' && selectedOrder) {
        const next = current?.id === selectedOrder.id ? current : await api.request<FoodOrder>(`/food/orders/${selectedOrder.id}`);
        if (mounted.current) setSelectedOrder(previous => previous?.id !== next.id || previous.updatedAt > next.updatedAt ? previous : next);
      }
      if (mounted.current) setOrderError('');
    } catch (error) { if (mounted.current && screen === 'order') setOrderError(foodError(error)); }
    finally {
      refreshingOrder.current = false;
      if (mounted.current && queuedOrderRefresh.current) {
        queuedOrderRefresh.current = false;
        void latestOrderRefresh.current();
      }
    }
  }, [screen, selectedOrder?.id]);
  latestOrderRefresh.current = refreshOrder;
  useEffect(() => { if (active) void refreshOrder(); }, [active, orderRevision, refreshOrder]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') { void refreshOrder(); if (screen === 'history') void loadHistory(); } }, 12000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') { void refreshOrder(); void loadCatalog(); void loadBanners(); if (screen === 'history') void loadHistory(); } });
    return () => { clearInterval(timer); subscription.remove(); };
  }, [active, refreshOrder, loadCatalog, loadBanners, loadHistory, screen]);

  const back = () => {
    if (busy.current) return;
    wantedPromo.current = null;
    if (screen === 'dish') navigate('restaurant', 'back');
    else if (screen === 'restaurant') navigate('restaurants', 'back');
    else if (screen === 'cart') {
      if (cartOrigin.current === 'restaurant' && cartRestaurant) { setSelectedRestaurantId(cartRestaurant.id); navigate('restaurant', 'back'); }
      else navigate('restaurants', 'back');
    }
    else if (screen === 'checkout') navigate('cart', 'back');
    else if (screen === 'order') navigate(orderOrigin.current, 'back');
    else navigate('home', 'back');
    setSubmitError('');
  };
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (screen === 'home') return false; back(); return true; });
    return () => subscription.remove();
  }, [active, screen, cartRestaurant?.id]);

  const openRestaurant = (value: FoodRestaurant) => { wantedPromo.current = null; setSelectedRestaurantId(value.id); navigate('restaurant'); };
  const openCart = (origin: 'restaurants' | 'restaurant') => { cartOrigin.current = origin; navigate('cart'); };
  const add = (dish: FoodDish, quantity = 1, optionIds: string[] = [], showCart = false) => {
    if (!restaurant || !restored) return;
    const existing = cartRestaurantId === restaurant.id ? lines.find(line => cartLineKey(line) === cartLineKey({ dishId: dish.id, quantity, optionIds }))?.quantity || 0 : 0;
    if (existing + quantity > MAX_FOOD_QUANTITY) { Alert.alert('Количество порций', `Можно добавить не больше ${MAX_FOOD_QUANTITY} порций одного блюда с одинаковыми добавками.`); return; }
    const apply = (replace = false) => {
      setCartRestaurantId(restaurant.id);
      setLines(current => addCartLine(replace ? [] : current, dish, quantity, optionIds));
      if (showCart) openCart('restaurant');
    };
    if (lines.length && cartRestaurantId !== restaurant.id) {
      Alert.alert('Заказ из другого ресторана', 'В одном заказе могут быть блюда только из одного ресторана. Заменить содержимое корзины?', [{ text: 'Оставить', style: 'cancel' }, { text: 'Заменить', onPress: () => apply(true) }]);
    } else apply();
  };
  const decreaseDish = (dish: FoodDish) => {
    if (cartRestaurantId !== restaurant?.id) return;
    setLines(current => {
      const target = current.find(line => line.dishId === dish.id && line.optionIds.length === 0)
        ?? current.find(line => line.dishId === dish.id);
      return target ? changeCartQuantity(current, cartLineKey(target), target.quantity - 1) : current;
    });
  };
  const clearCart = () => Alert.alert('Очистить корзину?', 'Все блюда и добавки будут удалены из корзины.', [{ text: 'Оставить', style: 'cancel' }, { text: 'Очистить', style: 'destructive', onPress: () => { setLines([]); setCartRestaurantId(null); } }]);
  const removeOption = (id: string) => {
    const updated = lines.map(line => ({ ...line, optionIds: line.optionIds.filter(optionId => optionId !== id) }));
    const quantities = new Map<string, number>();
    for (const line of updated) quantities.set(cartLineKey(line), (quantities.get(cartLineKey(line)) || 0) + line.quantity);
    if ([...quantities.values()].some(quantity => quantity > MAX_FOOD_QUANTITY)) {
      Alert.alert('Количество порций', `Без этой добавки получится больше ${MAX_FOOD_QUANTITY} одинаковых порций. Сначала уменьшите количество блюда.`);
      return;
    }
    setLines(updated.reduce<CartLine[]>((result, line) => {
      const existing = result.find(item => cartLineKey(item) === cartLineKey(line));
      if (existing) existing.quantity += line.quantity;
      else result.push({ ...line });
      return result;
    }, []));
  };

  const submit = async () => {
    if (busy.current || !cartRestaurant || !restored) return;
    const submittingUserId = userId;
    const totals = cartSummary(cartRestaurant, lines, 'DELIVERY');
    if (!totals.count || totals.invalid) return;
    busy.current = true; setSubmitting(true); setSubmitError(''); cancelScheduledPersistence();
    const body = { restaurantId: cartRestaurant.id, items: lines, ...details, fulfillment: 'DELIVERY' as const, address: details.address.trim(), comment: details.comment.trim() };
    const signature = JSON.stringify(body);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: requestId() };
    try {
      // Persist the request key before dispatch: a lost response or restart must
      // not create a second restaurant order when the customer retries.
      const stateWithPending = savedState();
      persistenceContext.current = { userId: submittingUserId, state: stateWithPending };
      await writeFoodState(submittingUserId, stateWithPending);
      if (!mounted.current || currentUserId.current !== submittingUserId) return;
      const order = await api.post<FoodOrder>('/food/orders', { ...body, requestId: pending.current.requestId });
      if (!mounted.current || currentUserId.current !== submittingUserId) return;
      pending.current = undefined;
      setSelectedOrder(order); setActiveOrder(terminal(order) ? null : order); orderOrigin.current = 'home';
      setLines([]); setCartRestaurantId(null); navigate('order'); setOrderError('');
      const completedState = { ...savedState(), lines: [], restaurantId: null, pending: undefined };
      persistenceContext.current = { userId: submittingUserId, state: completedState };
      void writeFoodState(submittingUserId, completedState).catch(() => undefined);
    } catch (error) { if (mounted.current && currentUserId.current === submittingUserId) setSubmitError(foodError(error)); }
    finally { busy.current = false; if (mounted.current) setSubmitting(false); }
  };

  let content: React.ReactNode;
  let routeKey: string;
  if (screen === 'home') { routeKey = 'home'; content = <ServiceHomeScreen active={active} onTaxi={onTaxi} onTruck={onTruck} onSearch={onTaxiSearch} onFood={() => navigate('restaurants')} onMenu={onMenu} onOrders={() => {
    if (activeOrder) { setSelectedOrder(activeOrder); orderOrigin.current = 'home'; navigate('order'); } else navigate('history');
  }} hasOrder={!!activeOrder} banners={banners} onBanner={banner => {
    if (banner.actionType === 'TAXI') onTaxi();
    else if (banner.actionType === 'FOOD') navigate('restaurants');
    else if (banner.actionType === 'RESTAURANT' && banner.restaurantId) {
      const promo = catalog.restaurants.find(item => item.id === banner.restaurantId);
      if (promo) openRestaurant(promo); else { wantedPromo.current = banner.restaurantId; navigate('restaurants'); void loadCatalog(); }
    }
  }} />; }
  else if (screen === 'dish' && restaurant && selectedDish) { routeKey = `dish:${restaurant.id}:${selectedDish.id}`; content = <DishScreen key={`${restaurant.id}:${selectedDish.id}`} dish={selectedDish} restaurant={restaurant} onBack={back} onAdd={(dish, quantity, optionIds) => add(dish, quantity, optionIds, true)} favorite={favoriteDishes.includes(`${restaurant.id}:${selectedDish.id}`)} onFavorite={() => setFavoriteDishes(current => toggle(current, `${restaurant.id}:${selectedDish.id}`))} />; }
  else if (screen === 'restaurant' && restaurant) { routeKey = `restaurant:${restaurant.id}`; content = <RestaurantScreen key={restaurant.id} restaurant={restaurant} onBack={back} onDish={dish => { setDishId(dish.id); navigate('dish'); }} onAdd={dish => add(dish)} onDecrease={decreaseDish} onCart={() => openCart('restaurant')} cartCount={summary.count} cartTotal={summary.total} cartRestaurantName={cartRestaurant?.name} dishQuantities={cartRestaurantId === restaurant.id ? dishQuantities : {}} favorite={favorites.includes(restaurant.id)} onFavorite={() => setFavorites(current => toggle(current, restaurant.id))} />; }
  else if (screen === 'cart') { routeKey = 'cart'; content = <CartScreen restaurant={cartRestaurant} lines={lines} onBack={back} onClear={clearCart} onQuantity={(key, quantity) => setLines(current => changeCartQuantity(current, key, quantity))} onRemoveOption={removeOption} onCheckout={() => { setSubmitError(''); navigate('checkout'); }} />; }
  else if (screen === 'checkout' && cartRestaurant) { routeKey = 'checkout'; content = <CheckoutScreen restaurant={cartRestaurant} lines={lines} paymentMethods={catalog.paymentMethods} details={details} onDetails={setDetails} onBack={back} onSubmit={() => void submit()} busy={submitting} error={submitError} />; }
  else if (screen === 'order' && selectedOrder) { routeKey = `order:${selectedOrder.id}`; content = <FoodOrderScreen order={selectedOrder} onBack={back} error={orderError} onRetry={() => void refreshOrder()} />; }
  else if (screen === 'history') { routeKey = 'history'; content = <FoodHistoryScreen orders={orders} loading={historyLoading} error={historyError} onBack={back} onRetry={() => void loadHistory()} onOrder={order => { setSelectedOrder(order); orderOrigin.current = 'history'; navigate('order'); }} />; }
  else { routeKey = 'restaurants'; content = <RestaurantsScreen restaurants={catalog.restaurants} onBack={back} onRestaurant={openRestaurant} onCart={() => openCart('restaurants')} cartCount={summary.count} cartTotal={summary.total} cartRestaurantName={cartRestaurant?.name} loading={loading} error={catalogError} onRetry={() => void loadCatalog()} />; }
  return <View style={{ flex: 1, backgroundColor: theme.isDark ? theme.palette.background : '#F7F7F5' }}>
    {active && <StatusBar style={theme.isDark || screen === 'restaurant' || screen === 'dish' ? 'light' : 'dark'} />}
    <ScreenTransition routeKey={routeKey} direction={screenDirection}>{content}</ScreenTransition>
  </View>;
}
