import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import NetInfo from "@react-native-community/netinfo";
import { io, Socket } from "socket.io-client";
import { api, ApiError, messageOf, requestId } from "./src/api";
import { AuthScreen } from "./src/AuthScreen";
import { AccountScreen, MenuRow, Page } from "./src/AccountScreens";
import { AddressPicker, ChatOverlay } from "./src/Overlays";
import { TripPanel } from "./src/TripPanel";
import {
  Avatar,
  Button,
  Car,
  CityArt,
  colors,
  Empty,
  Icon,
  IconButton,
  km,
  Logo,
  mins,
  money,
  Route,
  s,
  Sheet,
  tr,
} from "./src/ui";
import {
  AppConfig,
  ChatMessage,
  Coordinate,
  isActive,
  normalizePoint,
  Order,
  Point,
  Quote,
  Session,
  Tariff,
  User,
} from "./src/types";
import TaxiMap from "./src/native/TaxiMap";
import { reverseGeocode } from "./src/native/search";
import { getCurrentPosition } from "./src/native/location";
import {
  registerPushNotifications,
  unregisterPushNotifications,
  onNotificationOpened,
} from "./src/native/push";
import { readLastOrderId, writeLastOrderId } from "./src/native/sessionStore";

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <TaxiApp />
    </SafeAreaProvider>
  );
}
function TaxiApp() {
  const insets = useSafeAreaInsets();
  const [user, setUser] = useState<User | null>(null);
  const userRef = useRef<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const orderRef = useRef<Order | null>(null);
  const [offers, setOffers] = useState<Order[]>([]);
  const [page, setPage] = useState<Page>("home");
  const [drawer, setDrawer] = useState(false);
  const [chat, setChat] = useState(false);
  const [incoming, setIncoming] = useState<ChatMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dropoff, setDropoff] = useState<Point | null>(null);
  const [addressField, setAddressField] = useState<"pickup" | "dropoff" | null>(
    null,
  );
  const [mapField, setMapField] = useState<"pickup" | "dropoff" | null>(null);
  const [recenter, setRecenter] = useState(0);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [tariffId, setTariffId] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [comment, setComment] = useState("");
  const [coming, setComing] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const socketRef = useRef<Socket | null>(null);
  const orderKey = useRef<{ quoteId: string; key: string } | null>(null);
  const syncRef = useRef(false);
  const t = tr(user?.language || "ru");
  const driver = user?.role === "DRIVER";
  const quoteInput = JSON.stringify({ pickup, dropoff, tariffId });
  const quoteInputRef = useRef(quoteInput);
  quoteInputRef.current = quoteInput;
  const updateUser = (next: User | null) => {
    userRef.current = next;
    setUser(next);
  };
  const applyOrder = useCallback((next: Order | null) => {
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
    orderRef.current = next;
    setOrder(next);
    if (next) {
      void writeLastOrderId(next.id);
      setOffers((current) => current.filter((item) => item.id !== next.id));
    }
  }, []);

  async function sync() {
    if (!userRef.current || syncRef.current) return;
    syncRef.current = true;
    try {
      const [active, profile] = await Promise.all([
        api.request<Order | null>("/orders/active"),
        api.request<User>("/users/me"),
      ]);
      updateUser(profile);
      if (active) applyOrder(active);
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
      if (profile.role === "DRIVER" && profile.driverProfile?.online && !active)
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
        updateUser(profile);
        const active = await api.request<Order | null>("/orders/active");
        if (active) applyOrder(active);
        else {
          const id = await readLastOrderId();
          if (id) {
            try {
              const last = await api.request<Order>(`/orders/${id}`);
              if (last.status === "COMPLETED" && !last.rating) applyOrder(last);
              else await writeLastOrderId(null);
            } catch (e) {
              if (e instanceof ApiError && [403, 404].includes(e.status))
                await writeLastOrderId(null);
              else throw e;
            }
          }
        }
      }
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
          setOffers([]);
          setPage("home");
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
        setOffline(
          state.isConnected === false || state.isInternetReachable === false,
        );
        if (state.isConnected && state.isInternetReachable !== false)
          void sync();
      }),
    [],
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void sync();
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!user) return;
    void api
      .request<Tariff[]>("/tariffs")
      .then((result) => {
        setTariffs(result);
        setTariffId((current) => current || result[0]?.id || "");
      })
      .catch((e) => setError(messageOf(e)));
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
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("session:expired", () => {
      void api.refresh().catch((e) => setError(messageOf(e)));
    });
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
    socket.on("order:withdrawn", ({ orderId }: { orderId: string }) =>
      setOffers((current) => current.filter((item) => item.id !== orderId)),
    );
    socket.on("chat:message", setIncoming);
    socket.on("rider:coming", ({ orderId }: { orderId: string }) => {
      if (orderRef.current?.id === orderId) setComing(true);
    });
    const interval = setInterval(() => void sync(), 12000);
    return () => {
      clearInterval(interval);
      socket.removeAllListeners();
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [user?.id]);
  useEffect(() => {
    if (user?.notifications)
      void registerPushNotifications().catch((e) => setError(messageOf(e)));
    else if (user)
      void unregisterPushNotifications().catch((e) => setError(messageOf(e)));
  }, [user?.id, user?.notifications]);
  useEffect(
    () =>
      onNotificationOpened(() => {
        setPage("home");
        void sync();
      }),
    [],
  );
  useEffect(() => {
    setQuote(null);
    orderKey.current = null;
  }, [
    pickup?.latitude,
    pickup?.longitude,
    dropoff?.latitude,
    dropoff?.longitude,
    tariffId,
  ]);

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
    await api.setTokens(session);
    const profile =
      session.user.language === language
        ? session.user
        : await api.patch<User>("/users/me", { language });
    updateUser(profile);
    await writeLastOrderId(null);
    setBootError("");
    setPage("home");
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
        setPickup(null);
        setDropoff(null);
        setQuote(null);
      }
    });
  const online = (value: boolean) =>
    run(async () => {
      await api.patch("/driver/online", { online: value });
      updateUser(await api.request<User>("/users/me"));
      if (!value) setOffers([]);
    });
  const selectAddress = (field: "pickup" | "dropoff", point: Point) => {
    const selected = normalizePoint(point);
    if (field === "pickup") setPickup(selected);
    else setDropoff(selected);
    setAddressField(null);
    setMapField(null);
    setRecenter((value) => value + 1);
  };
  const resolvePoint = async (point: Coordinate): Promise<Point> =>
    process.env.EXPO_PUBLIC_YANDEX_MAPKIT_KEY && Platform.OS !== "web"
      ? reverseGeocode(point)
      : api.request<Point>(
          `/places/reverse?latitude=${point.latitude}&longitude=${point.longitude}`,
        );
  const locate = () =>
    run(async () => {
      const point = await getCurrentPosition();
      selectAddress("pickup", await resolvePoint(point));
    });
  const mapSelect = (point: Coordinate) => {
    if (mapField) {
      const field = mapField;
      void run(async () => selectAddress(field, await resolvePoint(point)));
    }
  };
  const calculate = () =>
    run(async () => {
      if (!pickup || !dropoff || !tariffId) return;
      const snapshot = quoteInputRef.current;
      const result = await api.post<Quote>("/orders/quote", {
        pickup: normalizePoint(pickup),
        dropoff: normalizePoint(dropoff),
        tariffId,
      });
      if (snapshot === quoteInputRef.current) setQuote(result);
    });
  const book = () =>
    run(async () => {
      if (!quote) return;
      if (Date.now() >= new Date(quote.expiresAt).getTime()) {
        setQuote(null);
        throw new Error("Расчёт устарел. Рассчитайте стоимость ещё раз.");
      }
      if (orderKey.current?.quoteId !== quote.id)
        orderKey.current = { quoteId: quote.id, key: requestId() };
      const created = await api.post<Order>("/orders", {
        quoteId: quote.id,
        comment: comment.trim(),
        idempotencyKey: orderKey.current.key,
      });
      applyOrder(created);
      setQuote(null);
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
  const done = () => {
    applyOrder(null);
    void writeLastOrderId(null);
    setQuote(null);
    orderKey.current = null;
    setComing(false);
    setComment("");
    void sync();
  };
  const rate = (score: number) =>
    run(async () => {
      if (order) {
        await api.post(`/orders/${order.id}/rating`, { score });
        done();
      }
    });
  const accept = (offer: Order) =>
    run(async () => {
      try {
        applyOrder(await api.post<Order>(`/orders/${offer.id}/accept`));
      } finally {
        setOffers((current) => current.filter((item) => item.id !== offer.id));
        await sync();
      }
    });
  const skip = (offer: Order) =>
    run(async () => {
      await api.post(`/orders/${offer.id}/skip`);
      setOffers((current) => current.filter((item) => item.id !== offer.id));
    });
  const navigate = (next: Page) => {
    setDrawer(false);
    setPage(next);
    setError("");
  };
  const offer = !order
    ? offers.find(
        (item) =>
          !item.searchExpiresAt ||
          new Date(item.searchExpiresAt).getTime() > clock,
      )
    : undefined;
  const displayed = order || offer;
  const quoteExpired = !!quote && new Date(quote.expiresAt).getTime() <= clock;

  if (booting || bootError)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: "white",
          justifyContent: "center",
          padding: 30,
          gap: 20,
          alignItems: "center",
        }}
      >
        <Logo large />
        {booting ? (
          <ActivityIndicator size="large" color={colors.blue} />
        ) : (
          <>
            <Text style={[s.muted, { textAlign: "center" }]}>{bootError}</Text>
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
  const pageTitles: Record<Page, string> = {
    home: "Taxi GO",
    profile: "Профиль",
    history: driver ? "История заказов" : "История поездок",
    balance: "Баланс",
    settings: "Настройки",
    support: "Поддержка",
    payment: "Способы оплаты",
  };
  return (
    <View style={{ flex: 1, backgroundColor: "#F4F8FD" }}>
      <View style={{ paddingTop: insets.top, backgroundColor: "white" }}>
        <View style={[s.spread, { paddingHorizontal: 17, paddingVertical: 8 }]}>
          <IconButton
            name={page === "home" ? "menu" : "arrow-back"}
            label={t(page === "home" ? "Меню" : "Назад")}
            onPress={() =>
              page === "home" ? setDrawer(true) : navigate("home")
            }
          />
          {page === "home" ? (
            <Logo />
          ) : (
            <Text style={[s.h2, { fontSize: 21 }]}>{t(pageTitles[page])}</Text>
          )}
          {driver && page === "home" ? (
            <Switch
              accessibilityLabel={t("На линии")}
              value={!!user.driverProfile?.online}
              onValueChange={online}
              disabled={busy || !user.driverProfile?.verified}
              trackColor={{ true: colors.blue }}
            />
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>
      </View>
      {(offline || !connected) && (
        <Pressable
          onPress={() => void sync()}
          style={{
            backgroundColor: offline ? "#FFF0E5" : "#EBF4FE",
            paddingVertical: 7,
            paddingHorizontal: 18,
          }}
        >
          <Text
            style={{
              color: offline ? "#A56424" : "#67809C",
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
      {!!error && (
        <Pressable
          onPress={() => setError("")}
          accessibilityRole="alert"
          style={[
            s.row,
            {
              margin: 12,
              padding: 12,
              backgroundColor: "#FFF0F0",
              borderRadius: 15,
            },
          ]}
        >
          <Icon name="alert-circle-outline" color={colors.danger} />
          <Text
            style={{
              flex: 1,
              color: colors.danger,
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            {t(error)}
          </Text>
          <Icon name="close" size={16} color={colors.danger} />
        </Pressable>
      )}
      {page === "home" ? (
        <View style={{ flex: 1 }}>
          <View
            style={{
              flex: 1,
              minHeight: 120,
              position: "relative",
              backgroundColor: "#E6F0F6",
            }}
          >
            <TaxiMap
              pickup={displayed?.pickup || pickup}
              dropoff={displayed?.dropoff || dropoff}
              geometry={
                (displayed?.routeProvider || quote?.routeProvider) === "yandex"
                  ? displayed?.geometry || quote?.geometry
                  : undefined
              }
              selectionMode={mapField}
              onSelectPoint={mapSelect}
              recenterKey={recenter}
            />
            {!driver && !mapField && (
              <View
                style={{ position: "absolute", left: 16, right: 16, top: 12 }}
              >
                <View
                  style={[
                    s.card,
                    {
                      padding: 14,
                      gap: 11,
                      shadowColor: "#28486A",
                      shadowOpacity: 0.06,
                      shadowRadius: 14,
                      shadowOffset: { width: 0, height: 5 },
                      elevation: 2,
                    },
                  ]}
                >
                  {(["pickup", "dropoff"] as const).map((field, index) => (
                    <Pressable
                      key={field}
                      accessibilityLabel={t(
                        field === "pickup" ? "Откуда" : "Куда",
                      )}
                      disabled={!!order || busy}
                      onPress={() => setAddressField(field)}
                      style={[
                        s.row,
                        index === 1 && {
                          borderTopWidth: 1,
                          borderTopColor: colors.line,
                          paddingTop: 10,
                        },
                      ]}
                    >
                      <Icon
                        name={
                          field === "pickup" ? "radio-button-on" : "location"
                        }
                        color={field === "pickup" ? colors.blue : colors.ink}
                        size={20}
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={s.caption}>
                          {t(field === "pickup" ? "Откуда" : "Куда")}
                        </Text>
                        <Text
                          style={[s.body, { fontWeight: "600", fontSize: 14 }]}
                          numberOfLines={1}
                        >
                          {displayed?.[field].address ||
                            (field === "pickup"
                              ? pickup?.address
                              : dropoff?.address) ||
                            t("Найти адрес")}
                        </Text>
                      </View>
                      {!order && (
                        <Icon
                          name="chevron-forward"
                          color={colors.muted}
                          size={17}
                        />
                      )}
                    </Pressable>
                  ))}
                </View>
              </View>
            )}
            {mapField && (
              <View
                style={{
                  position: "absolute",
                  top: 12,
                  left: 16,
                  right: 16,
                  backgroundColor: "white",
                  padding: 14,
                  borderRadius: 18,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <Icon name="location" color={colors.blue} />
                <Text style={[s.body, { flex: 1 }]}>
                  {t("Выберите точку на карте")}
                </Text>
                <IconButton
                  name="close"
                  label={t("Закрыть")}
                  onPress={() => setMapField(null)}
                />
              </View>
            )}
            <View style={{ position: "absolute", right: 17, bottom: 17 }}>
              <IconButton
                name="navigate"
                label={t("Моё местоположение")}
                onPress={locate}
              />
            </View>
          </View>
          {!mapField && (
            <Sheet
              handleLabel={t("Развернуть или свернуть панель")}
              key={order?.id || offer?.id || (driver ? "driver" : "booking")}
            >
              {order ? (
                <TripPanel
                  order={order}
                  user={user}
                  busy={busy}
                  onAction={action}
                  onChat={() => setChat(true)}
                  onDone={done}
                  onRating={rate}
                  coming={coming}
                />
              ) : driver ? (
                <>
                  {!user.driverProfile?.verified ? (
                    <Empty
                      icon="shield-checkmark-outline"
                      title={t("Ожидаем подтверждение")}
                      subtitle={t(
                        "Диспетчер проверит профиль и автомобиль. После подтверждения здесь появятся заказы.",
                      )}
                    />
                  ) : offer ? (
                    <>
                      <View style={s.spread}>
                        <Text style={s.h2}>{t("Новый заказ")}</Text>
                        <View
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            backgroundColor: "#E2F8EC",
                            borderRadius: 15,
                          }}
                        >
                          <Text
                            style={{
                              color: colors.green,
                              fontWeight: "600",
                              fontSize: 12,
                            }}
                          >
                            {t("На линии")}
                          </Text>
                        </View>
                      </View>
                      <Route order={offer} t={t} />
                      <View
                        style={[
                          s.spread,
                          {
                            borderTopWidth: 1,
                            borderBottomWidth: 1,
                            borderColor: colors.line,
                            paddingVertical: 17,
                          },
                        ]}
                      >
                        <View>
                          <Text style={s.h3}>{km(offer.distanceMeters)}</Text>
                          <Text style={s.caption}>{t("Расстояние")}</Text>
                        </View>
                        <View>
                          <Text style={s.h3}>
                            ≈ {mins(offer.durationSeconds, user.language)}
                          </Text>
                          <Text style={s.caption}>{t("В пути")}</Text>
                        </View>
                        <View>
                          <Text style={[s.h2, { color: colors.blue }]}>
                            {money(offer.price)}
                          </Text>
                          <Text style={s.caption}>{t("Наличные")}</Text>
                        </View>
                      </View>
                      {!!offer.comment && (
                        <View style={s.row}>
                          <Icon name="chatbox-outline" />
                          <Text style={[s.body, { flex: 1 }]}>
                            {offer.comment}
                          </Text>
                        </View>
                      )}
                      <Button
                        label={t("Принять")}
                        onPress={() => accept(offer)}
                        busy={busy}
                      />
                      <Button
                        secondary
                        label={t("Пропустить")}
                        onPress={() => skip(offer)}
                        busy={busy}
                      />
                    </>
                  ) : (
                    <>
                      <Empty
                        icon={
                          user.driverProfile.online
                            ? "radio-outline"
                            : "car-outline"
                        }
                        title={t(
                          user.driverProfile.online
                            ? "Новых заказов пока нет"
                            : "Вы не на линии",
                        )}
                        subtitle={t(
                          user.driverProfile.online
                            ? "Предложения появятся, когда рядом будет пассажир."
                            : "Включите режим на линии, чтобы получать доступные заказы.",
                        )}
                      />
                      {!user.driverProfile.online && (
                        <Button
                          label={t("Выйти на линию")}
                          onPress={() => online(true)}
                          busy={busy}
                        />
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  <View style={s.spread}>
                    <Text style={s.h3}>{t("Тариф")}</Text>
                    {quote && !quoteExpired && (
                      <Text style={s.caption}>
                        {km(quote.distanceMeters)} · ≈{" "}
                        {mins(quote.durationSeconds, user.language)}
                      </Text>
                    )}
                  </View>
                  {tariffs.length ? (
                    tariffs.map((tariff, index) => (
                      <Pressable
                        key={tariff.id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: tariffId === tariff.id }}
                        disabled={busy}
                        onPress={() => setTariffId(tariff.id)}
                        style={[
                          s.row,
                          {
                            padding: 12,
                            borderRadius: 19,
                            borderWidth: 1.5,
                            borderColor:
                              tariffId === tariff.id ? "#5AA7FF" : colors.line,
                            backgroundColor:
                              tariffId === tariff.id ? "#F0F7FF" : "white",
                            minHeight: 74,
                          },
                        ]}
                      >
                        <Car
                          color={
                            index === 0
                              ? "#E5ECF4"
                              : index === 1
                                ? "#67788D"
                                : "#253447"
                          }
                          size={67}
                        />
                        <View style={{ flex: 1, gap: 3 }}>
                          <Text style={s.h3}>{tariff.name}</Text>
                          <Text style={s.caption} numberOfLines={1}>
                            {tariff.description || t("Комфортные поездки")}
                          </Text>
                        </View>
                        <View style={{ alignItems: "flex-end", gap: 3 }}>
                          <Text
                            style={[
                              s.h3,
                              {
                                color:
                                  tariffId === tariff.id
                                    ? colors.blue
                                    : colors.ink,
                              },
                            ]}
                          >
                            {tariffId === tariff.id && quote && !quoteExpired
                              ? money(quote.price)
                              : `${t("от")} ${money(tariff.minimumPrice)}`}
                          </Text>
                          <Text style={s.caption}>
                            {t(
                              tariffId === tariff.id && quote && !quoteExpired
                                ? "за поездку"
                                : "минимум",
                            )}
                          </Text>
                        </View>
                      </Pressable>
                    ))
                  ) : (
                    <View style={{ gap: 10 }}>
                      <Text style={s.muted}>{t("Тарифы пока недоступны")}</Text>
                      <Button
                        secondary
                        label={t("Обновить")}
                        onPress={() =>
                          void run(async () => {
                            const list =
                              await api.request<Tariff[]>("/tariffs");
                            setTariffs(list);
                            setTariffId(list[0]?.id || "");
                          })
                        }
                      />
                    </View>
                  )}
                  <Pressable
                    onPress={() => navigate("payment")}
                    style={[s.spread, { paddingVertical: 5 }]}
                  >
                    <View style={s.row}>
                      <View
                        style={{
                          backgroundColor: "#E7F7E9",
                          padding: 10,
                          borderRadius: 12,
                        }}
                      >
                        <Icon name="cash" color={colors.green} />
                      </View>
                      <View>
                        <Text style={s.h3}>{t("Наличные")}</Text>
                        <Text style={s.caption}>{t("Оплата водителю")}</Text>
                      </View>
                    </View>
                    <Icon
                      name="chevron-forward"
                      color={colors.muted}
                      size={18}
                    />
                  </Pressable>
                  <TextInput
                    placeholder={t("Комментарий водителю")}
                    accessibilityLabel={t("Комментарий водителю")}
                    value={comment}
                    onChangeText={setComment}
                    maxLength={500}
                    style={[
                      s.input,
                      { minHeight: 47, paddingVertical: 12, fontSize: 14 },
                    ]}
                    multiline
                  />
                  {!pickup || !dropoff ? (
                    <Button
                      label={t("Выберите маршрут")}
                      onPress={() =>
                        setAddressField(!pickup ? "pickup" : "dropoff")
                      }
                    />
                  ) : quote && !quoteExpired ? (
                    <Button
                      label={`${t("Заказать")} · ${money(quote.price)}`}
                      onPress={book}
                      busy={busy}
                    />
                  ) : (
                    <Button
                      label={t(
                        quoteExpired ? "Новый расчёт" : "Рассчитать стоимость",
                      )}
                      onPress={calculate}
                      disabled={!tariffId}
                      busy={busy}
                    />
                  )}
                  {quote?.development && (
                    <Text style={s.caption}>
                      {t(
                        "Development: тестовый маршрут. Проверьте боевой ключ маршрутизации перед реальными поездками.",
                      )}
                    </Text>
                  )}
                </>
              )}
            </Sheet>
          )}
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
          busy={busy}
        />
      )}
      {driver ? (
        <View
          style={{
            backgroundColor: "white",
            paddingBottom: Math.max(insets.bottom, 10),
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: colors.line,
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
                color={page === item.page ? colors.blue : "#95A5BD"}
                size={23}
              />
              <Text
                style={{
                  color: page === item.page ? colors.blue : "#95A5BD",
                  fontSize: 11,
                  fontWeight: "600",
                }}
              >
                {t(item.title)}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={{ height: insets.bottom, backgroundColor: "white" }} />
      )}
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
            backgroundColor: "#101C385F",
          }}
        >
          <SafeAreaView
            style={{
              width: "82%",
              maxWidth: 370,
              backgroundColor: "white",
              borderTopRightRadius: 28,
              borderBottomRightRadius: 28,
            }}
          >
            <ScrollView contentContainerStyle={{ padding: 24, flexGrow: 1 }}>
              <Logo />
              <Pressable
                onPress={() => navigate("profile")}
                style={[s.row, { paddingVertical: 29 }]}
              >
                <Avatar user={user} size={57} />
                <View style={{ flex: 1 }}>
                  <Text style={s.h3}>{user.name || t("Профиль")}</Text>
                  <Text style={s.caption}>{user.phone}</Text>
                </View>
                <Icon name="chevron-forward" color={colors.muted} size={18} />
              </Pressable>
              <View style={s.divider} />
              <MenuRow
                icon="person-outline"
                label={t("Профиль")}
                onPress={() => navigate("profile")}
              />
              <MenuRow
                icon="time-outline"
                label={t("История поездок")}
                onPress={() => navigate("history")}
              />
              {driver ? (
                <MenuRow
                  icon="wallet-outline"
                  label={t("Баланс")}
                  onPress={() => navigate("balance")}
                />
              ) : (
                <MenuRow
                  icon="card-outline"
                  label={t("Способы оплаты")}
                  onPress={() => navigate("payment")}
                />
              )}
              <MenuRow
                icon="settings-outline"
                label={t("Настройки")}
                onPress={() => navigate("settings")}
              />
              <MenuRow
                icon="headset-outline"
                label={t("Поддержка")}
                onPress={() => navigate("support")}
              />
              <View style={s.divider} />
              <MenuRow
                icon="log-out-outline"
                label={t("Выйти")}
                onPress={logout}
              />
              <View style={{ flex: 1, minHeight: 20 }} />
              <CityArt />
              <Text style={[s.caption, { paddingTop: 16 }]}>
                {t("Комфортные поездки")}
                {"\n"}
                {t("каждый день")}
              </Text>
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
          center={pickup}
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
