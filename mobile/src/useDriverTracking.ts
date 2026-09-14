import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import type { Coordinate, DriverLocation, Order, Point } from './types';
import { distanceBetween, DrivingRoute } from './navigation';

export type DriverLocationEvent = { orderId: string; driverId: string | null; status: string; location: DriverLocation | null };
export function validTrackingEvent(event: DriverLocationEvent, order: Order | null, now = Date.now()) {
  const p = event.location;
  return !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status) && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(event.status) && event.orderId === order.id && event.driverId === order.driver?.id
    && !!p && p.driverId === order.driver.id && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90
    && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 && Number.isFinite(p.timestamp)
    && Number.isFinite(p.accuracy) && p.accuracy >= 0 && p.accuracy <= 100
    && p.timestamp >= 0 && p.timestamp <= now + 5000
    && (!p.tripId || p.tripId === order.id)
    && (p.sequence == null || (Number.isInteger(p.sequence) && p.sequence > 0));
}
export function newerTrackingLocation(previous: DriverLocation | null, next: DriverLocation): boolean {
  if (!previous || previous.driverId !== next.driverId) return true;
  const oldAt = previous.measuredAt ?? previous.timestamp, nextAt = next.measuredAt ?? next.timestamp;
  if (nextAt <= oldAt) return false;
  if (next.trackingSessionId && next.trackingSessionId === previous.trackingSessionId
    && next.sequence != null && previous.sequence != null && next.sequence <= previous.sequence) return false;
  return true;
}
export function trackingAgeStatus(position: DriverLocation | null, now = Date.now()) {
  if (!position) return { ageSeconds: null, delayed: false, unavailable: true, message: 'Актуальное местоположение недоступно' };
  const ageSeconds = Math.max(0, Math.floor((now - (position.measuredAt ?? position.timestamp)) / 1000));
  if (ageSeconds > 15) return { ageSeconds, delayed: true, unavailable: true, message: 'Актуальное местоположение недоступно' };
  if (ageSeconds > 5) return { ageSeconds, delayed: true, unavailable: false, message: `Местоположение обновляется с задержкой · ${ageSeconds} с` };
  return { ageSeconds, delayed: false, unavailable: false, message: '' };
}
export function useClientDriverTracking(order: Order | null, enabled: boolean) {
  const [position, setPosition] = useState<DriverLocation | null>(null);
  const [now, setNow] = useState(Date.now());
  const revoked = useRef('');
  const positionScope = useRef('');
  const latest = useRef({ order, enabled }); latest.current = { order, enabled };
  const scope = enabled && order?.driver && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status) ? `${order.id}:${order.driver.id}` : '';
  const receive = useCallback((event: DriverLocationEvent) => {
    const current = latest.current.order;
    const key = current ? `${current.id}:${current.driver?.id}` : '';
    if (event.orderId === current?.id && !['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(event.status)) { revoked.current = key; setPosition(null); return; }
    if (revoked.current === key) return;
    if (!latest.current.enabled || !validTrackingEvent(event, latest.current.order)) return;
    positionScope.current = key;
    setPosition(old => newerTrackingLocation(old, event.location!) ? event.location : old);
  }, []);
  useEffect(() => {
    setPosition(null); revoked.current = ''; positionScope.current = '';
    if (!scope || !order) return;
    if (order.driverLocation) receive({ orderId: order.id, driverId: order.driver?.id || null, status: order.status, location: order.driverLocation });
    let live = true, pending = false;
    const controller = new AbortController();
    const poll = async () => {
      setNow(Date.now());
      if (!live || pending || AppState.currentState !== 'active') return;
      pending = true;
      try { const result = await api.request<DriverLocationEvent>(`/orders/${order.id}/driver-location`, { signal: controller.signal }); if (live) receive(result); }
      catch { /* Keep the last fix briefly; then show that the signal is unavailable. */ }
      finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void poll(); });
    return () => { live = false; controller.abort(); clearInterval(timer); clearInterval(clock); subscription.remove(); };
  }, [scope, receive]);
  const scoped = scope && scope === positionScope.current && position && position.driverId === order?.driver?.id ? position : null;
  const age = trackingAgeStatus(scoped || null, now);
  return { position: scoped || null, receive, waiting: !!scope && age.unavailable, delayed: !!scope && age.delayed,
    ageSeconds: age.ageSeconds, statusMessage: scope ? age.message : '' };
}

/** Preview the road to pickup before accepting; refresh a moving car's approach sparingly. */
export function useApproachRoute(position: Coordinate | null | undefined, destination: Point | null | undefined, scope: string) {
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef({ position, destination }); latest.current = { position, destination };
  const [tick, setTick] = useState(0);
  const last = useRef<{ point: Coordinate; at: number } | null>(null);
  const version = useRef(0), pending = useRef<AbortController | null>(null);
  useEffect(() => { version.current++; pending.current?.abort(); pending.current = null; last.current = null; setRoute(null); setError(''); setLoading(false); }, [scope]);
  useEffect(() => { if (!scope) return; const timer = setInterval(() => setTick(value => value + 1), 15000); return () => clearInterval(timer); }, [scope]);
  useEffect(() => {
    const { position: point, destination: target } = latest.current;
    if (!scope || !point || !target || pending.current) return;
    if (last.current && (Date.now() - last.current.at < 15000 || distanceBetween(last.current.point, point) < 40)) return;
    const controller = new AbortController(), current = ++version.current; pending.current = controller;
    last.current = { point, at: Date.now() }; setLoading(true); setError('');
    void api.request<DrivingRoute>('/routes', { method: 'POST', signal: controller.signal, body: JSON.stringify({ pickup: { latitude: point.latitude, longitude: point.longitude, address: 'Положение водителя' }, dropoff: target }) })
      .then(value => { if (current === version.current) setRoute(value); })
      .catch(() => { if (current === version.current && !controller.signal.aborted) { last.current = null; setError('Не удалось построить путь до пассажира'); } })
      .finally(() => { if (current === version.current) { pending.current = null; setLoading(false); } });
  }, [scope, !!position, tick]);
  useEffect(() => () => { version.current++; pending.current?.abort(); }, []);
  return { route: scope ? route : null, loading, error };
}
