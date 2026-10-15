import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { api } from '../data/api';
import {
  can,
  type Membership,
  type Profile,
  type RestaurantDetail,
  type Session,
} from '../domain/types';
import {
  Button,
  Card,
  Empty,
  ErrorNotice,
  Photo,
  Row,
  Sheet,
  Skeleton,
  Text,
  tokens,
} from '../ui';
import { AtlasLogo } from '../ui/AtlasLogo';
import { LoginScreen } from './LoginScreen';
import {
  Dashboard,
  AnalyticsScreen,
  type Destination,
} from '../features/management/Insights';
import {
  PromotionsScreen,
  RestaurantScreen,
} from '../features/management/Management';
import { MenuScreen } from '../features/menu/MenuScreen';
import { OrdersProvider, useOrdersFeed } from '../features/orders/feed';
import { OrdersScreen } from '../features/orders/OrdersScreen';

export function RestaurantApp({ ready }: { ready: boolean }) {
  const [session, setSession] = useState<Session | null>(null),
    [restoring, setRestoring] = useState(true),
    [error, setError] = useState('');
  const restore = useCallback(async () => {
    setRestoring(true);
    setError('');
    try {
      setSession(await api.restore());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setRestoring(false);
    }
  }, []);
  useEffect(() => api.subscribe((next) => setSession(next)), []);
  useEffect(() => {
    void restore();
  }, [restore]);
  const logout = () => {
    void api.logout().catch(() => undefined);
    setSession(null);
    setError('');
  };
  if (!ready || restoring)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: tokens.canvas,
          justifyContent: 'center',
          padding: 28,
        }}
      >
        <View style={{ marginBottom: 24 }}>
          <AtlasLogo />
        </View>
        <Skeleton />
      </SafeAreaView>
    );
  if (error && !session)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: tokens.canvas,
          padding: 24,
          justifyContent: 'center',
          gap: 18,
        }}
      >
        <Empty
          icon="cloud-offline-outline"
          title="Не удалось восстановить сессию"
          body="Проверьте соединение. Ваш вход сохранён на устройстве."
        />
        <ErrorNotice error={error} />
        <Button title="Попробовать снова" onPress={() => void restore()} />
        <Button secondary title="Войти в другой аккаунт" onPress={logout} />
      </SafeAreaView>
    );
  return session ? (
    <AccountWorkspace key={session.user.id} profile={session} logout={logout} />
  ) : (
    <LoginScreen onLogin={setSession} />
  );
}
function AccountWorkspace({
  profile,
  logout,
}: {
  profile: Profile;
  logout: () => void;
}) {
  const [selected, setSelected] = useState(
    profile.memberships[0]?.restaurantId || '',
  );
  const membership =
    profile.memberships.find((m) => m.restaurantId === selected) ||
    profile.memberships[0];
  if (!membership)
    return (
      <SafeAreaView
        style={{
          flex: 1,
          padding: 24,
          backgroundColor: tokens.canvas,
          justifyContent: 'center',
          gap: 20,
        }}
      >
        <Empty
          title="Пока нет доступа к ресторану"
          body="Обратитесь к владельцу или команде Atlas, чтобы подключить ресторан."
        />
        <Button secondary title="Выйти" onPress={logout} />
      </SafeAreaView>
    );
  return (
    <OrdersProvider
      key={`${profile.user.id}:${membership.restaurantId}`}
      restaurantId={membership.restaurantId}
      membership={membership}
    >
      <Workspace
        profile={profile}
        membership={membership}
        select={setSelected}
        logout={logout}
      />
    </OrdersProvider>
  );
}
const destinations: {
  id: Destination;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission?: Parameters<typeof can>[1];
}[] = [
  { id: 'home', label: 'Главная', icon: 'grid-outline' },
  {
    id: 'orders',
    label: 'Заказы',
    icon: 'receipt-outline',
    permission: 'orders.read',
  },
  {
    id: 'menu',
    label: 'Меню',
    icon: 'restaurant-outline',
    permission: 'menu.manage',
  },
  {
    id: 'promotions',
    label: 'Акции',
    icon: 'pricetag-outline',
    permission: 'promotions.manage',
  },
  {
    id: 'stats',
    label: 'Цифры',
    icon: 'bar-chart-outline',
    permission: 'stats.read',
  },
  { id: 'restaurant', label: 'Ресторан', icon: 'storefront-outline' },
];
function Workspace({
  profile,
  membership,
  select,
  logout,
}: {
  profile: Profile;
  membership: Membership;
  select: (id: string) => void;
  logout: () => void;
}) {
  const id = membership.restaurantId;
  const [detail, setDetail] = useState<RestaurantDetail | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [tab, setTab] = useState<Destination>('home'),
    [create, setCreate] = useState(false),
    [chooser, setChooser] = useState(false),
    [saved, setSaved] = useState(false);
  const sequence = useRef(0),
    scope = useRef(true);
  const feed = useOrdersFeed();
  const reload = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const result = await api.request<RestaurantDetail>(`/${id}`);
      if (scope.current && request === sequence.current) {
        setDetail(result);
        setError('');
      }
    } catch (cause) {
      if (scope.current && request === sequence.current) {
        setError((cause as Error).message);
        if ([401, 403].includes((cause as { status: number }).status))
          setDetail(null);
      }
    } finally {
      if (scope.current && request === sequence.current) setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    scope.current = true;
    void reload();
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void reload();
        void api.me().catch(() => undefined);
      }
    });
    const timer = setInterval(() => {
      if (
        AppState.currentState === 'active' ||
        AppState.currentState === null
      ) {
        void reload();
        void api.me().catch(() => undefined);
      }
    }, 30000);
    return () => {
      scope.current = false;
      sequence.current++;
      app.remove();
      clearInterval(timer);
    };
  }, [reload]);
  const navigate = (next: Destination, add = false) => {
    setCreate(add);
    setTab(next);
    if (next === 'orders') feed.acknowledge();
  };
  useEffect(() => {
    const allowed = destinations.find((d) => d.id === tab)?.permission;
    if (allowed && !can(membership, allowed)) setTab('home');
  }, [membership, tab]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [tab]);
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 2400);
    return () => clearTimeout(timer);
  }, [saved]);
  const onChanged = () => {
    setRevision((n) => n + 1);
    setSaved(true);
    void reload();
  };
  const visible = destinations.filter(
    (d) => !d.permission || can(membership, d.permission),
  );
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: tokens.canvas }}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <Row
        style={{
          paddingHorizontal: 20,
          paddingVertical: 12,
          backgroundColor: tokens.canvas,
        }}
      >
        <View style={{ flex: 1 }}>
          <AtlasLogo width={118} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Выбрать ресторан"
          onPress={() => setChooser(true)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            maxWidth: '55%',
            minHeight: 44,
          }}
        >
          <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
            {detail?.catalog.name || membership.restaurantName}
          </Text>
          <Ionicons name="chevron-down" size={15} />
        </Pressable>
      </Row>
      {feed.newOrderIds.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Открыть новые заказы"
          onPress={() => navigate('orders')}
          style={{
            marginHorizontal: 20,
            marginBottom: 10,
            borderRadius: 16,
            padding: 13,
            backgroundColor: tokens.blue,
          }}
        >
          <Row>
            <Ionicons name="notifications-outline" size={20} color="white" />
            <Text variant="label" style={{ color: 'white', flex: 1 }}>
              Ждут внимания: {feed.newOrderIds.length}
            </Text>
            <Ionicons name="arrow-forward" color="white" size={18} />
          </Row>
        </Pressable>
      )}
      {saved && (
        <View
          accessibilityLiveRegion="polite"
          style={{
            backgroundColor: tokens.greenSoft,
            padding: 10,
            marginHorizontal: 20,
            borderRadius: 14,
            marginBottom: 8,
          }}
        >
          <Text
            variant="label"
            style={{ color: tokens.green, textAlign: 'center' }}
          >
            Изменения сохранены
          </Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        {loading ? (
          <View style={{ padding: 20 }}>
            <Skeleton />
          </View>
        ) : !detail ? (
          <View style={{ padding: 20, gap: 20 }}>
            <ErrorNotice error={error} retry={() => void reload()} />
            <Button secondary title="Выйти" onPress={logout} />
          </View>
        ) : (
          <>
            {!!error && (
              <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
                <ErrorNotice error={error} retry={() => void reload()} />
              </View>
            )}
            {tab === 'home' && (
              <Dashboard
                {...{ detail, membership, onChanged, navigate, revision }}
              />
            )}
            {tab === 'orders' && can(membership, 'orders.read') && (
              <OrdersScreen
                restaurantId={id}
                membership={membership}
                onChanged={onChanged}
              />
            )}{' '}
            {tab === 'menu' && can(membership, 'menu.manage') && (
              <MenuScreen
                restaurantId={id}
                {...{ detail, membership, onChanged }}
                initialCreate={create}
              />
            )}{' '}
            {tab === 'promotions' && can(membership, 'promotions.manage') && (
              <PromotionsScreen
                {...{ detail, membership, onChanged }}
                initialCreate={create}
              />
            )}{' '}
            {tab === 'stats' && can(membership, 'stats.read') && (
              <AnalyticsScreen restaurantId={id} revision={revision} />
            )}{' '}
            {tab === 'restaurant' && (
              <RestaurantScreen
                {...{ detail, membership, onChanged, profile, logout }}
              />
            )}
          </>
        )}
      </View>
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: tokens.line,
          backgroundColor: 'white',
          paddingTop: 8,
          paddingBottom: 4,
        }}
      >
        <Row
          style={{
            gap: 0,
            justifyContent: 'space-around',
            maxWidth: 900,
            alignSelf: 'center',
            width: '100%',
          }}
        >
          {visible.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === item.id }}
              accessibilityLabel={item.label}
              onPress={() => navigate(item.id)}
              style={{
                flex: 1,
                minHeight: 54,
                alignItems: 'center',
                gap: 5,
                paddingVertical: 5,
              }}
            >
              <Ionicons
                name={item.icon}
                size={23}
                color={tab === item.id ? tokens.blue : tokens.muted}
              />
              <Text
                variant="caption"
                style={{
                  fontSize: 10,
                  color: tab === item.id ? tokens.blue : tokens.muted,
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Row>
      </View>
      {chooser && (
        <Sheet title="Ваши рестораны" onClose={() => setChooser(false)}>
          {profile.memberships.map((m) => (
            <Pressable
              key={m.restaurantId}
              accessibilityRole="button"
              onPress={() => {
                setChooser(false);
                select(m.restaurantId);
              }}
            >
              <Card
                style={{
                  backgroundColor:
                    m.restaurantId === id ? tokens.blueSoft : tokens.canvas,
                }}
              >
                <Row>
                  <Ionicons
                    name="storefront-outline"
                    size={24}
                    color={tokens.blue}
                  />
                  <View style={{ flex: 1 }}>
                    <Text variant="heading">{m.restaurantName}</Text>
                    <Text variant="caption">
                      {m.role === 'OWNER' ? 'Владелец' : 'Менеджер'}
                    </Text>
                  </View>
                  {m.restaurantId === id && (
                    <Ionicons
                      name="checkmark-circle"
                      size={24}
                      color={tokens.blue}
                    />
                  )}
                </Row>
              </Card>
            </Pressable>
          ))}
        </Sheet>
      )}
    </SafeAreaView>
  );
}
