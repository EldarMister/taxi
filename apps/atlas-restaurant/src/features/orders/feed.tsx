import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Vibration } from 'react-native';
import { api } from '../../data/api';
import { can, type DispatchInput, type Membership, type MerchantOrder, type OrderAction } from '../../domain/types';
import { OrderCommandCoordinator } from './commands';
import { OrderTracker } from './model';

export type OrdersFeed = {
  orders: MerchantOrder[]; loading: boolean; refreshing: boolean; error: string; lastUpdated: number | null;
  newOrderIds: string[]; acknowledge: () => void; refresh: () => Promise<MerchantOrder[]>;
  action: (id: string, action: OrderAction, reason?: string) => Promise<void>;
  dispatch: (id: string, input: DispatchInput) => Promise<void>;
};
const Context = createContext<OrdersFeed | null>(null);

/** Foreground transport. Future push adapters should invalidate refresh(), never invent local statuses. */
export function OrdersProvider({ restaurantId, membership, children, onChanged }: {
  restaurantId: string; membership: Membership; children: React.ReactNode; onChanged?: () => void;
}) {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [newOrderIds, setNewOrderIds] = useState<string[]>([]);
  const scope = useMemo(() => ({ tracker: new OrderTracker(restaurantId), active: true, flight: null as Promise<MerchantOrder[]> | null }), [restaurantId]);
  const readable = membership.restaurantId === restaurantId && can(membership, 'orders.read');
  const manage = membership.restaurantId === restaurantId && can(membership, 'orders.manage');
  const current = useRef({ readable, manage, onChanged });
  current.current = { readable, manage, onChanged };

  const refresh = useCallback((): Promise<MerchantOrder[]> => {
    if (!current.current.readable) return Promise.resolve([]);
    if (scope.flight) return scope.flight;
    setRefreshing(true);
    const task = api.request<{ orders: MerchantOrder[] }>(`/${encodeURIComponent(restaurantId)}/orders`).then(result => {
      if (!scope.active || !current.current.readable) return [];
      const snapshot = scope.tracker.receive(result.orders);
      setOrders(snapshot.orders); setError(''); setLastUpdated(Date.now());
      if (snapshot.unseen.length) {
        setNewOrderIds(previous => [...new Set([...previous, ...snapshot.unseen])].filter(id => snapshot.orders.some(order => order.id === id && !['COMPLETED', 'CANCELLED'].includes(order.status))));
        if (!snapshot.initial && AppState.currentState === 'active') Vibration.vibrate([0, 120, 90, 120]);
      } else setNewOrderIds(previous => previous.filter(id => snapshot.orders.some(order => order.id === id && !['COMPLETED', 'CANCELLED'].includes(order.status))));
      return snapshot.orders;
    }).catch((failure: unknown) => {
      if (scope.active) {
        setError(failure instanceof Error ? failure.message : 'Нет соединения. Попробуем обновить заказы автоматически.');
        if ([401, 403].includes((failure as { status?: number })?.status || 0)) { setOrders([]); setNewOrderIds([]); }
      }
      throw failure;
    }).finally(() => {
      scope.flight = null;
      if (scope.active) { setLoading(false); setRefreshing(false); }
    });
    scope.flight = task;
    return task;
  }, [restaurantId, scope]);

  useEffect(() => {
    scope.active = true;
    setOrders([]); setNewOrderIds([]); setLastUpdated(null); setError(''); setLoading(readable);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const poll = async () => {
      if (!scope.active || !readable) return;
      if (AppState.currentState === 'active' || AppState.currentState === null) {
        try { await refresh(); failures = 0; } catch { failures++; }
      }
      if (scope.active) timer = setTimeout(poll, Math.min(30000, 10000 * (failures + 1)));
    };
    void poll();
    const appState = AppState.addEventListener('change', value => { if (value === 'active' && readable) void refresh().catch(() => undefined); });
    // The web build also resumes immediately when its network connection returns.
    const browser = typeof window !== 'undefined' ? window : null;
    const online = () => { if (readable) void refresh().catch(() => undefined); };
    browser?.addEventListener?.('online', online);
    return () => { scope.active = false; if (timer) clearTimeout(timer); appState.remove(); browser?.removeEventListener?.('online', online); };
  }, [scope, readable, refresh]);

  const coordinator = useMemo(() => new OrderCommandCoordinator(restaurantId, {
    load: refresh,
    send: (id, command) => {
      if (!current.current.manage) throw new Error('У вас нет права изменять заказы этого ресторана.');
      const path = `/${encodeURIComponent(restaurantId)}/orders/${encodeURIComponent(id)}`;
      return command.kind === 'action' ? api.request(path, 'PATCH', { action: command.action, ...(command.reason ? { reason: command.reason } : {}) })
        : api.request(`${path}/dispatch`, 'POST', command.input);
    },
  }), [restaurantId, refresh]);

  const value: OrdersFeed = {
    orders: readable ? orders : [], loading, refreshing, error, lastUpdated, newOrderIds: readable ? newOrderIds : [],
    acknowledge: () => setNewOrderIds([]), refresh,
    action: async (id, action, reason) => { await coordinator.execute(id, { kind: 'action', action, reason }); current.current.onChanged?.(); },
    dispatch: async (id, input) => { await coordinator.execute(id, { kind: 'dispatch', input }); current.current.onChanged?.(); },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOrdersFeed(): OrdersFeed {
  const context = useContext(Context);
  if (!context) throw new Error('OrdersScreen must be inside OrdersProvider.');
  return context;
}
