import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, BackHandler, Keyboard, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '../design/theme';
import { api, ApiError, messageOf, requestId } from '../api';
import { ServiceHomeScreen } from './HomeScreen';
import { DishScreen, RestaurantsScreen, RestaurantScreen } from './CatalogScreens';
import { FavoritesScreen, type FavoriteDish } from './FavoritesScreen';
import { CartScreen, CheckoutScreen, type CheckoutDetails } from './CheckoutScreens';
import { formatCheckoutComment } from './checkoutDetails';
import { FoodAddressPicker } from './FoodAddressPicker';
import { DeliveryInfoSheet } from './DeliveryInfoSheet';
import { FoodHistoryScreen, FoodOrderScreen } from './OrderScreens';
import { addCartLine, cartLineKey, cartSummary, changeCartQuantity, decreaseCatalogDish, increaseCatalogDish, MAX_FOOD_QUANTITY } from './cart';
import { dishOptionsValid, requiresDishConfiguration } from './dishOptions';
import { readFoodState, writeFoodState, type FoodState, type FoodCart } from './storage';
import { ScreenTransition, type ScreenDirection } from './ScreenTransition';
import type { CartLine, FoodCatalog, FoodDish, FoodOrder, FoodRestaurant, HomeBanner } from './types';
import type { Language, Point } from '../types';
import type { SavedPlaceKind, SavedPlaces } from '../savedPlaces';
import { FoodLanguageProvider } from './i18n';
import { tr } from '../ui';
import { shortAddress } from '../address';

type Screen = 'home' | 'restaurants' | 'favorites' | 'restaurant' | 'dish' | 'cart' | 'checkout' | 'order' | 'history';
export type FoodEntry = { screen: 'home' | 'restaurants' | 'history'; key: number };
const emptyCatalog: FoodCatalog = { restaurants: [], paymentMethods: [], isDemo: false };
const emptyLines: CartLine[] = [];
const terminal = (order: FoodOrder) => order.status === 'COMPLETED' || order.status === 'CANCELLED';
const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
const foodError = (error: unknown) => error instanceof ApiError && error.status === 404
  ? 'Доставка временно недоступна. Попробуйте обновить раздел немного позже.' : messageOf(error);

