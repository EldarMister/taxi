import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import type { Coordinate, DriverLocation, Order, Point } from './types';
import { distanceBetween, DrivingRoute } from './navigation';

export type DriverLocationEvent = { orderId: string; assignmentId?: string | null; driverId: string | null; status: string;
  stateVersion?: number; serverTimeMs?: number; location: DriverLocation | null };
const measuredAt = (point: DriverLocation) => point.schemaVersion === 1
  ? point.measuredAtMs ?? NaN : point.measuredAtMs ?? point.measuredAt ?? point.timestamp;
const accuracy = (point: DriverLocation) => point.accuracyM !== undefined ? point.accuracyM : point.accuracy;
const trackingStartedAt = (point: DriverLocation) => point.trackingStartedAtMs ?? point.trackingStartedAt;
const monotonicNow = () => typeof performance === 'undefined' ? Date.now() : performance.now();
type ReceivedDriverLocation = DriverLocation & { playbackAgeAtReceiptMs: number; playbackReceivedAtMs: number; playbackPositionValidated: true };
type ReceivedFix = { position: ReceivedDriverLocation; receivedLocallyAt: number; serverTimeAtReceipt: number };
export function validTrackingEvent(event: DriverLocationEvent, order: Order | null, now = Date.now()) {
  const p = event.location;
  return !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status) && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(event.status) && event.orderId === order.id && event.driverId === order.driver?.id
    && (!order.assignmentId || event.assignmentId === order.assignmentId)
    && !!p && p.driverId === order.driver.id && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90
    && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180 && Number.isFinite(measuredAt(p))
    && (accuracy(p) == null || (Number.isFinite(accuracy(p)) && accuracy(p)! >= 0 && accuracy(p)! <= 100))
    && measuredAt(p) >= 0 && measuredAt(p) <= (event.serverTimeMs ?? now) + 5000
    && (!p.tripId || p.tripId === order.id) && (!p.orderId || p.orderId === order.id)
    && (!order.assignmentId || p.assignmentId === order.assignmentId)
    && (p.schemaVersion === undefined || p.schemaVersion === 1)
    && (p.sequence == null || (Number.isInteger(p.sequence) && p.sequence > 0))
    && (p.trackingSessionId === undefined || typeof p.trackingSessionId === 'string'
      && p.trackingSessionId.length > 0 && p.trackingSessionId.length <= 128)
    && (p.trackingStartedAtMs === undefined || Number.isFinite(p.trackingStartedAtMs)
      && p.trackingStartedAtMs >= 0 && p.trackingStartedAtMs <= measuredAt(p) + 5000)
    && (p.trackingStartedAt === undefined || Number.isFinite(p.trackingStartedAt)
      && p.trackingStartedAt >= 0 && p.trackingStartedAt <= measuredAt(p) + 5000)
    && (p.speedMps == null || Number.isFinite(p.speedMps) && p.speedMps >= 0 && p.speedMps <= 100)
    && (p.courseDeg == null || Number.isFinite(p.courseDeg) && p.courseDeg >= 0 && p.courseDeg < 360)
    && (p.courseAccuracyDeg == null || Number.isFinite(p.courseAccuracyDeg) && p.courseAccuracyDeg >= 0 && p.courseAccuracyDeg <= 180)
    && (p.courseSource == null || p.courseSource === 'gps' || p.courseSource === 'displacement')
    && (p.stateVersion == null || Number.isInteger(p.stateVersion) && p.stateVersion >= 0)
    && (event.stateVersion == null || Number.isInteger(event.stateVersion) && event.stateVersion >= 0)
    && (event.serverTimeMs == null || Number.isFinite(event.serverTimeMs));
}
export function newerTrackingLocation(previous: DriverLocation | null, next: DriverLocation, checkDistance = true): boolean {
  if (!previous || previous.driverId !== next.driverId) return true;
  if (previous.assignmentId && next.assignmentId && previous.assignmentId !== next.assignmentId) return true;
  if (next.stateVersion != null && previous.stateVersion != null && next.stateVersion <= previous.stateVersion) return false;
  const oldAt = measuredAt(previous), nextAt = measuredAt(next);
  if (nextAt <= oldAt) return false;
  if (next.trackingSessionId && next.trackingSessionId === previous.trackingSessionId
    && next.sequence != null && previous.sequence != null && next.sequence <= previous.sequence) return false;
  if (next.trackingSessionId && previous.trackingSessionId && next.trackingSessionId !== previous.trackingSessionId
    && trackingStartedAt(next) != null && trackingStartedAt(previous) != null
    && trackingStartedAt(next)! <= trackingStartedAt(previous)!) return false;
  const elapsed = (nextAt - oldAt) / 1000;
  // Stationary packets are real fresh measurements too. Accepting them keeps
  // the age indicator current even when the filtered coordinate is unchanged.
  if (checkDistance && elapsed <= 30) {
    const north = (next.latitude - previous.latitude) * 111195;
    const east = (next.longitude - previous.longitude) * 111195 * Math.cos(next.latitude * Math.PI / 180);
    const allowed = 35 + Math.max(0, elapsed) * 55 + Math.min(60, (accuracy(previous) ?? 0) + (accuracy(next) ?? 0));
    if (Math.hypot(north, east) > allowed) return false;
  }
  return true;
}
export function trackingAgeStatus(position: DriverLocation | null, now = Date.now(), receivedLocallyAt?: number, serverTimeAtReceipt?: number) {
  if (!position) return { ageSeconds: null, delayed: false, unavailable: true, message: 'Актуальное местоположение недоступно' };
  // Server time anchors age across devices with different clock settings.
  const elapsed = receivedLocallyAt != null && serverTimeAtReceipt != null && Number.isFinite(serverTimeAtReceipt)
    ? Math.max(0, serverTimeAtReceipt - measuredAt(position)) + Math.max(0, now - receivedLocallyAt)
    : Math.max(0, now - measuredAt(position));
  const ageSeconds = Math.floor(elapsed / 1000);
  if (ageSeconds > 15) return { ageSeconds, delayed: true, unavailable: true, message: `Местоположение не обновляется · последняя точка ${ageSeconds} с назад` };
  if (ageSeconds > 5) return { ageSeconds, delayed: true, unavailable: false, message: `Местоположение обновляется с задержкой · ${ageSeconds} с` };
  return { ageSeconds, delayed: false, unavailable: false, message: '' };
}
export function useClientDriverTracking(order: Order | null, enabled: boolean) {
  const [currentFix, setCurrentFix] = useState<ReceivedFix | null>(null);
  const [now, setNow] = useState(monotonicNow);
  const acceptedFix = useRef<ReceivedFix | null>(null);
  const pendingOutlier = useRef<DriverLocation | null>(null);
  const retiredSessions = useRef(new Set<string>());
  const eventVersion = useRef(0);
  const revoked = useRef('');
  const positionScope = useRef('');
  const latest = useRef({ order, enabled }); latest.current = { order, enabled };
  const scope = enabled && order?.driver && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status) ? `${order.id}:${order.driver.id}:${order.assignmentId ?? ''}` : '';
  const receive = useCallback((event: DriverLocationEvent) => {
    const current = latest.current.order;
    const key = current ? `${current.id}:${current.driver?.id}:${current.assignmentId ?? ''}` : '';
    if (positionScope.current !== key) { acceptedFix.current = null; pendingOutlier.current = null; retiredSessions.current.clear(); eventVersion.current = 0; }
    if (event.orderId === current?.id && event.driverId === current?.driver?.id
      && (!current.assignmentId || current.assignmentId === event.assignmentId)
      && ['SEARCHING', 'COMPLETED', 'CANCELLED', 'NO_DRIVER'].includes(event.status)
      && (event.stateVersion == null || Number.isInteger(event.stateVersion) && event.stateVersion >= eventVersion.current)) {
      revoked.current = key; acceptedFix.current = null; setCurrentFix(null); return;
    }
    if (revoked.current === key) return;
    if (!latest.current.enabled || !validTrackingEvent(event, latest.current.order)) return;
    const next = { ...event.location!, stateVersion: event.location!.stateVersion ?? event.stateVersion };
    const old = acceptedFix.current?.position;
    if (next.trackingSessionId && retiredSessions.current.has(next.trackingSessionId)
      || !newerTrackingLocation(old ?? null, next, false)) return;
    if (!newerTrackingLocation(old ?? null, next)) {
      const candidate = pendingOutlier.current;
      const confirms = candidate && next.trackingSessionId === candidate.trackingSessionId
        && measuredAt(next) - measuredAt(candidate) <= 5000
        && accuracy(next) != null && accuracy(next)! <= 25 && accuracy(candidate) != null && accuracy(candidate)! <= 25
        && newerTrackingLocation(candidate, next);
      if (!confirms) {
        if (!candidate || measuredAt(next) > measuredAt(candidate)) pendingOutlier.current = next;
        return;
      }
    }
    pendingOutlier.current = null;
    if (old?.trackingSessionId && next.trackingSessionId && old.trackingSessionId !== next.trackingSessionId) {
      retiredSessions.current.add(old.trackingSessionId);
    }
    positionScope.current = key;
    eventVersion.current = Math.max(eventVersion.current, event.stateVersion ?? next.stateVersion ?? 0);
    const receivedLocallyAt = monotonicNow(), serverTimeAtReceipt = event.serverTimeMs ?? Date.now();
    const value: ReceivedFix = { position: { ...next,
      playbackAgeAtReceiptMs: Math.max(0, serverTimeAtReceipt - measuredAt(next)), playbackReceivedAtMs: receivedLocallyAt,
      playbackPositionValidated: true },
      receivedLocallyAt, serverTimeAtReceipt };
    acceptedFix.current = value; setCurrentFix(value); setNow(receivedLocallyAt);
  }, []);
  useEffect(() => {
    setCurrentFix(null); acceptedFix.current = null; pendingOutlier.current = null; retiredSessions.current.clear(); eventVersion.current = 0;
    revoked.current = ''; positionScope.current = '';
    if (!scope || !order) return;
    // A v1 order contains a cached fix but no snapshot serverTimeMs. Wait for
    // the immediate authenticated GET so a skewed phone clock cannot present
    // that cached point as fresh. Legacy orders retain their old first paint.
    if (order.driverLocation && !order.assignmentId) receive({ orderId: order.id, driverId: order.driver?.id || null, status: order.status, location: order.driverLocation });
    let live = true, pending = false;
    const controller = new AbortController();
    const poll = async () => {
      setNow(monotonicNow());
      if (!live || pending || AppState.currentState !== 'active') return;
      pending = true;
      try { const result = await api.request<DriverLocationEvent>(`/orders/${order.id}/driver-location`, { signal: controller.signal }); if (live) receive(result); }
      catch { /* Keep the last fix briefly; then show that the signal is unavailable. */ }
      finally { pending = false; }
    };
    void poll(); const timer = setInterval(() => void poll(), 5000);
    const clock = setInterval(() => setNow(monotonicNow()), 1000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void poll(); });
    return () => { live = false; controller.abort(); clearInterval(timer); clearInterval(clock); subscription.remove(); };
  }, [scope, receive]);
  const scoped = scope && scope === positionScope.current && currentFix?.position && currentFix.position.driverId === order?.driver?.id ? currentFix.position : null;
  const age = trackingAgeStatus(scoped || null, now, currentFix?.receivedLocallyAt, currentFix?.serverTimeAtReceipt);
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
