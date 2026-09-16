import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "./src/design/theme";
import { useFonts } from "expo-font";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Inter_800ExtraBold } from "@expo-google-fonts/inter/800ExtraBold";
import { Inter_900Black } from "@expo-google-fonts/inter/900Black";
import NetInfo from "@react-native-community/netinfo";
import { io, Socket } from "socket.io-client";
import { api, ApiError, messageOf, requestId } from "./src/api";
import { AuthScreen } from "./src/AuthScreen";
import { DriverRegistrationScreen } from "./src/DriverRegistrationScreen";
import { AccountScreen, MenuRow, Page } from "./src/AccountScreens";
import { AddressPicker, ChatOverlay } from "./src/Overlays";
import { BookingPanel, emptyRideDetails, rideComment } from "./src/BookingPanel";
import { DeliveryPanel, emptyDeliveryDetails } from "./src/DeliveryPanel";
import { useRideQuotes } from "./src/useRideQuotes";
import { statusText } from "./src/TripPanel";
import { DriverOfferSkip, DriverPanel } from "./src/DriverPanel";
import { DriverNavigation } from "./src/DriverNavigation";
import { useDriverNavigation } from "./src/useDriverNavigation";
import { useClientDriverTracking, useApproachRoute } from "./src/useDriverTracking";
import { tripMapRoutes } from "./src/tripMapRoutes";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ClientTripPanel } from "./src/ClientTripPanel";
import { PermissionOnboarding } from "./src/PermissionOnboarding";
import { WrongAppScreen } from "./src/WrongAppScreen";
import { appVariant, isRoleAllowed } from "./src/appVariant";
import { FoodExperience, FoodEntry } from "./src/food/FoodExperience";
import {
  Avatar,
  Button,
  colors,
  Icon,
  IconButton,
  km,
  Logo,
  s,
  shortAddress,
  tr,
  tripTime,
} from "./src/ui";
import {
  AppConfig,
  ChatMessage,
  Coordinate,
  isActive,
  normalizePoint,
  Order,
  Point,
  Session,
  Tariff,
  User,
} from "./src/types";
import TaxiMap from "./src/native/TaxiMap";
import { reverseGeocode } from "./src/native/search";
import {
  getCurrentPosition,
  getLocationPermissionState,
  openLocationSettings,
  requestLocationAccess,
} from "./src/native/location";
import type { LocationPermissionState } from "./src/native/location";
import {
  getNotificationPermissionState,
  openNotificationSettings,
  registerPushNotifications,
  requestNotificationAccess,
  unregisterPushNotifications,
  onNotificationOpened,
  onNotificationReceived,
} from "./src/native/push";
import { driverSounds } from "./src/native/driverSounds";
import {
  PermissionIntroState,
  readLastOrderId,
  readPermissionIntro,
  writeLastOrderId,
  writePermissionIntro,
} from "./src/native/sessionStore";

function shouldRestoreCompletedOrder(order: Order, role: User["role"]) {
  return order.status === "COMPLETED" &&
    (role === "DRIVER" ? order.driverRating == null : order.rating == null);
}