export function FoodExperience({ userId, userPhone, language = 'ru', active, entry, defaultAddress, defaultPoint, savedPlaces, onSavedPlace, onEditSavedPlace, onTaxi, onDelivery, onTruck, onTaxiSearch, onChangeAddress, onMenu, contentRevision = 0, orderRevision = 0 }: {
  userId: string; userPhone?: string; language?: Language; active: boolean; entry: FoodEntry; defaultAddress: string; savedPlaces: SavedPlaces; onSavedPlace: (kind: SavedPlaceKind) => void; onEditSavedPlace: (kind: SavedPlaceKind) => void; onTaxi: () => void; onDelivery: () => void; onTruck: () => void; onTaxiSearch: () => void; onChangeAddress: () => void; onMenu: () => void; contentRevision?: number; orderRevision?: number;
  defaultPoint?: Point | null;
}) {
  const theme = useTheme();
  const t = tr(language);
  const [screen, setScreen] = useState<Screen>('home');
  const [screenDirection, setScreenDirection] = useState<ScreenDirection>('forward');
  const [catalog, setCatalog] = useState<FoodCatalog>(emptyCatalog);
  const [banners, setBanners] = useState<HomeBanner[]>([]);
  const [loading, setLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);
  const [dishId, setDishId] = useState<string | null>(null);
  const [cartRestaurantId, setCartRestaurantId] = useState<string | null>(null);
  const [carts, setCarts] = useState<FoodCart[]>([]);
  const lines = carts.find(cart => cart.restaurantId === cartRestaurantId)?.lines ?? emptyLines;
  const cartRef = useRef({ restaurantId: cartRestaurantId, carts });
  cartRef.current = { restaurantId: cartRestaurantId, carts };
  const [favorites, setFavorites] = useState<string[]>([]);
  const [favoriteDishes, setFavoriteDishes] = useState<string[]>([]);
  const [restoredUserId, setRestoredUserId] = useState<string | null>(null);
  const [resumeCheckout, setResumeCheckout] = useState(false);
  const [details, setDetails] = useState<CheckoutDetails>({ fulfillment: 'DELIVERY', address: defaultAddress, comment: '', paymentMethod: 'CASH' });
  const [selectedOrder, setSelectedOrder] = useState<FoodOrder | null>(null);
  const [activeOrder, setActiveOrder] = useState<FoodOrder | null>(null);
  const [activeOrders, setActiveOrders] = useState<FoodOrder[]>([]);
  const [orders, setOrders] = useState<FoodOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [orderError, setOrderError] = useState('');
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deliveryInfoOpen, setDeliveryInfoOpen] = useState(false);
  const [addressOpen, setAddressOpen] = useState(false);
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
  const restaurantOrigin = useRef<'home' | 'restaurants' | 'favorites'>('restaurants');
  const dishOrigin = useRef<'restaurant' | 'favorites' | 'cart'>('restaurant');
  const wantedPromo = useRef<string | null>(null);
  const defaultAddressRef = useRef(defaultAddress);
  const previousSelectedAddress = useRef(defaultAddress);
  const persistenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistenceContext = useRef<{ userId: string; state: FoodState } | null>(null);
  const restored = restoredUserId === userId;
  currentUserId.current = userId;
  defaultAddressRef.current = defaultAddress;
  useEffect(() => {
    if (!restored) return;
    const previous = previousSelectedAddress.current;
    previousSelectedAddress.current = defaultAddress;
    if (!defaultAddress || defaultAddress === previous) return;
    setDetails(current => !current.addressPoint && (!current.address || current.address === previous)
      ? { ...current, address: defaultAddress } : current);
  }, [defaultAddress, restored]);
  const restaurant = catalog.restaurants.find(item => item.id === selectedRestaurantId);
  const cartRestaurant = catalog.restaurants.find(item => item.id === cartRestaurantId);
  const deliveryInfoRestaurant = screen === 'restaurant' ? restaurant : cartRestaurant;
  const selectedDish = restaurant?.dishes.find(item => item.id === dishId);
  const favoriteRestaurants = catalog.restaurants.filter(item => favorites.includes(item.id));
  const favoriteDishItems: FavoriteDish[] = catalog.restaurants.flatMap(item => item.dishes.filter(dish => favoriteDishes.includes(`${item.id}:${dish.id}`)).map(dish => ({ restaurant: item, dish })));
  const summary = cartSummary(cartRestaurant, lines);
  const checkoutCarts = carts.filter(cart => cart.lines.length).map(cart => ({ ...cart, restaurant: catalog.restaurants.find(item => item.id === cart.restaurantId) }));
  const allSummary = checkoutCarts.reduce((total, cart) => {
    const current = cartSummary(cart.restaurant, cart.lines);
    return { count: total.count + current.count, total: total.total + current.total, invalid: total.invalid || current.invalid || !cart.restaurant || cart.restaurant.isOpen === false || current.subtotal < cart.restaurant.minimumOrder };
  }, { count: 0, total: 0, invalid: false });
  const selectedCart = carts.find(cart => cart.restaurantId === cartRestaurantId);
  const cartDetails = { ...details, restaurantComment: selectedCart?.restaurantComment, cutleryCount: selectedCart?.cutleryCount };
  const setCartDetails = (next: CheckoutDetails) => {
    const { restaurantComment, cutleryCount, ...shared } = next;
    // Coordinates belong to the selected map address. An address edit that
    // carries the previous point must not dispatch a courier to the old place.
    const addressPoint = next.address !== details.address && next.addressPoint === details.addressPoint ? undefined : next.addressPoint;
    setDetails({ ...shared, addressPoint });
    const current = cartRef.current.carts.find(cart => cart.restaurantId === cartRestaurantId);
    if (current && (current.restaurantComment !== restaurantComment || current.cutleryCount !== cutleryCount)) {
      const nextCarts = cartRef.current.carts.map(cart => cart.restaurantId === cartRestaurantId ? { ...cart, restaurantComment, cutleryCount } : cart);
      cartRef.current = { ...cartRef.current, carts: nextCarts }; setCarts(nextCarts);
    }
  };
  const restaurantCart = carts.find(cart => cart.restaurantId === restaurant?.id);
  const restaurantLines = restaurantCart?.lines ?? emptyLines;
  const dishQuantities = cartSummary(restaurant, restaurantLines).items.reduce<Record<string, number>>((result, item) => {
    result[item.dish.id] = (result[item.dish.id] || 0) + item.quantity;
    return result;
  }, {});
  const savedState = (): FoodState => {
    const { address, ...checkout } = details;
    return { restaurantId: cartRestaurantId, lines, carts, favorites, favoriteDishes, address, checkout: { ...checkout, fulfillment: 'DELIVERY' }, pending: pending.current, ...(screen === 'checkout' || resumeCheckout ? { resumeCheckout: true } : {}) };
  };
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
    setDeliveryInfoOpen(false);
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
        const restoredCarts = state.carts ?? (state.restaurantId && state.lines.length ? [{ restaurantId: state.restaurantId, lines: state.lines, restaurantComment: state.checkout?.restaurantComment, cutleryCount: state.checkout?.cutleryCount }] : []);
        setCarts(restoredCarts); setCartRestaurantId(restoredCarts.find(cart => cart.restaurantId === state.restaurantId)?.restaurantId ?? restoredCarts[0]?.restaurantId ?? null); setFavorites(state.favorites); setFavoriteDishes(state.favoriteDishes);
        setResumeCheckout(!!state.resumeCheckout);
        setDetails({ ...state.checkout, fulfillment: 'DELIVERY', address: state.address || defaultAddressRef.current, comment: state.checkout?.comment ?? '', paymentMethod: state.checkout?.paymentMethod ?? 'CASH' });
      } else {
        setCartRestaurantId(null); setCarts([]); setFavorites([]); setFavoriteDishes([]);
        setResumeCheckout(false);
        setDetails({ fulfillment: 'DELIVERY', address: defaultAddressRef.current, comment: '', paymentMethod: 'CASH' });
      }
      pending.current = state?.pending;
      setRestoredUserId(userId);
    }).catch(() => {
      if (!cancelled) {
        setCartRestaurantId(null); setCarts([]); setFavorites([]); setFavoriteDishes([]); pending.current = undefined;
        setResumeCheckout(false);
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
  }, [userId, restored, cartRestaurantId, carts, favorites, favoriteDishes, details.fulfillment, details.paymentMethod, screen, resumeCheckout]);
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
  }, [cancelScheduledPersistence, userId, restored, details]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state !== 'active') flushPersistence(); });
    return () => subscription.remove();
  }, [flushPersistence]);
  useEffect(() => { if (!active) flushPersistence(); }, [active, flushPersistence]);
  useEffect(() => {
    if (!restored || !resumeCheckout || !cartRestaurant || !lines.length || !['home', 'restaurants'].includes(screen)) return;
    setResumeCheckout(false);
    if (!cartSummary(cartRestaurant, lines).invalid) navigate('checkout');
  }, [restored, resumeCheckout, cartRestaurant, lines, screen]);

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
      if (mounted.current && version === catalogVersion.current) setCatalogError(t(foodError(error)));
    } finally { if (mounted.current && version === catalogVersion.current) setLoading(false); }
  }, [language]);
  const loadBanners = useCallback(async () => {
    const version = ++bannerVersion.current;
    try {
      const data = await api.request<{ banners: HomeBanner[] }>('/content/banners');
      if (mounted.current && version === bannerVersion.current) setBanners(data.banners.filter(banner => banner.active).sort((a, b) => a.sortOrder - b.sortOrder));
    } catch { /* Promotions are optional; an unavailable feed does not block services. */ }
  }, []);
  useEffect(() => { if (active) { void loadCatalog(); void loadBanners(); } }, [active, contentRevision, loadCatalog, loadBanners]);
  useEffect(() => { navigate(entry.screen, entry.screen === 'home' ? 'back' : 'forward'); setSubmitError(''); wantedPromo.current = null; }, [entry.key, entry.screen]);

  const loadHistory = useCallback(async () => {
    const version = ++historyVersion.current;
    setHistoryLoading(true); setHistoryError('');
    try { const data = await api.request<FoodOrder[]>('/food/orders/history'); if (mounted.current && version === historyVersion.current) setOrders(data); }
    catch (error) { if (mounted.current && version === historyVersion.current) setHistoryError(t(foodError(error))); }
    finally { if (mounted.current && version === historyVersion.current) setHistoryLoading(false); }
  }, [language]);
  useEffect(() => { if (active && screen === 'history') void loadHistory(); }, [active, screen, orderRevision, loadHistory]);

  const refreshOrder = useCallback(async () => {
    if (refreshingOrder.current) { queuedOrderRefresh.current = true; return; }
    refreshingOrder.current = true;
    try {
      const current = await api.request<FoodOrder | null>('/food/orders/active');
      if (!mounted.current) return;
      setActiveOrder(current);
      try {
        const group = await api.request<FoodOrder[]>('/food/orders/active-all');
        if (mounted.current) setActiveOrders(group);
      } catch { if (mounted.current) setActiveOrders(current ? [current] : []); }
      if (screen === 'order' && selectedOrder) {
        const next = current?.id === selectedOrder.id ? current : await api.request<FoodOrder>(`/food/orders/${selectedOrder.id}`);
        if (mounted.current) setSelectedOrder(previous => previous?.id !== next.id || previous.updatedAt > next.updatedAt ? previous : next);
      }
      if (mounted.current) setOrderError('');
    } catch (error) { if (mounted.current && screen === 'order') setOrderError(t(foodError(error))); }
    finally {
      refreshingOrder.current = false;
      if (mounted.current && queuedOrderRefresh.current) {
        queuedOrderRefresh.current = false;
        void latestOrderRefresh.current();
      }
    }
  }, [screen, selectedOrder?.id, language]);
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
    if (screen === 'dish') navigate(dishOrigin.current, 'back');
    else if (screen === 'restaurant') navigate(restaurantOrigin.current, 'back');
    else if (screen === 'favorites') navigate('restaurants', 'back');
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
    // DishSheet owns Back so its exit can finish before the route is removed.
    if (!active || screen === 'dish' || addressOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (screen === 'home') return false; back(); return true; });
    return () => subscription.remove();
  }, [active, screen, cartRestaurant?.id, addressOpen]);

  const openRestaurant = (value: FoodRestaurant, origin: 'home' | 'restaurants' = 'restaurants') => { wantedPromo.current = null; restaurantOrigin.current = origin; setSelectedRestaurantId(value.id); navigate('restaurant'); };
  const openCart = (origin: 'restaurants' | 'restaurant') => { cartOrigin.current = origin; if (origin === 'restaurant' && carts.some(cart => cart.restaurantId === restaurant?.id)) setCartRestaurantId(restaurant!.id); navigate('cart'); };
  const openDish = (dish: FoodDish, origin = screen === 'favorites' ? 'favorites' as const : screen === 'cart' ? 'cart' as const : 'restaurant' as const) => {
    if (screen !== 'dish') dishOrigin.current = origin;
    setDishId(dish.id); navigate('dish');
  };
  const add = (dish: FoodDish, quantity = 1, optionIds: string[] = [], afterAdd?: (added?: boolean) => void, source = restaurant) => {
    if (!source || source.isOpen === false || !restored || !dish.available || !Number.isInteger(quantity) || quantity < 1 || !dishOptionsValid(dish, source.options, optionIds)) { afterAdd?.(false); return; }
    const live = cartRef.current;
    const currentLines = live.carts.find(cart => cart.restaurantId === source.id)?.lines ?? emptyLines;
    const existing = currentLines.filter(line => line.dishId === dish.id).reduce((sum, line) => sum + line.quantity, 0);
    if (existing + quantity > MAX_FOOD_QUANTITY) { Alert.alert(t('Количество порций'), `${t('Можно добавить не больше')} ${MAX_FOOD_QUANTITY} ${t('порций одного блюда.')}`); afterAdd?.(false); return; }
    if (!live.carts.some(cart => cart.restaurantId === source.id) && live.carts.length >= 10) { afterAdd?.(false); return; }
    updateCartLines(current => addCartLine(current, dish, quantity, optionIds), source.id);
    setCartRestaurantId(source.id);
    afterAdd?.(true);
  };
  const quickAdd = (dish: FoodDish, source = restaurant) => {
    if (!source || source.isOpen === false || !restored || !dish.available) return;
    const live = cartRef.current;
    const currentLines = live.carts.find(cart => cart.restaurantId === source.id)?.lines ?? emptyLines;
    const existing = [...currentLines].reverse().find(line => line.dishId === dish.id);
    if ((!existing && requiresDishConfiguration(dish)) || (existing && !dishOptionsValid(dish, source.options, existing.optionIds))) {
      setSelectedRestaurantId(source.id); openDish(dish); return;
    }
    if (!live.carts.some(cart => cart.restaurantId === source.id) && live.carts.length >= 10) return;
    updateCartLines(current => increaseCatalogDish(current, dish), source.id);
    setCartRestaurantId(source.id);
  };
  const decreaseDish = (dish: FoodDish) => {
    if (!restaurant) return;
    updateCartLines(current => decreaseCatalogDish(current, dish), restaurant.id);
  };
  const updateCartLines = (update: (current: CartLine[]) => CartLine[], restaurantId = cartRef.current.restaurantId) => {
    if (!restaurantId) return;
    const existing = cartRef.current.carts.find(cart => cart.restaurantId === restaurantId);
    const nextLines = update(existing?.lines ?? emptyLines);
    const next = cartRef.current.carts.filter(cart => cart.restaurantId !== restaurantId);
    if (nextLines.length) {
      const updated = { ...existing, restaurantId, lines: nextLines };
      const index = cartRef.current.carts.findIndex(cart => cart.restaurantId === restaurantId);
      next.splice(index < 0 ? next.length : index, 0, updated);
    }
    const selected = next.some(cart => cart.restaurantId === cartRef.current.restaurantId) ? cartRef.current.restaurantId : next[0]?.restaurantId ?? cartRef.current.restaurantId;
    cartRef.current = { restaurantId: selected, carts: next };
    setCartRestaurantId(selected); setCarts(next);
  };
  const clearCart = () => Alert.alert(t('Очистить корзину?'), t('Все блюда и добавки будут удалены из корзины.'), [{ text: t('Оставить'), style: 'cancel' }, { text: t('Очистить'), style: 'destructive', onPress: () => { updateCartLines(() => []); if (!cartRef.current.carts.length) { cartRef.current.restaurantId = null; setCartRestaurantId(null); } } }]);
  const removeOption = (id: string) => {
    const updated = lines.map(line => ({ ...line, optionIds: line.optionIds.filter(optionId => optionId !== id) }));
    const quantities = new Map<string, number>();
    for (const line of updated) quantities.set(cartLineKey(line), (quantities.get(cartLineKey(line)) || 0) + line.quantity);
    if ([...quantities.values()].some(quantity => quantity > MAX_FOOD_QUANTITY)) {
      Alert.alert(t('Количество порций'), `${t('Без этой добавки получится больше')} ${MAX_FOOD_QUANTITY} ${t('одинаковых порций. Сначала уменьшите количество блюда.')}`);
      return;
    }
    const next = updated.reduce<CartLine[]>((result, line) => {
      const existing = result.find(item => cartLineKey(item) === cartLineKey(line));
      if (existing) existing.quantity += line.quantity;
      else result.push({ ...line });
      return result;
    }, []);
    updateCartLines(() => next);
  };

  const submit = async () => {
    if (busy.current || !cartRestaurant || !restored) return;
    const submittingUserId = userId;
    const deliveryAddress = shortAddress(details.address);
    const point = details.addressPoint;
    const deliveryPoint = point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
      && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180
      ? { latitude: point.latitude, longitude: point.longitude, address: deliveryAddress } : undefined;
    const orderedCarts = [...checkoutCarts].sort((a, b) => a.restaurantId.localeCompare(b.restaurantId));
    if (!orderedCarts.length || orderedCarts.length > 10 || allSummary.invalid || !allSummary.count || deliveryAddress.length < 5 || orderedCarts.some(cart => formatCheckoutComment({ ...details, restaurantComment: cart.restaurantComment, cutleryCount: cart.cutleryCount }).length > 500) ||
      !catalog.paymentMethods.some(method => method.id === details.paymentMethod && method.available)) return;
    busy.current = true; setSubmitting(true); setSubmitError(''); cancelScheduledPersistence();
    // Keep the pre-redesign field order: persisted retry signatures use JSON text.
    const bodies = orderedCarts.map(cart => ({ restaurantId: cart.restaurantId, items: cart.lines, fulfillment: 'DELIVERY' as const, address: deliveryAddress, comment: formatCheckoutComment({ ...details, restaurantComment: cart.restaurantComment, cutleryCount: cart.cutleryCount }), paymentMethod: details.paymentMethod, ...(deliveryPoint ? { deliveryPoint } : {}) }));
    const signature = JSON.stringify(bodies.length === 1 ? bodies[0] : bodies);
    if (pending.current?.signature !== signature) pending.current = { signature, requestId: requestId() };
    try {
      // Persist the request key before dispatch: a lost response or restart must
      // not create a second restaurant order when the customer retries.
      const stateWithPending = savedState();
      persistenceContext.current = { userId: submittingUserId, state: stateWithPending };
      await writeFoodState(submittingUserId, stateWithPending);
      if (!mounted.current || currentUserId.current !== submittingUserId) return;
      const submittedOrders = bodies.length === 1
        ? [await api.post<FoodOrder>('/food/orders', { ...bodies[0], requestId: pending.current.requestId })]
        : (await api.post<{ orders: FoodOrder[] }>('/food/orders/batch', { orders: bodies.map((body, index) => ({ ...body, requestId: `${pending.current!.requestId}:${index}` })) })).orders;
      if (!mounted.current || currentUserId.current !== submittingUserId) return;
      const order = submittedOrders[0];
      if (!order || submittedOrders.length !== bodies.length) throw new Error(t('Не удалось подтвердить все заказы. Попробуйте ещё раз.'));
      pending.current = undefined;
      setSelectedOrder(order); setActiveOrders(submittedOrders.filter(item => !terminal(item))); setActiveOrder(submittedOrders.find(item => !terminal(item)) ?? null); orderOrigin.current = 'home';
      setCarts([]); cartRef.current = { restaurantId: null, carts: [] }; setCartRestaurantId(null); navigate('order'); setOrderError('');
      const completedState = { ...savedState(), lines: [], carts: [], restaurantId: null, pending: undefined, resumeCheckout: false };
      persistenceContext.current = { userId: submittingUserId, state: completedState };
      void writeFoodState(submittingUserId, completedState).catch(() => undefined);
    } catch (error) { if (mounted.current && currentUserId.current === submittingUserId) setSubmitError(t(foodError(error))); }
    finally { busy.current = false; if (mounted.current) setSubmitting(false); }
  };

  const openBanner = (banner: HomeBanner) => {
    if (banner.actionType === 'TAXI') onTaxi();
    else if (banner.actionType === 'FOOD') navigate('restaurants');
    else if (banner.actionType === 'RESTAURANT' && banner.restaurantId) {
      const promo = catalog.restaurants.find(item => item.id === banner.restaurantId);
      if (promo) openRestaurant(promo); else { wantedPromo.current = banner.restaurantId; navigate('restaurants'); void loadCatalog(); }
    }
  };

  let content: React.ReactNode;
  let routeKey: string;
  if (screen === 'home') { routeKey = 'home'; content = <ServiceHomeScreen userId={userId} language={language} active={active} currentAddress={defaultAddress} onChangeAddress={onChangeAddress} onTaxi={onTaxi} onDelivery={onDelivery} onTruck={onTruck} onSearch={onTaxiSearch} savedPlaces={savedPlaces} onSavedPlace={onSavedPlace} onEditSavedPlace={onEditSavedPlace} onFood={() => navigate('restaurants')} onMenu={onMenu} onOrders={() => {
    if (activeOrder) { setSelectedOrder(activeOrder); orderOrigin.current = 'home'; navigate('order'); } else navigate('history');
  }} hasOrder={!!activeOrder} restaurants={catalog.restaurants} onRestaurant={value => openRestaurant(value, 'home')} loading={loading} error={catalogError} onRetry={() => void loadCatalog()} />; }
  else if (screen === 'dish' && restaurant && selectedDish) { routeKey = `dish:${restaurant.id}:${selectedDish.id}`; content = <DishScreen key={`${restaurant.id}:${selectedDish.id}`} dish={selectedDish} restaurant={restaurant} onBack={back} onAdd={(dish, quantity, optionIds, afterAdd) => add(dish, quantity, optionIds, afterAdd ?? (added => { if (added) back(); }))} onDish={openDish} onQuickAdd={quickAdd} onDecrease={decreaseDish} dishQuantities={dishQuantities} favorite={favoriteDishes.includes(`${restaurant.id}:${selectedDish.id}`)} onFavorite={() => setFavoriteDishes(current => toggle(current, `${restaurant.id}:${selectedDish.id}`))} />; }
  else if (screen === 'restaurant' && restaurant) { routeKey = `restaurant:${restaurant.id}`; content = <RestaurantScreen currentAddress={details.address} onChangeAddress={() => setAddressOpen(true)} key={restaurant.id} restaurant={restaurant} onBack={back} onDish={openDish} onAdd={quickAdd} onDecrease={decreaseDish} onCart={() => openCart('restaurant')} onDeliveryInfo={() => setDeliveryInfoOpen(true)} cartRestaurantCount={checkoutCarts.length} cartCount={allSummary.count} cartTotal={allSummary.total} cartRestaurantName={cartRestaurant?.name} cartLines={restaurantCart ? restaurantLines : lines} cartRestaurant={restaurantCart ? restaurant : cartRestaurant} dishQuantities={dishQuantities} favorite={favorites.includes(restaurant.id)} onFavorite={() => setFavorites(current => toggle(current, restaurant.id))} />; }
  else if (screen === 'favorites') { routeKey = 'favorites'; content = <FavoritesScreen restaurants={favoriteRestaurants} dishes={favoriteDishItems} onBack={back} onRestaurant={value => { restaurantOrigin.current = 'favorites'; setSelectedRestaurantId(value.id); navigate('restaurant'); }} onDish={(value, dish) => { dishOrigin.current = 'favorites'; setSelectedRestaurantId(value.id); setDishId(dish.id); navigate('dish'); }} />; }
  else if (screen === 'cart') { routeKey = 'cart'; content = <CartScreen carts={checkoutCarts} onSelectRestaurant={setCartRestaurantId} checkoutInvalid={allSummary.invalid} onDeliveryInfo={() => setDeliveryInfoOpen(true)} restaurant={cartRestaurant} lines={lines} onRestaurant={() => { if (cartRestaurant) openRestaurant(cartRestaurant); }} onDish={dish => { if (cartRestaurant) { setSelectedRestaurantId(cartRestaurant.id); openDish(dish, 'cart'); } }} details={cartDetails} onDetails={setCartDetails} onBack={back} onClear={clearCart} onQuantity={(key, quantity) => updateCartLines(current => changeCartQuantity(current, key, quantity))} onQuantityDelta={(key, delta) => updateCartLines(current => { const line = current.find(item => cartLineKey(item) === key); return line ? changeCartQuantity(current, key, line.quantity + delta) : current; })} onRemoveOption={removeOption} onAddRecommendation={dish => { setSelectedRestaurantId(cartRestaurant?.id ?? null); quickAdd(dish, cartRestaurant); }} onCheckout={() => {
    if (!restored || !cartRestaurant || !allSummary.count || allSummary.invalid) return;
    setSubmitError(''); navigate('checkout');
  }} />; }
  else if (screen === 'checkout' && cartRestaurant) { routeKey = 'checkout'; content = <CheckoutScreen carts={checkoutCarts} recipientPhone={userPhone} onChangeAddress={() => setAddressOpen(true)} restaurant={cartRestaurant} lines={lines} paymentMethods={catalog.paymentMethods} details={cartDetails} onDetails={setCartDetails} onBack={back} onSubmit={() => void submit()} busy={submitting} error={submitError} />; }
  else if (screen === 'order' && selectedOrder) { routeKey = `order:${selectedOrder.id}`; content = <FoodOrderScreen relatedOrders={activeOrders.some(item => item.id === selectedOrder.id) ? activeOrders : []} onSelectOrder={setSelectedOrder} order={selectedOrder} onBack={back} error={orderError} onRetry={() => void refreshOrder()} />; }
  else if (screen === 'history') { routeKey = 'history'; content = <FoodHistoryScreen orders={orders} loading={historyLoading} error={historyError} onBack={back} onRetry={() => void loadHistory()} onOrder={order => { setSelectedOrder(order); orderOrigin.current = 'history'; navigate('order'); }} />; }
  else { routeKey = 'restaurants'; content = <RestaurantsScreen currentAddress={details.address} onChangeAddress={() => setAddressOpen(true)} restaurants={catalog.restaurants} onBack={back} onRestaurant={openRestaurant} onFavorites={() => navigate('favorites')} favoriteCount={favoriteRestaurants.length + favoriteDishItems.length} onCart={() => openCart('restaurants')} onDeliveryInfo={() => setDeliveryInfoOpen(true)} cartRestaurantCount={checkoutCarts.length} cartCount={allSummary.count} cartTotal={allSummary.total} cartRestaurantName={cartRestaurant?.name} cartLines={lines} cartRestaurant={cartRestaurant} banners={banners} onBanner={openBanner} favoriteIds={favorites} onToggleFavorite={value => setFavorites(current => toggle(current, value.id))} loading={loading} error={catalogError} onRetry={() => void loadCatalog()} />; }
  return <FoodLanguageProvider language={language}><View style={{ flex: 1, backgroundColor: theme.isDark ? theme.palette.background : '#F7F7F5' }}>
    {active && <StatusBar style={theme.isDark ? 'light' : 'dark'} />}
    <ScreenTransition routeKey={routeKey} direction={screenDirection}>{content}</ScreenTransition>
    {deliveryInfoOpen && <DeliveryInfoSheet restaurant={deliveryInfoRestaurant} lines={carts.find(cart => cart.restaurantId === deliveryInfoRestaurant?.id)?.lines ?? emptyLines} deliveryAddress={details.address} onClose={() => setDeliveryInfoOpen(false)} />}
    {active && addressOpen && <FoodAddressPicker details={cartDetails} defaultPoint={defaultPoint} language={language} onSave={next => { setCartDetails(next); setAddressOpen(false); }} onClose={() => setAddressOpen(false)} />}
  </View></FoodLanguageProvider>;
}
