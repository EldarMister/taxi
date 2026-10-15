import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { ClientNameScreen } from "./src/ClientNameScreen";
import { isCurrentProfileResponse, needsClientName, needsDriverRegistration } from "./src/accountIdentity";
import { readSelectedLanguage, withSelectedLanguage, writeSelectedLanguage } from "./src/auth/languageStore";
import { DriverRegistrationScreen } from "./src/DriverRegistrationScreen";
import { registrationAttentionFromResponse, type RegistrationAttention } from "./src/registration/attention";
import { AccountScreen, MenuRow, Page } from "./src/AccountScreens";
import { AddressPicker, ChatOverlay } from "./src/Overlays";
import { BookingPanel, emptyRideDetails, rideComment } from "./src/BookingPanel";
import { DeliveryPanel, emptyDeliveryDetails } from "./src/DeliveryPanel";
import { useRideQuotes } from "./src/useRideQuotes";
import { useMapEstimate, usePickupEta, usePickupAvailability } from "./src/useMapEstimate";
import { useTaxiBrowseMotion } from "./src/useTaxiBrowseMotion";
import { statusText } from "./src/TripPanel";
import { DriverOfferSkip, DriverPanel } from "./src/DriverPanel";
import { DriverNavigation } from "./src/DriverNavigation";
import { DriverTrackingDiagnostics, trackingDiagnosticsEnabled } from "./src/DriverTrackingDiagnostics";
import { useDriverNavigation } from "./src/useDriverNavigation";
import { useDriverOfferExpiry } from "./src/useDriverOfferExpiry";
import { useClientDriverTracking, useApproachRoute } from "./src/useDriverTracking";
import { tripMapRoutes } from "./src/tripMapRoutes";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ClientTripPanel } from "./src/ClientTripPanel";
import { PermissionOnboarding } from "./src/PermissionOnboarding";
import { MapPanelLayout } from "./src/MapPanelLayout";
import { nextPermissionStep, type PermissionStep } from "./src/permissionFlow";
import { getOnboardingPermissionState, openOnboardingPermissionSettings, requestOnboardingPermission } from "./src/native/onboardingPermissions";
import { WrongAppScreen } from "./src/WrongAppScreen";
import { appVariant, isRoleAllowed } from "./src/appVariant";
import { FoodExperience, FoodEntry } from "./src/food/FoodExperience";
import { readSavedPlaces, writeSavedPlaces, type SavedPlaceKind, type SavedPlaces } from "./src/savedPlaces";
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
import TaxiMap, { type MapSelectionPreview } from "./src/native/TaxiMap";
import { reverseGeocode } from "./src/native/search";
import {
  getCurrentPosition,
  getLocationPermissionState,
  openLocationSettings,
} from "./src/native/location";
import type { LocationPermissionState } from "./src/native/location";
import {
  getNotificationPermissionState,
  registerPushNotifications,
  unregisterPushNotifications,
  onNotificationOpened,
  onNotificationReceived,
} from "./src/native/push";
import { driverSounds } from "./src/native/driverSounds";
import { parseDriverOfferAction, performDriverOfferAction, type DriverOfferAction } from "./src/driverOfferNotification";
import { endSession } from "./src/auth/endSession";
import { setDriverAvailability } from "./src/native/driverAvailability";
import { requestDriverBackgroundAccess } from "./src/native/driverTracking";
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

function shouldShowDriverTabs(order: Order | null, offer?: Order, page = 'home') {
  if (['history', 'profile', 'settings', 'balance'].includes(page)) return true;
  return !offer && !isActive(order) && (order?.status !== 'COMPLETED' || order.driverRating != null);
}

const permissionRole = appVariant === 'driver' ? 'DRIVER' : 'CLIENT';