function isDismissedOrderUpdate(next: Order | null, dismissedOrderIds: ReadonlySet<string>) {
  return next != null && dismissedOrderIds.has(next.id);
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
  });
  return (
    <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider>
      <ThemeProvider><AppContent ready={!!(fontsLoaded || fontError)}/></ThemeProvider>
    </SafeAreaProvider></GestureHandlerRootView>
  );
}
function AppContent({ ready }: { ready: boolean }) {
  const { isDark, palette } = useTheme();
  return <>
    <StatusBar style={isDark ? "light" : "dark"} backgroundColor={isDark ? "#050505" : "#FFFFFF"}/>
    {ready ? <TaxiApp/> : <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}><ActivityIndicator color={palette.accent}/></View>}
  </>;
}
function TaxiApp() {
  const insets = useSafeAreaInsets();
  const { isDark, palette, preference: themePreference, setPreference: onThemePreferenceChange, resolved: theme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [wrongAppLanguage, setWrongAppLanguage] = useState<User["language"] | null>(null);
  const [permissionStep, setPermissionStep] = useState<PermissionIntroState | "loading">("loading");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const permissionBusyRef = useRef(false);
  const [permissionError, setPermissionError] = useState("");
  const [permissionNeedsSettings, setPermissionNeedsSettings] = useState(false);
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState | null>(null);
  const locationPermissionVersion = useRef(0);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const orderRef = useRef<Order | null>(null);
  const dismissedOrderIds = useRef(new Set<string>());
  const [offers, setOffers] = useState<Order[]>([]);
  const [page, setPage] = useState<Page>("home");
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
  const [service, setService] = useState<'hub' | 'taxi' | 'delivery'>('hub');
  const [foodEntry, setFoodEntry] = useState<FoodEntry>({ screen: 'home', key: 0 });
  const [contentRevision, setContentRevision] = useState(0);
  const [foodOrderRevision, setFoodOrderRevision] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [chat, setChat] = useState(false);
  const [incoming, setIncoming] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [pickupChosenManually, setPickupChosenManually] = useState(false);
  const pickupChosenManuallyRef = useRef(false);
  const markManualPickup = (value: boolean) => { pickupChosenManuallyRef.current = value; setPickupChosenManually(value); };
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [addressField, setAddressField] = useState<"pickup" | "dropoff" | null>(
    null,
  );
  const addressOpener = useRef<((field: "pickup" | "dropoff") => void) | null>(null);
  const registerAddressOpener = useCallback((open: ((field: "pickup" | "dropoff") => void) | null) => { addressOpener.current = open; }, []);
  const openAddress = (field: "pickup" | "dropoff") => { if (addressOpener.current) addressOpener.current(field); else setAddressField(field); };
  const [mapField, setMapField] = useState<"pickup" | "dropoff" | null>(null);
  const [mapPanelHeight, setMapPanelHeight] = useState(180);
  const [navigationHeight, setNavigationHeight] = useState(180);
  const [mapFocus, setMapFocus] = useState<Coordinate | null>(null);
  const [searchCenter, setSearchCenter] = useState<Coordinate | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [tariffId, setTariffId] = useState("");
  const [deliveryTariffs, setDeliveryTariffs] = useState<Tariff[]>([]);
  const [deliveryKind, setDeliveryKind] = useState<'DELIVERY_CAR' | 'DELIVERY_TRUCK'>('DELIVERY_TRUCK');
  const [deliveryDetails, setDeliveryDetails] = useState(emptyDeliveryDetails);
  const [rideDetails, setRideDetails] = useState(emptyRideDetails);
  const [bookingHeight, setBookingHeight] = useState(166);
  const [driverCompletionHeight, setDriverCompletionHeight] = useState(520);
  const [coming, setComing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);
  const orderKey = useRef<{ quoteId: string; key: string } | null>(null);
  const syncRef = useRef(false);
  const t = tr(user?.language || "ru");
  const driver = user?.role === "DRIVER";
  const showingServices = !driver && page === 'home' && service === 'hub' && !order;
  const locationEnabled = !!locationPermission?.granted && locationPermission.servicesEnabled;
  useEffect(() => { setSearchCenter(null); }, [user?.id]);
  useEffect(() => {
    if (!addressField || !locationEnabled || searchCenter) return;
    let live = true;
    void getCurrentPosition().then(point => { if (live) setSearchCenter(point); }).catch(() => undefined);
    return () => { live = false; };
  }, [addressField, locationEnabled, !!searchCenter]);
  const navigation = useDriverNavigation({ userId: user?.id, order: driver ? order : null, enabled: driver && permissionStep === 'done', locationEnabled, mapVisible: page === 'home' && !showingServices, language: user?.language || 'ru' });
  const lastDriverPositionUpload = useRef(0);
  useEffect(() => {
    const fix=navigation.position;
    if(!driver||!user?.driverProfile?.online||!locationEnabled||!fix||AppState.currentState!=='active')return;
    if(!Number.isFinite(fix.accuracy)||fix.accuracy>100||Date.now()-fix.timestamp>15000)return;
    if(Date.now()-lastDriverPositionUpload.current<5000)return;
    lastDriverPositionUpload.current=Date.now();
    void api.patch('/driver/position',{latitude:fix.latitude,longitude:fix.longitude,accuracyM:fix.accuracy,measuredAtMs:fix.timestamp}).catch(()=>undefined);
  },[driver,user?.id,user?.driverProfile?.online,locationEnabled,navigation.position]);
  const tracking = useClientDriverTracking(order, user?.role === "CLIENT");
  const mapSelection = !driver && !order ? mapField : null;
  const browsingPickup = !driver && !order && !dropoff && !mapSelection && !pickupChosenManually;
  const { quote, quotes, calculating, quoteError, refresh: refreshQuotes, clear: clearQuotes } = useRideQuotes(pickup, dropoff, tariffs, tariffId, !!user && !driver && !order && service === 'taxi', user?.id);
  const deliveryTariffId=deliveryTariffs.find(item=>item.kind===deliveryKind)?.id||'';
  const { quote: deliveryQuote, quotes: deliveryQuotes, calculating: deliveryCalculating, quoteError: deliveryQuoteError, refresh: refreshDeliveryQuotes, clear: clearDeliveryQuotes } = useRideQuotes(pickup, dropoff, deliveryTariffs, deliveryTariffId, !!user && !driver && !order && service === 'delivery', user?.id);
  const updateUser = (next: User | null) => {
    driverSounds.setUser(next);
    userRef.current = next;
    setUser(next);
  };
  const refreshLocationPermission = useCallback(async () => {
    const version = ++locationPermissionVersion.current;
    const state = await getLocationPermissionState();
    if (version === locationPermissionVersion.current) setLocationPermission(state);
    return state;
  }, []);
  const applyOrder = useCallback((next: Order | null) => {
    if (isDismissedOrderUpdate(next, dismissedOrderIds.current)) return;
    const currentUser = userRef.current;
    if (
      next &&
      currentUser?.role === "DRIVER" &&
      next.driver?.id !== currentUser.id
    ) {
      if (orderRef.current?.id === next.id) {
        orderRef.current = null;
        setOrder(null);
        void writeLastOrderId(null);
      }
      return;
    }
    if (
      next &&
      orderRef.current?.id === next.id &&
      next.updatedAt &&
      orderRef.current.updatedAt &&
      next.updatedAt < orderRef.current.updatedAt
    )
      return;
    if (next?.id !== orderRef.current?.id) setComing(false);
    driverSounds.order(next, orderRef.current);
    orderRef.current = next;
    setOrder(next);
    if (next) {
      void writeLastOrderId(next.id);
      setOffers((current) => current.filter((item) => item.id !== next.id));
    }
  }, []);
  async function rejectMismatchedRole(profile: User) {
    if (isRoleAllowed(profile.role) || appVariant === 'driver' && profile.role === 'CLIENT') return false;
    updateUser(null);
    applyOrder(null);
    setOffers([]);
    setPermissionStep("loading");
    await Promise.allSettled([api.clear(), writeLastOrderId(null)]);
    setWrongAppLanguage(profile.language || "ru");
    return true;
  }

  async function sync() {
    if (!userRef.current || syncRef.current) return;
    syncRef.current = true;
    try {
      const [active, profile] = await Promise.all([
        api.request<Order | null>("/orders/active"),
        api.request<User>("/users/me"),
      ]);
      if (await rejectMismatchedRole(profile)) return;
      updateUser(profile);
      const currentActive = isDismissedOrderUpdate(active, dismissedOrderIds.current) ? null : active;
      if (currentActive) applyOrder(currentActive);
      else if (orderRef.current && isActive(orderRef.current)) {
        try {
          applyOrder(
            await api.request<Order>(`/orders/${orderRef.current.id}`),
          );
        } catch (e) {
          if (e instanceof ApiError && e.status === 403) {
            applyOrder(null);
            await writeLastOrderId(null);
          } else throw e;
        }
      }
      if (profile.role === "DRIVER" && profile.driverProfile?.online && !currentActive)
        setOffers(await api.request<Order[]>("/driver/offers"));
      else setOffers([]);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) setError(messageOf(e));
    } finally {
      syncRef.current = false;
    }
  }
  async function bootstrap() {
    setBooting(true);
    setBootError("");
    try {
      const stored = await api.restore();
      if (stored) {
        const profile = await api.request<User>("/users/me");
        if (await rejectMismatchedRole(profile)) return;
        setPermissionStep(await readPermissionIntro(profile.id));
        updateUser(profile);
        const active = await api.request<Order | null>("/orders/active");
        if (active) applyOrder(active);
        else {
          const id = await readLastOrderId();
          if (id) {
            try {
              const last = await api.request<Order>(`/orders/${id}`);
              if (shouldRestoreCompletedOrder(last, profile.role)) applyOrder(last);
              else await writeLastOrderId(null);
            } catch (e) {
              if (e instanceof ApiError && [403, 404].includes(e.status))
                await writeLastOrderId(null);
              else throw e;
            }
          }
        }
      }
      else setPermissionStep("loading");
    } catch (e) {
      if (api.getTokens()) setBootError(messageOf(e));
    } finally {
      setBooting(false);
    }
  }
  useEffect(() => {
    void bootstrap();
    void api
      .request<AppConfig>("/config")
      .then(setConfig)
      .catch(() => undefined);
    const timer = setInterval(() => setClock(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(
    () =>
      api.subscribe((event) => {
        if (event === "logout") {
          updateUser(null);
          applyOrder(null);
          setPickup(null);
          markManualPickup(false);
          setDropoff(null);
          setOffers([]);
          setPage("home");
          setService('hub');
          setFoodEntry(value => ({ screen: 'home', key: value.key + 1 }));
          setChat(false);
          setDrawer(false);
          setConnected(false);
        }
        if (event === "offline") setOffline(true);
        if (event === "online") setOffline(false);
        if (event === "tokens" && socketRef.current) {
          socketRef.current.auth = { token: api.getTokens()?.accessToken };
          socketRef.current.disconnect().connect();
        }
      }),
    [],
  );
  useEffect(
    () =>
      NetInfo.addEventListener((state) => {
        // A failed third-party internet probe does not mean our API is unreachable.
        if (state.isConnected === false) setOffline(true);
        else if (state.isConnected) void sync();
      }),
    [],
  );
  useEffect(() => {
    driverSounds.setForeground(AppState.currentState === "active");
    void refreshLocationPermission().catch(() => undefined);
    const subscription = AppState.addEventListener("change", (state) => {
      driverSounds.setForeground(state === "active");
      if (state === "active") {
        void sync();
        void refreshLocationPermission().catch(() => undefined);
        if (userRef.current?.notifications) void registerPushNotifications();
      }
    });
    return () => { subscription.remove(); driverSounds.setUser(null); };
  }, [refreshLocationPermission]);
  useEffect(() => {
    if (!user) return;
    let subscribed = true;
    const refreshTariffs = () => { void Promise.all([
      api.request<Tariff[]>("/tariffs"),
      api.request<Tariff[]>("/tariffs?kind=DELIVERY_CAR"),
      api.request<Tariff[]>("/tariffs?kind=DELIVERY_TRUCK"),
    ])
      .then(([result,deliveryCars,deliveryTrucks]) => {
        if (!subscribed) return;
        setTariffs(result);
        setTariffId((current) => result.some(tariff => tariff.id === current) ? current : result[0]?.id || "");
        setDeliveryTariffs([...deliveryCars,...deliveryTrucks]);
      })
      .catch((e) => { if (subscribed) setError(messageOf(e)); }); };
    const socket = io(api.socketUrl, {
      auth: { token: api.getTokens()?.accessToken },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnected(true);
      void sync();
      refreshTariffs();
      setContentRevision(value => value + 1);
      setFoodOrderRevision(value => value + 1);
      if (userRef.current?.notifications) void registerPushNotifications();
    });
    refreshTariffs();
    socket.on("content:changed", (event?: { resource?: string }) => {
      setContentRevision(value => value + 1);
      if (!event?.resource || event.resource === 'tariffs') refreshTariffs();
    });
    socket.on("tariffs:changed", refreshTariffs);
    socket.on("food:order:updated", () => setFoodOrderRevision(value => value + 1));
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("session:expired", () => {
      void api.refresh().catch((e) => setError(messageOf(e)));
    });
    socket.on("driver:location", tracking.receive);
    socket.on("order:updated", (next: Order) => {
      applyOrder(next);
      if (next.status === "COMPLETED" && userRef.current?.role === "DRIVER")
        void sync();
    });
    socket.on("order:offer", (next: Order) => {
      if (userRef.current?.driverProfile?.online && !isActive(orderRef.current))
        setOffers((current) =>
          current.some((item) => item.id === next.id)
            ? current
            : [...current, next],
        );
    });
    socket.on("order:withdrawn", ({ orderId }: { orderId: string }) => {
      driverSounds.stopOffer(orderId);
      setOffers((current) => current.filter((item) => item.id !== orderId));
    });
    socket.on("chat:message", (message: ChatMessage) => {
      driverSounds.message(message, orderRef.current);
      setIncoming(message);
    });
    socket.on("rider:coming", ({ orderId }: { orderId: string }) => {
      if (orderRef.current?.id === orderId) setComing(true);
    });
    const interval = setInterval(() => void sync(), 12000);
    return () => {
      subscribed = false;
      clearInterval(interval);
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [user?.id]);
  useEffect(() => {
    driverSounds.offers(offers, order);
  }, [offers, order, user?.id, user?.notifications, user?.driverProfile?.online, clock]);
  useEffect(() => onNotificationReceived(data => {
    if (AppState.currentState !== "active" || !userRef.current) return;
    void sync();
    // If the socket was interrupted, recover chat from the authoritative list.
    if (data.event === "chat:message" && data.orderId === orderRef.current?.id) {
      const accountId = userRef.current.id;
      void api.request<ChatMessage[]>(`/orders/${data.orderId}/messages`).then(messages => {
        if (userRef.current?.id !== accountId) return;
        for (const message of messages) driverSounds.message(message, orderRef.current);
        const latest = messages.at(-1);
        if (latest) setIncoming(latest);
      }).catch(() => undefined);
    }
  }), []);
  useEffect(() => {
    if (user?.notifications && permissionStep === "done") {
      const accountId = user.id;
      void getNotificationPermissionState()
        .then((permission) => permission.granted && userRef.current?.id === accountId
          ? registerPushNotifications()
          : null)
        .catch(() => undefined);
    } else if (user && !user.notifications) {
      void unregisterPushNotifications().catch((e) => setError(messageOf(e)));
    }
  }, [user?.id, user?.notifications, permissionStep]);
  useEffect(
    () =>
      onNotificationOpened(() => {
        setPage("home");
        void sync();
      }),
    [],
  );
  async function run(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(messageOf(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function login(session: Session, language: User["language"]) {
    if (await rejectMismatchedRole(session.user)) return;
    await api.setTokens(session);
    const profile =
      session.user.language === language
        ? session.user
        : await api.patch<User>("/users/me", { language });
    if (await rejectMismatchedRole(profile)) return;
    setPermissionStep(await readPermissionIntro(profile.id));
    setPermissionError("");
    setPermissionNeedsSettings(false);
    updateUser(profile);
    await writeLastOrderId(null);
    setBootError("");
    setPage("home");
    setService('hub');
    setFoodEntry(value => ({ screen: 'home', key: value.key + 1 }));
  }
  const logout = () =>
    run(async () => {
      try {
        await unregisterPushNotifications();
        const refreshToken = api.getTokens()?.refreshToken;
        await api.post("/auth/logout", { refreshToken });
      } finally {
        await api.clear();
        await writeLastOrderId(null);
        setPermissionStep("loading");
        setPermissionError("");
        setPermissionNeedsSettings(false);
        setPickup(null);
        markManualPickup(false);
        setDropoff(null);
        setRideDetails(emptyRideDetails);
        setDeliveryDetails(emptyDeliveryDetails);
        clearQuotes();
        clearDeliveryQuotes();
      }
    });
  const online = (value: boolean) =>
    run(async () => {
      const position=value?await getCurrentPosition():null;
      await api.patch("/driver/online", { online: value });
      if(position)await api.patch('/driver/position',{latitude:position.latitude,longitude:position.longitude,accuracyM:position.accuracy??100,measuredAtMs:Date.now()});
      updateUser(await api.request<User>("/users/me"));
      if (!value) setOffers([]);
    });
  const selectAddress = (field: "pickup" | "dropoff", point: Point) => {
    const selected = normalizePoint(point);
    setError("");
    if (field === "pickup") { setPickup(selected); markManualPickup(!selected.address.startsWith('GPS:')); setRideDetails(current => ({ ...current, entrance: "" })); }
    else setDropoff(selected);
    setAddressField(null);
    setMapField(field === "dropoff" && !pickup ? "pickup" : null);
    setMapFocus(null);
    setRecenter((value) => value + 1);
  };
  const resolvePoint = (point: Coordinate): Promise<Point> => reverseGeocode(point, user?.language ?? 'ru');
  const gpsPoint = (point: Coordinate): Point => ({
    latitude: point.latitude,
    longitude: point.longitude,
    address: `GPS: ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,
  });
  const rememberPermissionStep = async (next: PermissionIntroState) => {
    if (!userRef.current) return;
    await writePermissionIntro(userRef.current.id, next);
    setPermissionStep(next);
    setPermissionError("");
    setPermissionNeedsSettings(false);
  };
  const locateAfterPermissionGrant = (currentUser: User) => {
    void getCurrentPosition().then((point) => {
      if (userRef.current?.id !== currentUser.id) return;
      setSearchCenter(point);
      setMapFocus(point);
      setRecenter((value) => value + 1);
      if (currentUser.role === "CLIENT") {
        const fallback = gpsPoint(point);
        if (!pickupChosenManuallyRef.current) setPickup(fallback);
        void resolvePoint(point).then((resolved) => {
          if (userRef.current?.id !== currentUser.id) return;
          setPickup((selected) => selected && selected.latitude === point.latitude && selected.longitude === point.longitude ? normalizePoint(resolved) : selected);
        }).catch(() => undefined);
      }
    }).catch(() => undefined).finally(() => void refreshLocationPermission().catch(() => undefined));
  };
  useEffect(() => {
    const currentUser = userRef.current;
    if (permissionStep !== "location" || !locationPermission?.granted || !currentUser || permissionBusyRef.current) return;
    void rememberPermissionStep("notifications")
      .then(() => locateAfterPermissionGrant(currentUser))
      .catch((e) => setPermissionError(messageOf(e)));
  }, [permissionStep, locationPermission?.granted]);
  const allowPermission = async () => {
    const currentUser = userRef.current;
    if (!currentUser || permissionBusyRef.current || permissionStep === "loading" || permissionStep === "done") return;
    permissionBusyRef.current = true;
    setPermissionBusy(true);
    setPermissionError("");
    try {
      if (permissionNeedsSettings) {
        if (permissionStep === "location") await openLocationSettings();
        else await openNotificationSettings();
        setPermissionNeedsSettings(false);
        return;
      }
      if (permissionStep === "location") {
        const permission = await requestLocationAccess();
        ++locationPermissionVersion.current;
        setLocationPermission(permission);
        if (!permission.granted) {
          setPermissionNeedsSettings(!permission.canAskAgain);
          setPermissionError(permission.canAskAgain
            ? "Разрешите доступ к местоположению или выберите адрес вручную."
            : "Разрешите доступ к местоположению в настройках устройства.");
          return;
        }

        // Permission and a GPS fix are separate outcomes. Advance immediately
        // after the grant; a cold provider must not look like a rejected grant.
        await rememberPermissionStep("notifications");
        locateAfterPermissionGrant(currentUser);
        return;
      }

      const permission = await requestNotificationAccess();
      if (permission.supported === false) {
        await rememberPermissionStep("done");
        return;
      }
      if (!permission.granted) {
        setPermissionNeedsSettings(!permission.canAskAgain);
        setPermissionError(permission.canAskAgain
          ? "Разрешите уведомления, чтобы не пропустить события поездки."
          : "Разрешите уведомления в настройках устройства.");
        return;
      }
      await rememberPermissionStep("done");
      if (!currentUser.notifications) {
        void api.patch<User>("/users/me", { notifications: true }).then(next => {
          if (userRef.current?.id === currentUser.id) updateUser(next);
        }).catch(() => undefined);
      }
      void registerPushNotifications();
    } catch (e) {
      setPermissionError(messageOf(e));
    } finally {
      permissionBusyRef.current = false;
      setPermissionBusy(false);
    }
  };
  const skipPermission = async () => {
    const currentUser = userRef.current;
    if (!currentUser || permissionBusyRef.current || permissionStep === "loading" || permissionStep === "done") return;
    permissionBusyRef.current = true;
    setPermissionBusy(true);
    try {
      if (permissionStep === "location") await rememberPermissionStep("notifications");
      else {
        if (currentUser.notifications) {
          try { updateUser(await api.patch<User>("/users/me", { notifications: false })); }
          catch (e) { setError(messageOf(e)); }
        }
        await rememberPermissionStep("done");
      }
    } catch (e) {
      setPermissionError(messageOf(e));
    } finally {
      permissionBusyRef.current = false;
      setPermissionBusy(false);
    }
  };
  const locate = () =>
    run(async () => {
      try {
        const point = await getCurrentPosition();
        if ((driver || mapSelection || browsingPickup) && !addressField) setMapFocus(point);
        else {
          const fallback = gpsPoint(point);
          selectAddress("pickup", fallback);
          void resolvePoint(point).then((resolved) => {
            setPickup((selected) => selected && selected.latitude === point.latitude && selected.longitude === point.longitude ? normalizePoint(resolved) : selected);
          }).catch(() => undefined);
        }
      } finally {
        await refreshLocationPermission().catch(() => undefined);
      }
    });
  const mapSelect = (point: Coordinate) => {
    if (mapSelection) {
      const field = mapSelection;
      void run(async () => {
        selectAddress(field, await resolvePoint(point));
      });
    }
  };
  const book = () =>
    run(async () => {
      if (!quote) return;
      if (rideComment(rideDetails).length > 500) throw new Error("Сократите комментарий до 500 символов.");
      if (Date.now() >= new Date(quote.expiresAt).getTime()) {
        refreshQuotes();
        return;
      }
      if (orderKey.current?.quoteId !== quote.id)
        orderKey.current = { quoteId: quote.id, key: requestId() };
      const created = await api.post<Order>("/orders", {
        quoteId: quote.id,
        comment: rideComment(rideDetails),
        passenger: rideDetails.passenger || undefined,
        idempotencyKey: orderKey.current.key,
      });
      applyOrder(created);

      clearQuotes();
    });
  const bookDelivery = () =>
    run(async () => {
      if (!deliveryQuote) return;
      if (deliveryDetails.goodsDescription.trim().length < 3) throw new Error('Опишите груз для доставки.');
      if (Date.now() >= new Date(deliveryQuote.expiresAt).getTime()) { refreshDeliveryQuotes(); return; }
      if (orderKey.current?.quoteId !== deliveryQuote.id) orderKey.current = { quoteId: deliveryQuote.id, key: requestId() };
      const created = await api.post<Order>('/orders', {
        quoteId: deliveryQuote.id,
        comment: deliveryDetails.comment.trim(),
        delivery: {
          goodsDescription: deliveryDetails.goodsDescription.trim(),
          doorToDoor: deliveryDetails.doorToDoor,
          ...(deliveryKind === 'DELIVERY_TRUCK' ? {
            bodyType: deliveryDetails.bodyType,
            loaders: deliveryDetails.loaders,
            ...(deliveryDetails.scheduled ? { scheduledAt: new Date(Date.now() + 30 * 60_000).toISOString() } : {}),
          } : {}),
        },
        idempotencyKey: orderKey.current.key,
      });
      applyOrder(created);
      clearDeliveryQuotes();
    });
  const action = (name: string) =>
    run(async () => {
      const current = orderRef.current;
      if (!current) return;
      const result = await api.post<Order>(`/orders/${current.id}/${name}`);
      if (name === "coming") setComing(true);
      else applyOrder(result);
      if (driver && ["complete", "cancel"].includes(name)) await sync();
    });
  const done = (expectedOrderId?: string, resetTrip = false) => {
    const current = orderRef.current;
    if (!current || busyRef.current || (expectedOrderId != null && current.id !== expectedOrderId)) return;
    void run(async () => {
      dismissedOrderIds.current.add(current.id);
      try {
        await writeLastOrderId(null);
      } catch (e) {
        dismissedOrderIds.current.delete(current.id);
        throw e;
      }
      if (orderRef.current?.id === current.id) applyOrder(null);
      if (driver) setPage('home');
      else {
        setPage('home');
        setService(current.kind?.startsWith('DELIVERY_') ? 'delivery' : 'taxi');
        setMapField(null);
        setMapFocus(null);
        setAddressField(null);
        if (resetTrip) { setPickup(null); markManualPickup(false); setDropoff(null); }
        setRecenter(value => value + 1);
      }
      clearQuotes();
      clearDeliveryQuotes();
      orderKey.current = null;
      setComing(false);
      setRideDetails(emptyRideDetails);
      setDeliveryDetails(emptyDeliveryDetails);
      await sync();
    });
  };
  const rate = async (score: number, comment?: string): Promise<boolean> => {
    const current = orderRef.current;
    if (!current || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await api.post(`/orders/${current.id}/rating`, { score, comment });
      applyOrder({ ...current, rating: score });
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const rateClient = async (score: number): Promise<boolean> => {
    const current = orderRef.current;
    if (!current || busyRef.current || current.status !== 'COMPLETED' || current.driverRating != null) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await api.post(`/orders/${current.id}/client-rating`, { score });
      applyOrder({ ...current, driverRating: score });
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const accept = (offer: Order) =>
    run(async () => {
      driverSounds.stopOffer(offer.id);
      try {
        applyOrder(await api.post<Order>(`/orders/${offer.id}/accept`));
      } catch (e) {
        // A timeout is ambiguous: the server may have accepted the order even
        // though the response never reached the phone. Reconcile first. If the
        // retry also cannot reach the server, keep the offer visible so the
        // driver can slide again while it is still valid.
        await sync();
        if (orderRef.current?.id === offer.id) return;
        throw e;
      }
      await sync();
    });
  const skip = (offer: Order) =>
    run(async () => {
      driverSounds.stopOffer(offer.id);
      await api.post(`/orders/${offer.id}/skip`);
      setOffers((current) => current.filter((item) => item.id !== offer.id));
    });
  const navigate = (next: Page) => {

    setDrawer(false);
    setHistoryDetailId(null);
    setPage(next);
    setError("");
  };
  const openServices = (screen: FoodEntry['screen']) => {
    setDrawer(false);
    setPage('home');
    setService('hub');
    setFoodEntry(value => ({ screen, key: value.key + 1 }));
    setError('');
  };
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      // Expanded panels own their back action, including unsaved text edits.
      if (addressField || chat || drawer) return false;
      if (showingServices) return false;
      if (mapField) { setMapField(null); setMapFocus(null); return true; }
      if (!driver && page === 'history' && historyDetailId) { setHistoryDetailId(null); return true; }
      if (page !== "home") { setPage("home"); return true; }
      if (!driver && !order && dropoff) { setDropoff(null); return true; }
      if (!driver && !order && page === 'home') { setService('hub'); setFoodEntry(value => ({ screen: 'home', key: value.key + 1 })); return true; }
      return false;
    });
    return () => back.remove();
  }, [addressField, chat, drawer, mapField, page, driver, order, dropoff, showingServices, historyDetailId]);
  const offer = !order
    ? offers.find(
        (item) =>
          !item.searchExpiresAt ||
          new Date(item.searchExpiresAt).getTime() > clock,
      )
    : undefined;
  const displayed = order || offer;
  const approachScope = driver && offer ? `offer:${offer.id}` : !driver && order?.status === 'ASSIGNED' ? `client:${order.id}:${order.driver?.id}` : '';
  const approach = useApproachRoute(driver ? navigation.position : tracking.ageSeconds != null && tracking.ageSeconds <= 15 ? tracking.position : null, driver ? offer?.pickup : order?.pickup, approachScope);
  const mapRoutes = tripMapRoutes({ driver, order, offer, quote: service === 'delivery' ? deliveryQuote : quote, navigationRoute: navigation.route, approachRoute: approach.route });


  if (wrongAppLanguage)
    return <WrongAppScreen language={wrongAppLanguage} onContinue={() => { setWrongAppLanguage(null); setBootError(""); }} />;
  if (booting || bootError)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: palette.background,
          justifyContent: "center",
          padding: 30,
          gap: 20,
          alignItems: "center",
        }}
      >
        <Logo large />
        {booting ? (
          <ActivityIndicator size="large" color={palette.accent} />
        ) : (
          <>
            <Text style={[s.muted, { textAlign: "center", color: palette.muted }]}>{bootError}</Text>
            <Button label={t("Повторить подключение")} onPress={bootstrap} />
            <Button
              secondary
              label={t("Выйти из аккаунта")}
              onPress={() => void api.clear().then(() => setBootError(""))}
            />
          </>
        )}
      </SafeAreaView>
    );
  if (!user) return <AuthScreen onLogin={login} />;
  if (appVariant === 'driver' && user.role === 'CLIENT') return <DriverRegistrationScreen onRegistered={async profile => {
    updateUser(profile);
    setPermissionStep(await readPermissionIntro(profile.id));
    setPermissionError('');
    setPermissionNeedsSettings(false);
  }} onLogout={async () => {
    try { await api.post('/auth/logout',{refreshToken:api.getTokens()?.refreshToken}); } catch {}
    await api.clear();
    updateUser(null);
    setPermissionStep('loading');
  }}/>;
  if (permissionStep === "loading")
    return <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.background }}><ActivityIndicator size="large" color={palette.accent}/></SafeAreaView>;
  if (permissionStep !== "done")
    return <PermissionOnboarding
      step={permissionStep}
      language={user.language}
      role={user.role}
      busy={permissionBusy}
      error={permissionError}
      openSettings={permissionNeedsSettings}
      onAllow={() => void allowPermission()}
      onSkip={() => void skipPermission()}
    />;
  const pageTitles: Record<Page, string> = {
    home: driver ? "Atlas pro" : "Atlas",
    profile: "Профиль",
    history: driver ? "История заказов" : historyDetailId ? "Детали поездки" : "История поездок",
    balance: "Баланс",
    settings: "Настройки",
    support: "Поддержка",
    payment: "Способы оплаты",
  };
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View accessibilityElementsHidden={!!addressField} importantForAccessibility={addressField ? 'no-hide-descendants' : 'auto'} style={{ flex: 1 }}>
      <View key={page === "home" ? "map-header" : "account-header"} collapsable={false} pointerEvents="box-none" style={[{ paddingTop: insets.top, backgroundColor: palette.surface }, page === "home" && { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: "transparent" }, (!!mapSelection || showingServices || driver && order?.status === 'COMPLETED') && { display: "none" }]} >
        <View pointerEvents="box-none" style={[s.spread, { paddingHorizontal: 17, paddingVertical: 10 }, !driver && page === "home" && { paddingTop: 0 }]}>
          <IconButton
            name={page === "home" || driver ? "menu" : "arrow-back"}
            label={t(page === "home" || driver ? "Меню" : "Назад")}
            onPress={() =>
              page === "home" || driver ? setDrawer(true) : page === 'history' && historyDetailId ? setHistoryDetailId(null) : navigate("home")
            }
          />
          {page === "home" ? (
            driver ? <Text style={{ flex: 1, textAlign: "center", fontSize: 20, fontWeight: "700", color: palette.ink }}>{t(order ? "Поездка" : "Новые заказы")}</Text> : <View />
          ) : (
            <Text style={[s.h2, { fontSize: 21, color: palette.ink }]}>{t(pageTitles[page])}</Text>
          )}
          {driver && page === "home" ? (
<Pressable accessibilityRole="switch" accessibilityLabel={t("На линии")} accessibilityState={{ checked: !!user.driverProfile?.online, disabled: busy || !user.driverProfile?.verified }} disabled={busy || !user.driverProfile?.verified} onPress={() => online(!user.driverProfile?.online)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, height: 36 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: user.driverProfile?.online ? isDark ? palette.ink : colors.green : palette.muted }}/><Text style={{ fontSize: 12, color: palette.ink, fontWeight: "600", textShadowColor: palette.surface, textShadowRadius: 5 }}>{t(user.driverProfile?.online ? "Онлайн" : "Офлайн")}</Text></Pressable>
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
      </View>
      {!showingServices && !(driver && order?.status === 'COMPLETED') && (offline || !connected) && (
        <Pressable
          onPress={() => void sync()}
          style={{
            backgroundColor: isDark ? palette.elevated : offline ? "#FFF0E5" : "#EBF4FE",
            marginTop: !driver && page === "home" ? insets.top + 64 : 0,
            paddingVertical: 7,
            paddingHorizontal: 18,
            ...(!driver && page === "home" ? { position: "absolute" as const, top: insets.top + 64, left: 0, right: 0, marginTop: 0, zIndex: 11 } : {}),
          }}
        >
          <Text
            style={{
              color: isDark ? palette.ink : offline ? "#A56424" : "#67809C",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {t(
              offline
                ? "Нет связи. Проверьте интернет · Повторить"
                : "Восстанавливаем соединение…",
            )}
          </Text>
        </Pressable>
      )}
      {!showingServices && !!error && !(page === "home" && !driver && !order && dropoff) && (
        <Pressable
          onPress={() => setError("")}
          accessibilityRole="alert"
          style={[
            s.row,
            {
              margin: 12,
              marginTop: page === "home" && !driver ? insets.top + 66 : 12,
              padding: 12,
              backgroundColor: isDark ? palette.elevated : "#FFF0F0",
              borderRadius: 15,
              ...(!driver && page === "home" ? { position: "absolute" as const, top: insets.top + 64 + (offline || !connected ? 34 : 0), left: 0, right: 0, marginTop: 0, zIndex: 11 } : {}),
            },
          ]}
        >
          <Icon name="alert-circle-outline" color={isDark ? palette.ink : colors.danger} />
          <Text
            style={{
              flex: 1,
              color: isDark ? palette.ink : colors.danger,
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            {t(error)}
          </Text>
          <Icon name="close" size={16} color={isDark ? palette.ink : colors.danger} />
        </Pressable>
      )}
      {page === "home" ? showingServices ? <View style={{ flex: 1 }} /> : (
        <View style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              minHeight: order?.status === "COMPLETED" ? 0 : 120,
              position: "relative",
              backgroundColor: isDark ? palette.background : "#E6F0F6",
            }}
          >
            <TaxiMap
              theme={theme}
              language={user.language}
              pickup={displayed?.pickup || pickup}
              dropoff={displayed?.dropoff || dropoff}
              dropoffRouteLabel={driver && offer ? `${km(offer.distanceMeters)} · ${tripTime(offer.durationSeconds, user.language)}` : undefined}
              geometry={mapRoutes.geometry}
              approachGeometry={mapRoutes.approachGeometry}
              routeOverview={mapRoutes.routeOverview}
              driverPosition={(driver ? navigation.position : tracking.position) || undefined}
              passengerView={!driver}
              cameraSession={`${displayed?.id || 'idle'}:${displayed?.status || 'idle'}`}
              navigationActive={navigation.active}
              followDriver={driver && !offer && navigation.followDriver}
              onFollowDriverChange={navigation.setFollowDriver}
              selectionMode={mapSelection}
              browsePickup={browsingPickup}
              showUserPosition={locationEnabled && !driver}
              onUserLocation={point => setSearchCenter(previous => previous && Math.hypot(
                (point.latitude - previous.latitude) * 111320,
                (point.longitude - previous.longitude) * 111320 * Math.cos(point.latitude * Math.PI / 180),
              ) < 100 ? previous : point)}
              onPickupChange={point => {
                if (!pickup || Math.abs(pickup.latitude - point.latitude) + Math.abs(pickup.longitude - point.longitude) > .00005) setRideDetails(value => ({ ...value, entrance: '' }));
                markManualPickup(false);
                setPickup(normalizePoint(point));
              }}
              onPanelHeight={setMapPanelHeight}
              focusPoint={driver ? null : mapFocus}
              onSearchPoint={() => { if (mapSelection) { setAddressField(mapSelection); setMapField(null); } }}
              onEditPoint={!driver && !order ? setMapField : undefined}
              selecting={busy}
              contentTopInset={insets.top + (driver && order?.status === 'COMPLETED' ? 8 : navigation.active ? navigationHeight + 72 : driver && offer ? 130 : 64)}
              onSelectPoint={mapSelect}
              recenterKey={recenter}
            />
            {navigation.active && <DriverNavigation navigation={navigation} top={insets.top + 62} onHeight={setNavigationHeight} onLocation={() => void openLocationSettings().catch(() => undefined)}/>}
            {driver && offer && <View style={{ position: 'absolute', top: insets.top + 65, left: 0, right: 0, alignItems: 'center' }}><DriverOfferSkip offer={offer} busy={busy} language={user.language} onSkip={skip}/></View>}
            {!driver && !mapSelection && !order && !dropoff && (
              <Pressable accessibilityRole="button" accessibilityLabel={t("Место подачи")} onPress={() => openAddress("pickup")} style={{ position: "absolute", top: insets.top + 10, left: 76, right: 76, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center" }}>
                <Text style={{ fontSize: 11, color: palette.muted, textShadowColor: palette.surface, textShadowRadius: 5 }}>{t("Ваш адрес")} ›</Text>
                <Text style={{ fontSize: 14, lineHeight: 19, color: palette.ink, fontWeight: "700", width: "100%", textAlign: "center", textShadowColor: palette.surface, textShadowRadius: 6 }} numberOfLines={1}>{shortAddress(pickup?.address) || t("Выберите место подачи")}</Text>
              </Pressable>
            )}
            {mapSelection && <View style={{ position: "absolute", left: 17, bottom: mapPanelHeight + 48 }}><IconButton name="arrow-back" label={t("Назад")} onPress={() => { setMapField(null); setMapFocus(null); }}/></View>}
            {!driver && !order && dropoff && !mapSelection && <View style={{ position: "absolute", left: 17, bottom: 48 }}><IconButton name="arrow-back" label={t("Назад")} onPress={() => setDropoff(null)}/></View>}
          </View>
          {driver && order?.status === 'COMPLETED' && <View style={{ height: Math.max(0, driverCompletionHeight - 30) }}/>}
          {driver && <DriverPanel key={order?.id || offer?.id || 'idle'} user={user} order={order} offer={offer} busy={busy} coming={coming} approach={approach} navigation={navigation} backgroundReady={navigation.backgroundReady} onBackground={navigation.enableBackground} onAccept={accept} onRateClient={rateClient} onCompletionHeight={setDriverCompletionHeight} onOnline={() => online(true)} onAction={action} onChat={() => setChat(true)} onDone={done}/>}
          {!driver && !order && service === 'taxi' && <>
            {!mapSelection && <View style={{ height: Math.max(0, bookingHeight - 30) }}/>}
            <BookingPanel pickup={pickup} dropoff={dropoff} tariffs={tariffs} tariffId={tariffId}
              quote={quote} quotes={quotes} calculating={calculating} quoteError={quoteError} bookingError={error} busy={busy}
              language={user.language} details={rideDetails} onDetails={setRideDetails}
              onAddress={setAddressField} registerAddressOpener={registerAddressOpener} onTariff={setTariffId} hidden={!!mapSelection || !!addressField} onHeight={setBookingHeight}
              onSwap={() => { setPickup(dropoff); setDropoff(pickup); setRideDetails(current => ({ ...current, entrance: '' })); }}
              onBook={book}
              onRefresh={() => { if (tariffs.length) refreshQuotes(); else void run(async () => { const list = await api.request<Tariff[]>("/tariffs"); setTariffs(list); setTariffId(list[0]?.id || ""); }); }}
            />
          </>}
          {!driver && !order && service === 'delivery' && <>
            {!mapSelection ? <View style={{ height: Math.max(0, bookingHeight - 30) }}/> : null}
            <DeliveryPanel pickup={pickup} dropoff={dropoff} tariffs={deliveryTariffs} selectedKind={deliveryKind}
              quote={deliveryQuote} quotes={deliveryQuotes} calculating={deliveryCalculating} error={error || deliveryQuoteError} busy={busy}
              details={deliveryDetails} onDetails={setDeliveryDetails} onKind={kind => { setDeliveryKind(kind); setError(''); }}
              onAddress={setAddressField} hidden={!!mapSelection || !!addressField} onHeight={setBookingHeight}
              onBook={bookDelivery}
              onRefresh={() => { if (deliveryTariffs.length) refreshDeliveryQuotes(); else void run(async () => {
                const [cars,trucks]=await Promise.all([api.request<Tariff[]>('/tariffs?kind=DELIVERY_CAR'),api.request<Tariff[]>('/tariffs?kind=DELIVERY_TRUCK')]);
                setDeliveryTariffs([...cars,...trucks]);
              }); }}
            />
          </>}
          {!driver && order && <>
            <View style={{ height: Math.max(0, bookingHeight - 30) }}/>
            <ClientTripPanel order={order} user={user} busy={busy} onAction={action} onChat={() => setChat(true)} onDone={() => done(order.id)} onReset={() => done(order.id, true)} onRating={rate} coming={coming} onHeight={setBookingHeight} driverPosition={tracking.position} trackingWaiting={tracking.waiting} trackingStatus={tracking.statusMessage} approach={approach.route}/>
          </>}
        </View>
      ) : (
        <AccountScreen
          key={`${page}:${user.id}`}
          page={page}
          user={user}
          config={config}
          onUser={updateUser}
          onError={setError}
          onOnline={online}
          onNavigate={navigate}
          historyDetailId={historyDetailId}
          onHistoryDetailId={setHistoryDetailId}
          busy={busy}
          themePreference={themePreference}
          onThemePreferenceChange={onThemePreferenceChange}
        />
      )}
      {driver && (page !== "home" || !displayed) ? (
        <View
          style={{
            backgroundColor: palette.surface,
            paddingBottom: Math.max(insets.bottom, 10),
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: palette.line,
            flexDirection: "row",
          }}
        >
          {(
            [
              { page: "home", icon: "home-outline", title: "На линии" },
              { page: "history", icon: "reader-outline", title: "История" },
              { page: "balance", icon: "wallet-outline", title: "Баланс" },
              { page: "profile", icon: "person-outline", title: "Профиль" },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.page}
              accessibilityRole="tab"
              accessibilityState={{ selected: page === item.page }}
              onPress={() => navigate(item.page)}
              style={{ flex: 1, alignItems: "center", gap: 4 }}
            >
              <Icon
                name={item.icon}
                color={page === item.page ? palette.accent : palette.muted}
                size={23}
              />
              <Text
                style={{
                  color: page === item.page ? palette.accent : palette.muted,
                  fontSize: 11,
                  fontWeight: "600",
                }}
              >
                {t(item.title)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : page === 'home' && !showingServices ? null : (
        <View style={{ height: insets.bottom, backgroundColor: palette.surface }} />
      )}
      {!driver && <View pointerEvents={showingServices ? 'auto' : 'none'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, display: showingServices ? 'flex' : 'none' }}>
        <FoodExperience key={user.id} userId={user.id} contentRevision={contentRevision} orderRevision={foodOrderRevision} active={showingServices} entry={foodEntry} defaultAddress={pickup?.address || ''} onTaxi={() => { setService('taxi'); setError(''); }} onTruck={() => { setDeliveryKind('DELIVERY_TRUCK'); setService('delivery'); setError(''); }} onTaxiSearch={() => { setService('taxi'); setAddressField('dropoff'); setError(''); }} onMenu={() => setDrawer(true)} />
      </View>}
      </View>
      <Modal
        visible={drawer}
        transparent
        animationType="fade"
        onRequestClose={() => setDrawer(false)}
      >
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            backgroundColor: palette.backdrop,
          }}
        >
          <SafeAreaView
            style={{
              width: "76%",
              maxWidth: 370,
              backgroundColor: palette.surface,
              borderTopRightRadius: 28,
              borderBottomRightRadius: 28,
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1 }}>
              <Logo />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Профиль")}
                onPress={() => navigate("profile")}
                style={[s.row, { paddingVertical: 29 }]}
              >
                {driver && <Avatar user={user} size={62} />}
                <View style={{ flex: 1 }}>
                  <Text style={[s.h3, { color: palette.ink }]}>{user.name || t("Профиль")}</Text>
                  <Text style={[s.caption, { color: palette.muted }]}>{user.phone}</Text>
                </View>
                <Icon name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
              <View style={[s.divider, { backgroundColor: palette.line }]} />
              {!driver && <>
                <MenuRow icon="home-outline" label={t("Главная")} onPress={() => openServices('home')} />
                <MenuRow icon="car-outline" label={t("Заказать такси")} onPress={() => { setDrawer(false); setPage('home'); setService('taxi'); }} />
                <MenuRow icon="cube-outline" label={t("Доставка и грузовой")} onPress={() => { setDrawer(false); setPage('home'); setService('delivery'); }} />
                <MenuRow icon="restaurant-outline" label={t("Доставка еды")} onPress={() => openServices('restaurants')} />
                <MenuRow icon="bag-handle-outline" label={t("Мои заказы еды")} onPress={() => openServices('history')} />
                <View style={[s.divider, { backgroundColor: palette.line }]} />
              </>}
              <MenuRow
                icon="time-outline"
                label={t(driver ? "История заказов" : "История поездок")}
                onPress={() => navigate("history")}
              />
              {driver && <MenuRow
                  icon="wallet-outline"
                  label={t("Баланс")}
                  onPress={() => navigate("balance")}
                />}
              <MenuRow
                icon="settings-outline"
                label={t("Настройки")}
                onPress={() => navigate("settings")}
              />
              <View style={[s.divider, { backgroundColor: palette.line }]} />
              <MenuRow
                icon="log-out-outline"
                label={t("Выйти")}
                onPress={logout}
              />
            </ScrollView>
          </SafeAreaView>
          <Pressable
            accessibilityLabel={t("Закрыть")}
            style={{ flex: 1 }}
            onPress={() => setDrawer(false)}
          />
        </View>
      </Modal>
      {addressField && (
        <AddressPicker
          field={addressField}
          center={searchCenter || pickup}
          pickup={pickup}
          dropoff={dropoff}
          onFieldChange={setAddressField}
          language={user.language}
          onSelect={(point) => selectAddress(addressField, point)}
          onClose={() => setAddressField(null)}
          onMap={() => {
            setMapField(addressField);
            setAddressField(null);
          }}
          onLocation={locate}
        />
      )}
      {chat && order && (
        <ChatOverlay
          orderId={order.id}
          user={user}
          incoming={incoming}
          onClose={() => setChat(false)}
          onError={setError}
        />
      )}
    </View>
  );
}