const savedPlaceTitles: Record<SavedPlaceKind, string> = {
  home: 'Адрес дома',
  work: 'Адрес работы',
  favorite: 'Избранный адрес',
};

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
    Inter_900Black,
    FoodDisplayBold: require('./assets/fonts/Oswald-Bold.ttf'),
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
  const profileRevisionRef = useRef(0);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [pendingDriverNotification, setPendingDriverNotification] = useState<DriverOfferAction | null>(null);
  const [wrongAppLanguage, setWrongAppLanguage] = useState<User["language"] | null>(null);
  const [permissionStep, setPermissionStep] = useState<PermissionIntroState | "loading">("loading");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const permissionBusyRef = useRef(false);
  const permissionRefreshPending = useRef(false);
  const [permissionRefreshVersion, setPermissionRefreshVersion] = useState(0);
  const [permissionError, setPermissionError] = useState("");
  const [permissionNeedsSettings, setPermissionNeedsSettings] = useState(false);
  const [locationPermission, setLocationPermission] = useState<LocationPermissionState | null>(null);
  const locationPermissionVersion = useRef(0);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const orderRef = useRef<Order | null>(null);
  const dismissedOrderIds = useRef(new Set<string>());
  const [offers, setOffers] = useState<Order[]>([]);
  const presentedOffers = useRef<{ userId?: string; ids: Set<string> }>({ ids: new Set() });
  const [page, setPage] = useState<Page>("home");
  const [registrationDeepLink, setRegistrationDeepLink] = useState<{ event: string; slotKey?: string } | null>(null);
  const [historyDetailId, setHistoryDetailId] = useState<string | null>(null);
  const [service, setService] = useState<'hub' | 'taxi' | 'delivery'>('hub');
  const [foodEntry, setFoodEntry] = useState<FoodEntry>({ screen: 'home', key: 0 });
  const [contentRevision, setContentRevision] = useState(0);
  const [foodOrderRevision, setFoodOrderRevision] = useState(0);
  const [registrationRevision, setRegistrationRevision] = useState(0);
  const [registrationAttention, setRegistrationAttention] = useState<RegistrationAttention | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [chat, setChat] = useState(false);
  const [incoming, setIncoming] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const logoutRef = useRef(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [pickupChosenManually, setPickupChosenManually] = useState(false);
  const pickupChosenManuallyRef = useRef(false);
  const markManualPickup = (value: boolean) => { pickupChosenManuallyRef.current = value; setPickupChosenManually(value); };
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlaces>({});
  const [savedPlaceEditing, setSavedPlaceEditing] = useState<SavedPlaceKind | null>(null);
  const [currentAddressEditing, setCurrentAddressEditing] = useState(false);
  const savedPlaceMapTransition = useRef(false);
  const savedPlacePickupRequest = useRef(0);
  const automaticPickupPending = useRef(false);
  const [locatingSavedPlacePickup, setLocatingSavedPlacePickup] = useState(false);
  const [addressField, setAddressField] = useState<"pickup" | "dropoff" | null>(
    null,
  );
  const addressOpener = useRef<((field: "pickup" | "dropoff") => void) | null>(null);
  const registerAddressOpener = useCallback((open: ((field: "pickup" | "dropoff") => void) | null) => { addressOpener.current = open; }, []);
  const openAddress = (field: "pickup" | "dropoff") => { if (addressOpener.current) addressOpener.current(field); else setAddressField(field); };
  const [mapField, setMapField] = useState<"pickup" | "dropoff" | null>(null);
  const [mapPanelHeight, setMapPanelHeight] = useState(180);
  const [mapMoving, setMapMoving] = useState(false);
  const [mapPreview, setMapPreview] = useState<MapSelectionPreview | null>(null);
  const [navigationHeight, setNavigationHeight] = useState(180);
  const [mapFocus, setMapFocus] = useState<Coordinate | null>(null);
  const [searchCenter, setSearchCenter] = useState<Coordinate | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [tariffId, setTariffId] = useState("");
  const [deliveryTariffs, setDeliveryTariffs] = useState<Tariff[]>([]);
  const [deliveryKind, setDeliveryKind] = useState<'DELIVERY_CAR' | 'DELIVERY_TRUCK'>('DELIVERY_CAR');
  const [deliveryDetails, setDeliveryDetails] = useState(emptyDeliveryDetails);
  const [rideDetails, setRideDetails] = useState(emptyRideDetails);
  const [bookingHeight, setBookingHeight] = useState(166);
  const [driverCompletionHeight, setDriverCompletionHeight] = useState(520);
  const [coming, setComing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const availabilityPrompted = useRef(false);
  const socketRef = useRef<Socket | null>(null);
  const orderKey = useRef<{ quoteId: string; key: string } | null>(null);
  const syncRef = useRef(false);
  const syncAgain = useRef(false);
  const offersSyncing = useRef(false);
  const offersAgain = useRef(false);
  const offersRevision = useRef(0);
  const t = tr(user?.language || "ru");
  const driver = user?.role === "DRIVER";
  const showingServices = !driver && page === 'home' && service === 'hub' && !order;
  const locationEnabled = !!locationPermission?.granted && locationPermission.servicesEnabled;
  useEffect(() => {
    savedPlacePickupRequest.current++;
    setLocatingSavedPlacePickup(false);
    setSavedPlaces({});
    setSavedPlaceEditing(null);
    if (!user?.id || driver) return;
    let live = true;
    void readSavedPlaces(user.id).then(places => { if (live) setSavedPlaces(places); }).catch(() => undefined);
    return () => { live = false; };
  }, [user?.id, driver]);
  useEffect(() => { setSearchCenter(null); }, [user?.id]);
  useEffect(() => {
    if (!addressField || !locationEnabled) return;
    let live = true;
    void getCurrentPosition().then(point => { if (live) setSearchCenter(point); }).catch(() => undefined);
    return () => { live = false; };
  }, [!!addressField, locationEnabled, user?.id]);
  const navigation = useDriverNavigation({ userId: user?.id, order: driver ? order : null, enabled: appVariant === 'driver' && driver && permissionStep === 'done', locationEnabled, mapVisible: page === 'home' && !showingServices, language: user?.language || 'ru' });
  useEffect(() => {
    const available = appVariant === 'driver' && driver && !!user?.driverProfile?.online
      && locationEnabled && permissionStep === 'done' && !isActive(order);
    if (!available || !user) {
      if (!user?.driverProfile?.online) availabilityPrompted.current = false;
      void setDriverAvailability(false).catch(() => undefined);
      return;
    }
    let active = true;
    void setDriverAvailability(true, user.id).then(ready => {
      if (ready || !active || availabilityPrompted.current || AppState.currentState !== 'active') return;
      availabilityPrompted.current = true;
      void requestDriverBackgroundAccess(user.language).then(granted => {
        if (granted && active) void setDriverAvailability(true, user.id).catch(() => undefined);
      }).catch(() => undefined);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [driver, user?.id, user?.language, user?.driverProfile?.online, locationEnabled, permissionStep, order?.id, order?.status, availabilityRetry]);
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
  const browsingPickup = !driver && !order && !dropoff && !mapSelection && (service === 'taxi' || !pickupChosenManually);
  const taxiBrowseOffset = useTaxiBrowseMotion(mapMoving && browsingPickup && service === 'taxi' && !addressField, bookingHeight);
  const { quote, previewQuote, quotes, calculating, quoteError, refresh: refreshQuotes, clear: clearQuotes } = useRideQuotes(pickup, dropoff, tariffs, tariffId, !!user && !driver && !order && service === 'taxi', user?.id);
  const deliveryTariffId=deliveryTariffs.find(item=>item.kind===deliveryKind)?.id||'';
  const { quote: deliveryQuote, previewQuote: deliveryPreviewQuote, quotes: deliveryQuotes, calculating: deliveryCalculating, quoteError: deliveryQuoteError, refresh: refreshDeliveryQuotes, clear: clearDeliveryQuotes } = useRideQuotes(pickup, dropoff, deliveryTariffs, deliveryTariffId, !!user && !driver && !order && service === 'delivery', user?.id);
  const activeMapPreview = (mapSelection || browsingPickup) && mapPreview?.field === (mapSelection || 'pickup') ? mapPreview : null;
  const previewPoint: Point | null = activeMapPreview && !activeMapPreview.pending && activeMapPreview.address
    ? { ...activeMapPreview.point, address: activeMapPreview.address } : null;
  const estimatePickup = activeMapPreview?.field === 'pickup' ? previewPoint : pickup;
  const estimateDropoff = activeMapPreview?.field === 'dropoff' ? previewPoint : dropoff;
  const mapEstimate = useMapEstimate(estimatePickup, estimateDropoff, tariffId,
    !!user && !driver && !order && page === 'home' && service === 'taxi' && !addressField && !savedPlaceEditing && !currentAddressEditing
      && !mapMoving && !activeMapPreview?.pending, user?.id);
  const displayedRouteQuote = quote ?? previewQuote;
  const mapTripEstimateBase = activeMapPreview ? mapEstimate?.trip ?? null
    : displayedRouteQuote ? { durationMinutes: Math.max(1, Math.ceil(displayedRouteQuote.durationSeconds / 60)),
      durationSeconds: displayedRouteQuote.durationSeconds, price: displayedRouteQuote.price } : null;
  const pickupEta = usePickupEta(mapEstimate, estimatePickup, tariffId,
    !!user && !driver && !order && service === 'taxi' && !savedPlaceEditing && !currentAddressEditing, user?.id);
  const pickupAvailability = usePickupAvailability(mapEstimate, estimatePickup, tariffId,
    !!user && !driver && !order && service === 'taxi' && !savedPlaceEditing && !currentAddressEditing, user?.id);
  const mapTripEstimate = mapTripEstimateBase ? { ...mapTripEstimateBase, price: pickupAvailability === 'unavailable' ? null : mapTripEstimateBase.price } : null;
  const updateUser = (next: User | null) => {
    const localized = next ? withSelectedLanguage(next) : null;
    driverSounds.setUser(localized);
    profileRevisionRef.current++;
    userRef.current = localized;
    setUser(localized);
    if (!next) setRegistrationAttention(null);
  };
  const refreshRegistrationAttention = useCallback(async (profile: User, autoOpen: boolean) => {
    if (appVariant !== 'driver' || profile.role !== 'DRIVER') { setRegistrationAttention(null); return; }
    const accountId = profile.id;
    try {
      const response = await api.request<unknown>('/driver/registration');
      if (userRef.current?.id !== accountId) return;
      const attention = registrationAttentionFromResponse(response);
      setRegistrationAttention(attention);
      if (autoOpen && attention && !attention.hasOperational) {
        setRegistrationDeepLink(null);
        setPage('registration');
      }
    } catch {
      // Registration status is advisory here: an offline check must never hide an existing driver home.
    }
  }, []);
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
    const previous = orderRef.current;
    if (currentUser?.role === 'DRIVER' && next && isActive(next) && next.id !== previous?.id) {
      // Notification acceptance can restore an assignment before offers load.
      if (previous && ['COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(previous.status)) {
        dismissedOrderIds.current.add(previous.id);
      }
      setDrawer(false);
      setChat(false);
      setIncoming(null);
      setHistoryDetailId(null);
      setRegistrationDeepLink(null);
      setError('');
      setPage('home');
    }
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
    if (isRoleAllowed(profile.role)) return false;
    updateUser(null);
    applyOrder(null);
    setOffers([]);
    setPermissionStep("loading");
    await Promise.allSettled([api.clear(), writeLastOrderId(null)]);
    setWrongAppLanguage(profile.language || "ru");
    return true;
  }

  async function refreshOffers() {
    const account = userRef.current;
    if (account?.role !== 'DRIVER' || !account.driverProfile?.online || isActive(orderRef.current)) return;
    if (offersSyncing.current) { offersAgain.current = true; return; }
    offersSyncing.current = true;
    const revision = offersRevision.current;
    try {
      const next = await api.request<Order[]>('/driver/offers');
      if (userRef.current?.id === account.id && userRef.current.driverProfile?.online
        && !isActive(orderRef.current) && revision === offersRevision.current) setOffers(next);
    } catch { /* The socket and the next short poll recover transient failures. */ }
    finally {
      offersSyncing.current = false;
      if (offersAgain.current) { offersAgain.current = false; void refreshOffers(); }
    }
  }

  async function sync() {
    if (!userRef.current) return;
    // Offers must not queue behind profile/history requests after a push arrives.
    void refreshOffers();
    if (syncRef.current) { syncAgain.current = true; return; }
    syncRef.current = true;
    const accountId = userRef.current.id;
    const profileRevision = profileRevisionRef.current;
    try {
      const [active, profile] = await Promise.all([
        api.request<Order | null>("/orders/active").then(active => {
          if (userRef.current?.id === accountId) {
            const currentActive = isDismissedOrderUpdate(active, dismissedOrderIds.current) ? null : active;
            if (currentActive) applyOrder(currentActive);
          }
          return active;
        }),
        api.request<User>("/users/me"),
      ]);
      if (userRef.current?.id !== accountId) return;
      if (isCurrentProfileResponse(accountId, profileRevision, userRef.current, profileRevisionRef.current, profile)) {
        if (await rejectMismatchedRole(profile)) return;
        if (isCurrentProfileResponse(accountId, profileRevision, userRef.current, profileRevisionRef.current, profile)) updateUser(profile);
      }
      const currentActive = isDismissedOrderUpdate(active, dismissedOrderIds.current) ? null : active;
      if (!currentActive && orderRef.current && isActive(orderRef.current)) {
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
      const currentProfile = userRef.current;
      if (currentProfile?.role !== "DRIVER" || !currentProfile.driverProfile?.online || currentActive) setOffers([]);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 0) setError(messageOf(e));
    } finally {
      syncRef.current = false;
      // A notification received during an HTTP refresh must not be discarded.
      if (syncAgain.current) { syncAgain.current = false; void sync(); }
    }
  }
  async function bootstrap() {
    setBooting(true);
    setBootError("");
    try {
      await readSelectedLanguage();
      const stored = await api.restore();
      if (stored) {
        const profile = await api.request<User>("/users/me");
        if (await rejectMismatchedRole(profile)) return;
        setPermissionStep(await readPermissionIntro(profile.id, permissionRole));
        updateUser(profile);
        void refreshRegistrationAttention(profile, true);
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
          setPendingDriverNotification(null);
          updateUser(null);
          applyOrder(null);
          setPickup(null);
          markManualPickup(false);
          setDropoff(null);
          setOffers([]);
          setSavedPlaces({});
          setSavedPlaceEditing(null);
          setCurrentAddressEditing(false);
          setAddressField(null);
          setMapField(null);
          setMapFocus(null);
          setRideDetails(emptyRideDetails);
          setDeliveryDetails(emptyDeliveryDetails);
          clearQuotes();
          clearDeliveryQuotes();
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
        setAvailabilityRetry(value => value + 1);
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
    let tariffsPending = false;
    let tariffsRetryNeeded = false;
    const refreshTariffs = () => {
      if (tariffsPending) return;
      tariffsPending = true;
      void Promise.allSettled([
      api.request<Tariff[]>("/tariffs"),
      api.request<Tariff[]>("/tariffs?kind=DELIVERY_CAR"),
      api.request<Tariff[]>("/tariffs?kind=DELIVERY_TRUCK"),
    ])
      .then(([rides, deliveryCars, deliveryTrucks]) => {
        if (!subscribed) return;
        tariffsRetryNeeded = [rides, deliveryCars, deliveryTrucks].some(result => result.status === 'rejected')
          || (rides.status === 'fulfilled' && rides.value.length === 0)
          || (deliveryCars.status === 'fulfilled' && deliveryTrucks.status === 'fulfilled'
            && deliveryCars.value.length + deliveryTrucks.value.length === 0);
        if (rides.status === 'fulfilled') {
          setTariffs(rides.value);
          setTariffId((current) => rides.value.some(tariff => tariff.id === current) ? current : rides.value[0]?.id || "");
        }
        if (deliveryCars.status === 'fulfilled' && deliveryTrucks.status === 'fulfilled')
          setDeliveryTariffs([...deliveryCars.value, ...deliveryTrucks.value]);
      })
      .finally(() => { tariffsPending = false; });
    };
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
      if (userRef.current?.role === 'CLIENT' && orderRef.current?.driver?.id
        && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(orderRef.current.status))
        socket.emit('tracking:subscribe', { orderId: orderRef.current.id });
      void sync();
      refreshTariffs();
      setContentRevision(value => value + 1);
      setFoodOrderRevision(value => value + 1);
      if (userRef.current?.notifications) void registerPushNotifications();
    });
    refreshTariffs();
    socket.on("content:changed", (event?: { resource?: string }) => {
      setContentRevision(value => value + 1);
      if (event?.resource === 'cities') setRegistrationRevision(value => value + 1);
      if (!event?.resource || event.resource === 'tariffs') refreshTariffs();
    });
    socket.on("tariffs:changed", refreshTariffs);
    socket.on("food:order:updated", () => setFoodOrderRevision(value => value + 1));
    socket.on("registration:updated", () => {
      setRegistrationRevision(value => value + 1);
      const profile = userRef.current;
      if (profile?.role === 'DRIVER') void refreshRegistrationAttention(profile, true);
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("session:expired", () => {
      void api.refresh().catch((e) => setError(messageOf(e)));
    });
    socket.on("driver:location", tracking.receive);
    socket.on("driver:location:update", tracking.receive);
    socket.on("order:updated", (next: Order) => {
      applyOrder(next);
      if (next.status === "COMPLETED" && userRef.current?.role === "DRIVER")
        void sync();
    });
    socket.on("order:offer", (next: Order) => {
      offersRevision.current++;
      if (offersSyncing.current) offersAgain.current = true;
      if (userRef.current?.driverProfile?.online && !isActive(orderRef.current))
        setOffers((current) =>
          current.some((item) => item.id === next.id)
            ? current
            : [...current, next],
        );
    });
    socket.on("order:withdrawn", ({ orderId }: { orderId: string }) => {
      offersRevision.current++;
      if (offersSyncing.current) offersAgain.current = true;
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
    let lastFullSync = Date.now();
    const interval = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      void refreshOffers();
      if (!socket.connected || Date.now() - lastFullSync >= 12000) {
        lastFullSync = Date.now(); void sync();
      }
    }, 3000);
    const tariffRetry = setInterval(() => { if (tariffsRetryNeeded) refreshTariffs(); }, 30000);
    return () => {
      subscribed = false;
      clearInterval(interval);
      clearInterval(tariffRetry);
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [refreshRegistrationAttention, user?.id]);
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || user?.role !== 'CLIENT') return;
    if (order?.driver?.id && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status))
      socket.emit('tracking:subscribe', { orderId: order.id });
    return () => { if (order?.id) socket.emit('tracking:unsubscribe', { orderId: order.id }); };
  }, [user?.role, order?.id, order?.status, order?.assignmentId, order?.driver?.id]);
  useEffect(() => {
    driverSounds.offers(offers, order);
  }, [offers, order, user?.id, user?.notifications, user?.driverProfile?.online, clock]);
  useEffect(() => onNotificationReceived(data => {
    if (AppState.currentState !== "active" || !userRef.current) return;
    void sync();
    if (data.event === 'rider:coming' && data.orderId === orderRef.current?.id) setComing(true);
    if (typeof data.event === 'string' && data.event.startsWith('registration:')) {
      setRegistrationRevision(value => value + 1);
      const profile = userRef.current;
      if (profile.role === 'DRIVER') void refreshRegistrationAttention(profile, true);
    }
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
  }), [refreshRegistrationAttention]);
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
      onNotificationOpened((_orderId, data, actionIdentifier) => {
        const action = appVariant === 'driver' ? parseDriverOfferAction(actionIdentifier, data) : null;
        if (action) setPendingDriverNotification(action);
        const registrationEvent = appVariant === 'driver' && typeof data.event === 'string' && data.event.startsWith('registration:');
        if (registrationEvent) setRegistrationRevision(value => value + 1);
        setRegistrationDeepLink(registrationEvent ? { event: data.event as string, ...(typeof data.slotKey === 'string' ? { slotKey: data.slotKey } : {}) } : null);
        setPage(registrationEvent ? 'registration' : 'home');
        void sync();
      }),
    [],
  );
  useEffect(() => {
    const registrationVisible = !!user && needsDriverRegistration(user, appVariant, page);
    if (!registrationVisible || !user?.notifications) return;
    let active = true;
    void getNotificationPermissionState()
      .then(permission => active && permission.granted ? registerPushNotifications() : null)
      .catch(() => undefined);
    return () => { active = false; };
  }, [page, user?.id, user?.notifications, user?.role, !!user?.driverProfile]);
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
    await writeSelectedLanguage(language);
    await api.setTokens(session);
    const profile =
      language === 'en' || session.user.language === language
        ? session.user
        : await api.patch<User>("/users/me", { language });
    if (await rejectMismatchedRole(profile)) return;
    setPermissionStep(await readPermissionIntro(profile.id, permissionRole));
    setPermissionError("");
    setPermissionNeedsSettings(false);
    updateUser(profile);
    await writeLastOrderId(null);
    setBootError("");
    setPage("home");
    setService('hub');
    setFoodEntry(value => ({ screen: 'home', key: value.key + 1 }));
    void refreshRegistrationAttention(profile, true);
  }
  const logout = async () => {
    if (logoutRef.current) return;
    logoutRef.current = true;
    setDrawer(false);
    const refreshToken = api.getTokens()?.refreshToken;
      try {
        await endSession({
          unregister: unregisterPushNotifications,
          revoke: () => api.post("/auth/logout", { refreshToken }),
          clear: () => api.clear(),
        });
      } finally {
        logoutRef.current = false;
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
    };
  const online = (value: boolean) =>
    run(async () => {
      const position=value?await getCurrentPosition():null;
      await api.patch("/driver/online", { online: value });
      if(position)await api.patch('/driver/position',{latitude:position.latitude,longitude:position.longitude,accuracyM:position.accuracy??100,measuredAtMs:Date.now()});
      updateUser(await api.request<User>("/users/me"));
      if (value && userRef.current?.notifications) void registerPushNotifications();
      if (!value) setOffers([]);
    });
  const selectAddress = (field: "pickup" | "dropoff", point: Point) => {
    const selected = normalizePoint(point);
    setError("");
    if (field === "pickup") { savedPlacePickupRequest.current++; setLocatingSavedPlacePickup(false); setPickup(selected); markManualPickup(!selected.address.startsWith('GPS:')); setRideDetails(current => ({ ...current, entrance: "" })); }
    else setDropoff(selected);
    setAddressField(null);
    setMapField(field === "dropoff" && !pickup ? "pickup" : null);
    setMapFocus(null);
    if (currentAddressEditing) { setCurrentAddressEditing(false); setService('hub'); }
    setRecenter((value) => value + 1);
  };
  const resolvePoint = (point: Coordinate): Promise<Point> => reverseGeocode(point, user?.language ?? 'ru');
  const gpsPoint = (point: Coordinate): Point => ({
    latitude: point.latitude,
    longitude: point.longitude,
    address: `GPS: ${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`,
  });
  const persistSavedPlace = async (kind: SavedPlaceKind, point: Point) => {
    if (!user || user.role !== 'CLIENT') return;
    const places = { ...savedPlaces, [kind]: normalizePoint(point) };
    await writeSavedPlaces(user.id, places);
    if (userRef.current?.id !== user.id) return;
    setSavedPlaces(places);
    setSavedPlaceEditing(null);
    setMapField(null);
    setAddressField(null);
    setMapFocus(null);
    setService('hub');
  };
  const editSavedPlace = (kind: SavedPlaceKind) => {
    setCurrentAddressEditing(false);
    setSavedPlaceEditing(kind);
    setAddressField('dropoff');
    setError('');
  };
  const openSavedPlace = (kind: SavedPlaceKind) => {
    const place = savedPlaces[kind];
    if (place) {
      const request = ++savedPlacePickupRequest.current;
      const accountId = user?.id;
      setDropoff(place);
      setAddressField(null);
      setMapField(null);
      setService('taxi');
      markManualPickup(false);
      setPickup(null);
      setLocatingSavedPlacePickup(true);
      void getCurrentPosition().then(point => {
        if (savedPlacePickupRequest.current !== request || userRef.current?.id !== accountId || pickupChosenManuallyRef.current) return;
        setPickup(gpsPoint(point));
        setLocatingSavedPlacePickup(false);
        void resolvePoint(point).then(resolved => {
          if (savedPlacePickupRequest.current !== request || userRef.current?.id !== accountId || pickupChosenManuallyRef.current) return;
          setPickup(selected => selected && selected.latitude === point.latitude && selected.longitude === point.longitude ? normalizePoint(resolved) : selected);
        }).catch(() => undefined);
      }).catch(cause => {
        if (savedPlacePickupRequest.current === request && userRef.current?.id === accountId) { setLocatingSavedPlacePickup(false); setError(messageOf(cause)); }
      }).finally(() => void refreshLocationPermission().catch(() => undefined));
    } else {
      editSavedPlace(kind);
    }
    setError('');
  };
  const rememberPermissionStep = async (next: PermissionIntroState, accountId = userRef.current?.id) => {
    if (!accountId || userRef.current?.id !== accountId) return;
    await writePermissionIntro(accountId, next, permissionRole);
    if (userRef.current?.id !== accountId) return;
    setPermissionStep(next);
    setPermissionError("");
    setPermissionNeedsSettings(false);
  };
  const locateAfterPermissionGrant = (currentUser: User) => {
    if (currentUser.role === 'CLIENT') automaticPickupPending.current = true;
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
    }).catch(() => undefined).finally(() => {
      automaticPickupPending.current = false;
      void refreshLocationPermission().catch(() => undefined);
    });
  };
  useEffect(() => {
    if (!user || user.role !== 'CLIENT' || !showingServices || permissionStep !== 'done' || !locationEnabled ||
      pickup || pickupChosenManuallyRef.current || automaticPickupPending.current || AppState.currentState !== 'active') return;
    const accountId = user.id;
    const request = ++savedPlacePickupRequest.current;
    let live = true;
    automaticPickupPending.current = true;
    void getCurrentPosition().then(point => {
      if (!live || userRef.current?.id !== accountId || savedPlacePickupRequest.current !== request || pickupChosenManuallyRef.current) return;
      setSearchCenter(point);
      setPickup(gpsPoint(point));
      void reverseGeocode(point, user.language).then(resolved => {
        if (userRef.current?.id !== accountId || savedPlacePickupRequest.current !== request || pickupChosenManuallyRef.current) return;
        setPickup(selected => selected && selected.latitude === point.latitude && selected.longitude === point.longitude ? normalizePoint(resolved) : selected);
      }).catch(() => undefined);
    }).catch(() => undefined).finally(() => { automaticPickupPending.current = false; });
    return () => { live = false; };
  }, [user?.id, user?.language, showingServices, permissionStep, locationEnabled, pickup, pickupChosenManually, availabilityRetry]);
  const completePermissionStep = async (step: PermissionStep, currentUser: User) => {
    await rememberPermissionStep(nextPermissionStep(step, permissionRole), currentUser.id);
    if (userRef.current?.id !== currentUser.id) return;
    if (step === 'location') locateAfterPermissionGrant(currentUser);
    if (step === 'notifications') {
      if (!currentUser.notifications) {
        void api.patch<User>("/users/me", { notifications: true }).then(next => {
          if (userRef.current?.id === currentUser.id) updateUser(next);
        }).catch(() => undefined);
      }
      void registerPushNotifications();
    }
  };
  useEffect(() => {
    if (!permissionBusy && permissionRefreshPending.current) {
      permissionRefreshPending.current = false;
      setPermissionRefreshVersion(value => value + 1);
    }
  }, [permissionBusy]);
  useEffect(() => {
    const currentUser = userRef.current;
    if (!currentUser || permissionStep === 'loading' || permissionStep === 'done') return;
    const step = permissionStep;
    let live = true;
    // Also recheck on every return from system settings. A resolved settings
    // intent is not evidence that the user changed the actual permission.
    void getOnboardingPermissionState(step).then(async permission => {
      if (!live || userRef.current?.id !== currentUser.id) return;
      if (permissionBusyRef.current) {
        permissionRefreshPending.current = true;
        return;
      }
      if (step === 'location') {
        ++locationPermissionVersion.current;
        setLocationPermission(permission as LocationPermissionState);
      }
      if (!permission.granted) {
        setPermissionNeedsSettings(permission.supported !== false && !permission.canAskAgain);
        return;
      }
      permissionBusyRef.current = true;
      setPermissionBusy(true);
      try { await completePermissionStep(step, currentUser); }
      finally { permissionBusyRef.current = false; setPermissionBusy(false); }
    }).catch(e => {
      if (live && userRef.current?.id === currentUser.id) setPermissionError(messageOf(e));
    });
    return () => { live = false; };
  }, [user?.id, permissionStep, availabilityRetry, permissionRefreshVersion]);
  const allowPermission = async () => {
    const currentUser = userRef.current;
    if (!currentUser || permissionBusyRef.current || permissionStep === "loading" || permissionStep === "done") return;
    const step = permissionStep;
    permissionBusyRef.current = true;
    setPermissionBusy(true);
    setPermissionError("");
    try {
      if (permissionNeedsSettings) {
        await openOnboardingPermissionSettings(step);
        // Keep this screen until the resume check observes a real grant.
        return;
      }
      const permission = await requestOnboardingPermission(step);
      if (userRef.current?.id !== currentUser.id) return;
      if (step === 'location') {
        ++locationPermissionVersion.current;
        setLocationPermission(permission as LocationPermissionState);
      }
      if (permission.supported === false) {
        await rememberPermissionStep(nextPermissionStep(step, permissionRole), currentUser.id);
        return;
      }
      if (!permission.granted) {
        setPermissionNeedsSettings(!permission.canAskAgain);
        if (step === 'location') setPermissionError(permission.canAskAgain
          ? "Разрешите доступ к местоположению или выберите адрес вручную."
          : "Разрешите доступ к местоположению в настройках устройства.");
        else if (step === 'notifications') setPermissionError(permission.canAskAgain
          ? "Разрешите уведомления, чтобы не пропустить события поездки."
          : "Разрешите уведомления в настройках устройства.");
        return;
      }
      // A GPS fix and push-token registration run independently of the grant.
      await completePermissionStep(step, currentUser);
    } catch (e) {
      if (userRef.current?.id === currentUser.id) setPermissionError(messageOf(e));
    } finally {
      permissionBusyRef.current = false;
      setPermissionBusy(false);
    }
  };
  const skipPermission = async () => {
    const currentUser = userRef.current;
    if (!currentUser || permissionBusyRef.current || permissionStep === "loading" || permissionStep === "done") return;
    const step = permissionStep;
    permissionBusyRef.current = true;
    setPermissionBusy(true);
    try {
      if (step === 'notifications' && currentUser.notifications) {
        try {
          const next = await api.patch<User>("/users/me", { notifications: false });
          if (userRef.current?.id === currentUser.id) updateUser(next);
        } catch (e) { setError(messageOf(e)); }
      }
      await rememberPermissionStep(nextPermissionStep(step, permissionRole), currentUser.id);
    } catch (e) {
      if (userRef.current?.id === currentUser.id) setPermissionError(messageOf(e));
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
  const mapSelect = (point: Coordinate & { address?: string }) => {
    if (mapSelection) {
      const field = mapSelection;
      void run(async () => {
        const selected = point.address?.trim() ? normalizePoint({ ...point, address: point.address }) : await resolvePoint(point);
        if (savedPlaceEditing) await persistSavedPlace(savedPlaceEditing, selected);
        else selectAddress(field, selected);
      });
    }
  };
  const book = () =>
    run(async () => {
      if (!quote || pickupAvailability === 'unavailable') return;
      if (rideComment(rideDetails).length > 500) throw new Error("Сократите комментарий до 500 символов.");
      if (orderKey.current?.quoteId !== quote.id)
        orderKey.current = { quoteId: quote.id, key: requestId() };
      let created: Order;
      try {
        created = await api.post<Order>("/orders", {
          quoteId: quote.id,
          comment: rideComment(rideDetails),
          passenger: rideDetails.passenger || undefined,
          idempotencyKey: orderKey.current.key,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 400 && /Расчёт стоимости истёк/i.test(error.message)) {
          refreshQuotes();
          return;
        }
        throw error;
      }
      applyOrder(created);

      clearQuotes();
    });
  const bookDelivery = () =>
    run(async () => {
      if (!deliveryQuote) return;
      if (orderKey.current?.quoteId !== deliveryQuote.id) orderKey.current = { quoteId: deliveryQuote.id, key: requestId() };
      let created: Order;
      try {
        created = await api.post<Order>('/orders', {
          quoteId: deliveryQuote.id,
          comment: deliveryDetails.comment.trim(),
          delivery: {
            goodsDescription: deliveryKind === 'DELIVERY_TRUCK' ? 'Грузовой заказ' : 'Доставка',
            doorToDoor: deliveryDetails.doorToDoor,
            ...(deliveryDetails.scheduled ? { scheduledAt: new Date(Date.now() + 30 * 60_000).toISOString() } : {}),
          },
          idempotencyKey: orderKey.current.key,
        });
      } catch (error) {
        if (error instanceof ApiError && error.status === 400 && /Расчёт стоимости истёк/i.test(error.message)) {
          refreshDeliveryQuotes();
          return;
        }
        throw error;
      }
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
        else { setPickup(current.pickup); markManualPickup(true); setDropoff(current.dropoff); }
        setRecenter(value => value + 1);
      }
      clearQuotes();
      clearDeliveryQuotes();
      orderKey.current = null;
      setComing(false);
      setRideDetails(emptyRideDetails);
      setDeliveryDetails(emptyDeliveryDetails);
      // The old order is dismissed locally. Profile synchronization can finish
      // in the background while fresh quotes make the next booking available.
      void sync();
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
  async function acceptOffer(offer: Order) {
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
  }
  async function skipOffer(offer: Order) {
      driverSounds.stopOffer(offer.id);
      await api.post(`/orders/${offer.id}/skip`);
      setOffers((current) => current.filter((item) => item.id !== offer.id));
  }
  const accept = (offer: Order) => run(() => acceptOffer(offer));
  const skip = (offer: Order) => run(() => skipOffer(offer));
  useEffect(() => {
    // A cold notification tap arrives before bootstrap has restored the account.
    if (!pendingDriverNotification || booting || bootError || !user || busy || busyRef.current) return;
    const intent = pendingDriverNotification;
    setPendingDriverNotification(null);
    if (appVariant !== 'driver' || user.role !== 'DRIVER' || user.id !== intent.recipientId) return;
    setPage('home');
    void run(async () => {
      const result = await performDriverOfferAction(intent, {
        getUser: () => userRef.current, getOrder: () => orderRef.current,
        loadOffers: () => api.request<Order[]>('/driver/offers'),
        accept: acceptOffer, skip: skipOffer,
      });
      if (result === 'expired') {
        await sync();
        throw new Error('Предложение истекло или заказ уже недоступен');
      }
    });
  }, [pendingDriverNotification, booting, bootError, user?.id, user?.role, busy]);
  const navigate = (next: Page) => {

    setDrawer(false);
    setHistoryDetailId(null);
    if (next === 'registration') setRegistrationDeepLink(null);
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
      if (mapField) { setMapField(null); setMapFocus(null); if (savedPlaceEditing || currentAddressEditing) { setSavedPlaceEditing(null); setCurrentAddressEditing(false); setService('hub'); } return true; }
      if (!driver && page === 'history' && historyDetailId) { setHistoryDetailId(null); return true; }
      if (page !== "home") { setPage("home"); return true; }
      if (!driver && !order && dropoff) { setDropoff(null); return true; }
      if (!driver && !order && page === 'home') { setService('hub'); setFoodEntry(value => ({ screen: 'home', key: value.key + 1 })); return true; }
      return false;
    });
    return () => back.remove();
  }, [addressField, chat, drawer, mapField, savedPlaceEditing, currentAddressEditing, page, driver, order, dropoff, showingServices, historyDetailId]);
  const offer = driver && !isActive(order)
    ? offers.find(
        (item) =>
          !item.searchExpiresAt ||
          new Date(item.searchExpiresAt).getTime() > clock,
      )
    : undefined;
  useDriverOfferExpiry(driver ? offer : undefined, setClock);
  const visibleDriverOrder = driver && offer ? null : order;
  const displayed = visibleDriverOrder || offer;
  const showDriverTabs = shouldShowDriverTabs(order, offer, page);
  const approachScope = driver && offer ? `offer:${offer.id}` : '';
  const approach = useApproachRoute(driver ? navigation.position : null, driver ? offer?.pickup : null, approachScope);
  const mapRoutes = tripMapRoutes({ driver, order: visibleDriverOrder, offer, quote: savedPlaceEditing || currentAddressEditing ? null : service === 'delivery' ? deliveryQuote : quote, navigationRoute: navigation.route, approachRoute: approach.route });
  const hideTripDestination = driver && !!visibleDriverOrder && ['ASSIGNED', 'ARRIVED'].includes(visibleDriverOrder.status);
  useEffect(() => {
    if (presentedOffers.current.userId !== user?.id) {
      presentedOffers.current = { userId: user?.id, ids: new Set() };
    }
    if (!driver || !offer || !user?.driverProfile?.online || isActive(orderRef.current)) return;
    // A queued socket update or a resumed app must not open an expired offer.
    if (offer.searchExpiresAt && !(new Date(offer.searchExpiresAt).getTime() > Date.now())) return;
    const previous = orderRef.current;
    if (previous && ['COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(previous.status)) {
      dismissedOrderIds.current.add(previous.id);
      applyOrder(null);
      void writeLastOrderId(null).catch(() => undefined);
    }
    // Repeated polls for the same offer must not keep resetting navigation.
    if (presentedOffers.current.ids.has(offer.id)) return;
    presentedOffers.current.ids.add(offer.id);
    setDrawer(false);
    setChat(false);
    setIncoming(null);
    setHistoryDetailId(null);
    setRegistrationDeepLink(null);
    setError('');
    setPage('home');
  }, [driver, user?.id, user?.driverProfile?.online, offer?.id, offer?.searchExpiresAt, order?.id, order?.status, applyOrder]);


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
  if (needsClientName(user, appVariant)) return <ClientNameScreen key={user.id} user={user} onSave={async (firstName, lastName) => {
    const accountId = user.id;
    if (userRef.current?.id !== accountId) return;
    const profile = await api.patch<User>('/users/me', { firstName, lastName });
    if (userRef.current?.id === accountId && profile.id === accountId) updateUser(profile);
  }} onBack={() => { void logout().catch(failure => setError(messageOf(failure))); }} />;
  if (needsDriverRegistration(user, appVariant, page)) return <DriverRegistrationScreen user={user} deepLink={registrationDeepLink} statusRevision={registrationRevision} onRegistered={async profile => {
    updateUser(profile);
    setRegistrationDeepLink(null);
    setPage('home');
    void refreshRegistrationAttention(profile, false);
    setPermissionStep(await readPermissionIntro(profile.id, permissionRole));
    setPermissionError('');
    setPermissionNeedsSettings(false);
  }} onLogout={async () => {
    try { await api.post('/auth/logout',{refreshToken:api.getTokens()?.refreshToken}); } catch {}
    await api.clear();
    updateUser(null);
    setPermissionStep('loading');
  }} onClose={user.driverProfile ? () => { setRegistrationDeepLink(null); setPage('profile'); void refreshRegistrationAttention(user, false); } : undefined}/>;
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
    registration: "Допуски и документы",
  };
  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      <View accessibilityElementsHidden={!!addressField} importantForAccessibility={addressField ? 'no-hide-descendants' : 'auto'} style={{ flex: 1 }}>
      <View key={page === "home" ? "map-header" : "account-header"} collapsable={false} pointerEvents="box-none" style={[{ paddingTop: insets.top, backgroundColor: palette.surface }, page === "home" && { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10, backgroundColor: "transparent" }, (!!mapSelection || showingServices || driver && (visibleDriverOrder?.status === 'COMPLETED' || ['history', 'profile', 'settings', 'balance'].includes(page))) && { display: "none" }]} >
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
      {driver && registrationAttention ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${registrationAttention.message}. Открыть допуски и документы`}
          onPress={() => navigate('registration')}
          style={{
            marginTop: page === 'home' ? insets.top + 56 : 0,
            paddingHorizontal: 16,
            paddingVertical: 10,
            backgroundColor: registrationAttention.status === 'BLOCKED' ? (isDark ? '#331B20' : '#FFF0F1') : (isDark ? '#342A14' : '#FFF6DE'),
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <Icon name={registrationAttention.status === 'BLOCKED' ? 'close-circle-outline' : 'alert-circle-outline'} color={registrationAttention.status === 'BLOCKED' ? colors.danger : '#A46900'}/>
          <View style={{ flex: 1 }}><Text style={{ color: palette.ink, fontSize: 13, fontWeight: '700' }}>{t(registrationAttention.message)}</Text><Text style={{ color: palette.muted, fontSize: 11, marginTop: 2 }}>{t('Открыть допуски и документы')}</Text></View>
          <Icon name="chevron-forward" size={18} color={palette.muted}/>
        </Pressable>
      ) : null}
      {!showingServices && !(driver && visibleDriverOrder?.status === 'COMPLETED') && (offline || !connected) && (
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
        <MapPanelLayout session={driver ? displayed?.id || "driver-idle" : "client-map"}>{({ height: driverPanelHeight, ready: driverPanelReady, animatedInset: animatedDriverPanelInset, onHeight: setDriverPanelHeight }) => (
        <View style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              minHeight: visibleDriverOrder?.status === "COMPLETED" ? 0 : 120,
              position: driver && visibleDriverOrder?.status === "COMPLETED" ? "relative" : "absolute",
              ...(!(driver && visibleDriverOrder?.status === "COMPLETED") ? { top: 0, left: 0, right: 0, bottom: 0 } : {}),
              backgroundColor: isDark ? palette.background : "#E6F0F6",
            }}
          >
            <TaxiMap
              theme={theme}
              language={user.language}
              pickup={displayed?.pickup || pickup}
              dropoff={hideTripDestination || currentAddressEditing ? null : savedPlaceEditing ? savedPlaces[savedPlaceEditing] || null : displayed?.dropoff || dropoff}
              dropoffRouteLabel={driver && offer ? `${km(offer.distanceMeters)} · ${tripTime(offer.durationSeconds, user.language)}` : undefined}
              pickupEtaMinutes={pickupEta}
              pickupAvailability={pickupAvailability}
              dropoffEstimate={mapTripEstimate}
              geometry={mapSelection ? mapEstimate?.trip?.geometry ?? null : mapRoutes.geometry}
              approachGeometry={mapRoutes.approachGeometry}
              routeOverview={mapRoutes.routeOverview}
              driverPosition={(driver ? navigation.position : tracking.position) || undefined}
              passengerView={!driver}
              cameraReady={!driver || driverPanelReady}
              stableOverview={driver && !!offer}
              cameraSession={`${displayed?.id || 'idle'}:${displayed?.status || 'idle'}`}
              navigationActive={navigation.active}
              followDriver={driver && !offer && navigation.followDriver}
              onFollowDriverChange={navigation.setFollowDriver}
              selectionMode={mapSelection}
              selectionTitle={currentAddressEditing ? t('Ваш адрес') : savedPlaceEditing ? savedPlaceTitles[savedPlaceEditing] : undefined}
              browsePickup={browsingPickup}
              preferPickupCenter={pickupChosenManually}
              onSelectionPreview={setMapPreview}
              onMapMovingChange={setMapMoving}
              browseControlsOffset={service === 'taxi' && !dropoff && !mapSelection ? taxiBrowseOffset : undefined}
              onBack={!driver && !order && service === 'taxi' ? () => {
                if (mapSelection) { setMapField(null); setMapFocus(null); if (savedPlaceEditing || currentAddressEditing) { setSavedPlaceEditing(null); setCurrentAddressEditing(false); setService('hub'); } }
                else if (dropoff) setDropoff(null);
                else openServices('home');
              } : undefined}
              backLabel={t(mapSelection || dropoff ? 'Назад' : 'На главный экран')}
              onSelectionInteraction={action => { if (action === 'move' && !mapSelection && service === 'taxi') markManualPickup(true); }}
              showUserPosition={locationEnabled && !driver}
              onUserLocation={point => setSearchCenter(previous => previous && Math.hypot(
                (point.latitude - previous.latitude) * 111320,
                (point.longitude - previous.longitude) * 111320 * Math.cos(point.latitude * Math.PI / 180),
              ) < 5 ? previous : point)}
              onPickupChange={point => {
                if (!pickup || Math.abs(pickup.latitude - point.latitude) + Math.abs(pickup.longitude - point.longitude) > .00005) setRideDetails(value => ({ ...value, entrance: '' }));
                setPickup(normalizePoint(point));
              }}
              onPanelHeight={setMapPanelHeight}
              focusPoint={driver ? null : mapFocus}
              onSearchPoint={() => { if (mapSelection) { setAddressField(mapSelection); setMapField(null); if (savedPlaceEditing || currentAddressEditing) setService('hub'); } }}
              onEditPoint={!driver && !order && !savedPlaceEditing && !currentAddressEditing ? setMapField : undefined}
              selecting={busy}
              contentTopInset={insets.top + (driver && visibleDriverOrder?.status === 'COMPLETED' ? 8 : navigation.active ? navigationHeight + 72 : driver && offer ? 130 : 64)}
              animatedBottomInset={driver && visibleDriverOrder?.status !== 'COMPLETED' ? animatedDriverPanelInset : undefined}
              contentBottomInset={driver
                ? visibleDriverOrder?.status !== "COMPLETED" ? Math.max(0, driverPanelHeight) : 0
                : !mapSelection && !addressField ? Math.max(0, bookingHeight) : 0}
              centerInVisibleArea={!driver && !order && service === 'delivery' && !mapSelection}
              onSelectPoint={mapSelect}
              recenterKey={recenter}
            />
            {navigation.active && <DriverNavigation language={user.language} navigation={navigation} top={insets.top + 62} onHeight={setNavigationHeight} onLocation={() => void openLocationSettings().catch(() => undefined)}/>}
            {driver && trackingDiagnosticsEnabled && <DriverTrackingDiagnostics navigation={navigation} top={insets.top + (navigation.active ? navigationHeight + 76 : offer ? 140 : 70)}/>}
            {driver && offer && <View style={{ position: 'absolute', top: insets.top + 65, left: 0, right: 0, alignItems: 'center' }}><DriverOfferSkip offer={offer} busy={busy} language={user.language} onSkip={skip}/></View>}
            {!driver && !order && !mapMoving && (mapSelection || !dropoff) && (
              <Pressable accessibilityRole="button" accessibilityLabel={t(mapSelection === 'dropoff' ? 'Пункт назначения' : 'Место подачи')} onPress={() => { if (mapSelection) { setAddressField(mapSelection); setMapField(null); if (savedPlaceEditing || currentAddressEditing) setService('hub'); } else openAddress('pickup'); }} style={{ position: "absolute", top: insets.top + 10, left: 76, right: 76, paddingHorizontal: 12, paddingVertical: 8, alignItems: "center" }}>
                <Text style={{ fontSize: 11, color: palette.muted, textShadowColor: palette.surface, textShadowRadius: 5 }}>{t(mapSelection === 'dropoff' ? 'Пункт назначения' : 'Ваш адрес')} ›</Text>
                <Text accessibilityLiveRegion="polite" style={{ fontSize: 14, lineHeight: 19, color: palette.ink, fontWeight: "700", width: "100%", textAlign: "center", textShadowColor: palette.surface, textShadowRadius: 6 }} numberOfLines={1}>{!mapMoving && activeMapPreview?.pending ? t('Уточняем…') : shortAddress(activeMapPreview?.address || (mapSelection === 'dropoff' ? dropoff?.address : pickup?.address)) || t("Выберите место подачи")}</Text>
              </Pressable>
            )}
            {service !== 'taxi' && mapSelection && <View style={{ position: "absolute", left: 17, bottom: mapPanelHeight + 48 }}><IconButton name="arrow-back" label={t("Назад")} onPress={() => { setMapField(null); setMapFocus(null); if (savedPlaceEditing || currentAddressEditing) { setSavedPlaceEditing(null); setCurrentAddressEditing(false); setService('hub'); } }}/></View>}
            {service !== 'taxi' && !driver && !order && dropoff && !mapSelection && <View style={{ position: "absolute", left: 17, bottom: 48 }}><IconButton name="arrow-back" label={t("Назад")} onPress={() => setDropoff(null)}/></View>}
          </View>
          {driver && visibleDriverOrder?.status !== 'COMPLETED' && <View pointerEvents="none" style={{ flex: 1 }}/> }
          {driver && visibleDriverOrder?.status === 'COMPLETED' && <View style={{ height: Math.max(0, driverCompletionHeight - 30) }}/>}
          {driver && <DriverPanel key={offer?.id || order?.id || 'idle'} user={user} order={visibleDriverOrder} offer={offer} busy={busy} coming={coming} approach={approach} navigation={navigation} backgroundReady={navigation.backgroundReady} onBackground={navigation.enableBackground} onAccept={accept} onRateClient={rateClient} onCompletionHeight={setDriverCompletionHeight} onHeight={setDriverPanelHeight} animatedInset={animatedDriverPanelInset} onOnline={() => online(true)} onAction={action} onChat={() => setChat(true)} onDone={done}/>}
          {!driver && <View pointerEvents="none" style={{ flex: 1 }}/>}
          {!driver && !order && service === 'taxi' && <>
            <BookingPanel pickup={pickup} dropoff={dropoff} locatingPickup={locatingSavedPlacePickup} tariffs={tariffs} tariffId={tariffId}
              pickupAvailability={pickupAvailability} routeDurationSeconds={mapTripEstimateBase?.durationSeconds}
              quote={quote} previewQuote={previewQuote} quotes={quotes} calculating={calculating} quoteError={quoteError} bookingError={error} busy={busy}
              language={user.language} details={rideDetails} onDetails={setRideDetails}
              onAddress={setAddressField} registerAddressOpener={registerAddressOpener} onTariff={setTariffId} hidden={!!mapSelection || !!addressField} mapMoving={mapMoving} browseOffset={taxiBrowseOffset} onHeight={setBookingHeight}
              onSwap={() => { setPickup(dropoff); setDropoff(pickup); setRideDetails(current => ({ ...current, entrance: '' })); }}
              onBook={book}
            />
          </>}
          {!driver && !order && service === 'delivery' && <>
            <DeliveryPanel language={user.language} pickup={pickup} dropoff={dropoff} tariffs={deliveryTariffs} selectedKind={deliveryKind}
              quote={deliveryQuote} previewQuote={deliveryPreviewQuote} quotes={deliveryQuotes} calculating={deliveryCalculating} error={error || deliveryQuoteError} busy={busy}
              details={deliveryDetails} onDetails={setDeliveryDetails} onKind={kind => { setDeliveryKind(kind); setError(''); }}
              onAddress={setAddressField} registerAddressOpener={registerAddressOpener} hidden={!!mapSelection || !!addressField} onHeight={setBookingHeight}
              onSwap={() => { setPickup(dropoff); setDropoff(pickup); }}
              onBook={bookDelivery}
            />
          </>}
          {!driver && order && <>
            <ClientTripPanel order={order} user={user} busy={busy} onAction={action} onChat={() => setChat(true)} onDone={() => done(order.id)} onReset={() => done(order.id, true)} onRating={rate} coming={coming} onHeight={setBookingHeight} driverPosition={tracking.position} trackingWaiting={tracking.waiting} trackingStatus={tracking.statusMessage} approach={approach.route}/>
          </>}
        </View>
        )}</MapPanelLayout>
      ) : (
        <AccountScreen
          key={`${page}:${user.id}`}
          page={page}
          user={user}
          config={config}
          onUser={profile => { if (userRef.current?.id === profile.id) updateUser(profile); }}
          onError={setError}
          onOnline={online}
          onNavigate={navigate}
          onMenu={() => setDrawer(true)}
          onLogout={() => void logout().catch(error => setError(messageOf(error)))}
          historyDetailId={historyDetailId}
          onHistoryDetailId={setHistoryDetailId}
          busy={busy}
          themePreference={themePreference}
          onThemePreferenceChange={onThemePreferenceChange}
          voiceEnabled={driver ? navigation.voiceEnabled : undefined}
          onVoiceEnabledChange={driver ? navigation.setVoiceEnabled : undefined}
        />
      )}
      {driver && showDriverTabs ? (
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
      ) : (page === 'home' && !showingServices || driver && ['history', 'profile', 'settings', 'balance'].includes(page)) ? null : (
        <View style={{ height: insets.bottom, backgroundColor: palette.surface }} />
      )}
      {!driver && <View pointerEvents={showingServices ? 'auto' : 'none'} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 20, display: showingServices ? 'flex' : 'none' }}>
        <FoodExperience key={user.id} userId={user.id} userPhone={user.phone} language={user.language} contentRevision={contentRevision} orderRevision={foodOrderRevision} active={showingServices} entry={foodEntry} defaultAddress={pickup?.address || ''} defaultPoint={pickup} savedPlaces={savedPlaces} onSavedPlace={openSavedPlace} onEditSavedPlace={editSavedPlace} onTaxi={() => { setService('taxi'); setError(''); }} onDelivery={() => { setDeliveryKind('DELIVERY_CAR'); setService('delivery'); setError(''); }} onTruck={() => { setDeliveryKind('DELIVERY_TRUCK'); setService('delivery'); setError(''); }} onTaxiSearch={() => { setService('taxi'); setAddressField('dropoff'); setError(''); }} onChangeAddress={() => { setSavedPlaceEditing(null); setCurrentAddressEditing(true); setAddressField('pickup'); setError(''); }} onMenu={() => setDrawer(true)} />
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
                <MenuRow icon="card-outline" label={t("Способы оплаты")} onPress={() => navigate('payment')} />
                <MenuRow icon="help-circle-outline" label={t("Поддержка")} onPress={() => navigate('support')} />
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
                onPress={() => void logout().catch(error => setError(messageOf(error)))}
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
          key={currentAddressEditing ? 'current-address' : savedPlaceEditing || 'ride'}
          field={addressField}
          center={searchCenter || pickup}
          userLocation={locationEnabled ? searchCenter : null}
          pickup={pickup}
          dropoff={dropoff}
          savedPlace={currentAddressEditing ? { title: 'Ваш адрес', point: pickup } : savedPlaceEditing ? { title: savedPlaceTitles[savedPlaceEditing], point: savedPlaces[savedPlaceEditing] } : undefined}
          onFieldChange={setAddressField}
          language={user.language}
          onSelect={(point) => { if (savedPlaceEditing) void run(() => persistSavedPlace(savedPlaceEditing, point)); else selectAddress(addressField, point); }}
          onClose={() => { setAddressField(null); if (savedPlaceMapTransition.current) savedPlaceMapTransition.current = false; else { setSavedPlaceEditing(null); setCurrentAddressEditing(false); } }}
          onMap={() => {
            if (savedPlaceEditing || currentAddressEditing) { savedPlaceMapTransition.current = true; setService('taxi'); }
            setMapFocus(null);
            setMapField(addressField);
            setAddressField(null);
          }}
          onLocation={() => {
            if (!savedPlaceEditing) { locate(); return; }
            const kind = savedPlaceEditing;
            void run(async () => {
              try {
                const coordinate = await getCurrentPosition();
                const point = await resolvePoint(coordinate).catch(() => gpsPoint(coordinate));
                await persistSavedPlace(kind, point);
              } catch (e) { Alert.alert(t('Не удалось сохранить адрес'), messageOf(e)); }
              finally { await refreshLocationPermission().catch(() => undefined); }
            });
          }}
        />
      )}
      {chat && order && (
        <ChatOverlay
          orderId={order.id}
          user={user}
          peerName={driver ? undefined : order.driver?.name}
          incoming={incoming}
          onClose={() => setChat(false)}
          onError={setError}
        />
      )}
    </View>
  );
}
