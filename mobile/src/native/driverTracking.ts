import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { api, ApiError } from '../api';
import { isRoleAllowed } from '../appVariant';
import type { Language, Order, Point } from '../types';
import { DrivingRoute, NavigationFix, PreparedRoute, bestVoiceForLanguage, guidanceCue, navigationDestination, prepareRoute, routeProgress, stableNavigationFix, usableNavigationFix } from '../navigation';

const inForeground = () => AppState.currentState === 'active';
const TASK = 'taxigo-driver-active-trip-v1';
const KEY = 'taxi.driverTracking.v1';
type Session = { userId: string; order: Pick<Order, 'id' | 'status' | 'pickup' | 'dropoff'>; voice: boolean; language?: Language; trackingSessionId?: string; trackingStartedAt?: number; sequence?: number };
type Reply = { orderId: string; driverId: string; status: Order['status']; pickup: Point; dropoff: Point };
let session: Session | null | undefined;
let generation = 0, lastSent = 0, sending = false;
let storage: Promise<unknown> = Promise.resolve();
let bgRoute: PreparedRoute | null = null, bgSession = '', lastRoute = 0, offRoute = 0;
let guiding = false;
let previous: { along: number; timestamp: number } | undefined;
let lastReliableFix: NavigationFix | null = null;
let lastRawFix: NavigationFix | null = null;
let pendingJump: NavigationFix | null = null;
let lastDropReason = '';
let transportStatus: 'idle' | 'connected' | 'delayed' = 'idle';
let selectedVoice: Promise<string | undefined> | undefined;
const spoken = new Set<string>();
let pendingSpeech: { key: string; at: number } | null = null;
let speaking = false;
const listeners = new Set<(fix: NavigationFix) => void>();
const activeOrder = (order: Session['order'] | null | undefined) => !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status);
function resetGuidance() { bgRoute = null; previous = undefined; spoken.clear(); pendingSpeech = null; speaking = false; lastRoute = 0; offRoute = 0; selectedVoice = undefined; }
export function subscribeDriverFix(listener: (fix: NavigationFix) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getDriverTrackingDiagnostics() {
  return { raw: lastRawFix, processed: lastReliableFix, ageMs: lastReliableFix ? Date.now() - lastReliableFix.timestamp : null,
    trackingSessionId: session?.trackingSessionId || null, sequence: session?.sequence || 0,
    transportStatus, lastDropReason };
}

function newTrackingSessionId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }

export async function setDriverTrackingSession(next: Session | null) {
  const key = next ? `${next.userId}:${next.order.id}` : '';
  const old = session ? `${session.userId}:${session.order.id}` : '';
  const guidanceKey = next ? `${key}:${next.order.status}:${next.language || 'ru'}:${next.voice}` : '';
  const previousGuidanceKey = session ? `${old}:${session.order.status}:${session.language || 'ru'}:${session.voice}` : '';
  if (key !== old) { generation++; lastSent = 0; lastReliableFix = null; lastRawFix = null; pendingJump = null; transportStatus = 'idle'; resetGuidance(); }
  else if (guidanceKey !== previousGuidanceKey) { generation++; lastSent = 0; resetGuidance(); }
  session = next && activeOrder(next.order) ? { ...next, trackingSessionId: key === old ? session?.trackingSessionId || newTrackingSessionId() : newTrackingSessionId(),
    trackingStartedAt: key === old ? session?.trackingStartedAt || Date.now() : Date.now(),
    sequence: key === old ? session?.sequence || 0 : 0 } : null;
  const record = session;
  storage = storage.catch(() => undefined).then(async () => {
    if (record) await SecureStore.setItemAsync(KEY, JSON.stringify(record));
    else {
      await SecureStore.deleteItemAsync(KEY);
      if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
    }
  });
  await storage;
}

export async function startDriverBackgroundTracking(): Promise<boolean> {
  if (Platform.OS === 'web' || !isRoleAllowed('DRIVER') || !session) return false;
  if (!(await Location.getBackgroundPermissionsAsync()).granted) return false;
  const foregroundPermission = await Location.getForegroundPermissionsAsync();
  if (!foregroundPermission.granted || (Platform.OS === 'android' && foregroundPermission.android?.accuracy === 'coarse')) {
    lastDropReason = 'precise-location-permission-required';
    return false;
  }
  if (!session || !inForeground()) return false;
  if (!await Location.hasStartedLocationUpdatesAsync(TASK)) {
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0,
      deferredUpdatesInterval: 0, pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.AutomotiveNavigation, showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: 'Atlas pro · поездка активна', notificationBody: 'Навигация и положение для вашего пассажира', notificationColor: '#2477F3', killServiceOnDestroy: true },
    });
  }
  return true;
}
export async function requestDriverBackgroundAccess(): Promise<boolean> {
  if (Platform.OS === 'web' || !isRoleAllowed('DRIVER')) return false;
  if ((await Location.getBackgroundPermissionsAsync()).granted) return true;
  const proceed = await new Promise<boolean>(resolve => Alert.alert('Навигация в фоне',
    'Во время активной поездки Atlas pro использует геолокацию с выключенным экраном: озвучивает повороты и показывает вашу машину только вашему пассажиру. В настройках выберите «Разрешить всегда».',
    [{ text: 'Позже', style: 'cancel', onPress: () => resolve(false) }, { text: 'Продолжить', onPress: () => resolve(true) }], { cancelable: true, onDismiss: () => resolve(false) }));
  if (!proceed) return false;
  const permission = await Location.getBackgroundPermissionsAsync();
  if (!permission.canAskAgain) { await Linking.openSettings(); return false; }
  return (await Location.requestBackgroundPermissionsAsync()).granted;
}

async function backgroundGuidance(fix: NavigationFix, current: Session, version: number) {
  const target = navigationDestination(current.order as Order);
  if (!target || !current.voice || inForeground() || version !== generation || session !== current || !usableNavigationFix(fix)
    || Date.now() - fix.timestamp > 15000) return;
  const language = current.language || 'ru';
  const key = `${current.order.id}:${current.order.status}:${language}`;
  if (bgSession !== key) { bgSession = key; resetGuidance(); }
  if (!bgRoute && Date.now() - lastRoute >= 15000) {
    lastRoute = Date.now();
    const route = await api.post<DrivingRoute>('/routes', { pickup: { latitude: fix.latitude, longitude: fix.longitude, address: 'Положение водителя' }, dropoff: target, language });
    if (version !== generation || inForeground()) return;
    bgRoute = prepareRoute(route); previous = { along: 0, timestamp: fix.timestamp }; spoken.clear();
  }
  if (!bgRoute || version !== generation || inForeground()) return;
  const progress = routeProgress(bgRoute, fix, previous, language);
  if (progress.offRouteMeters > Math.max(60, fix.accuracy * 2)) {
    offRoute++;
    if (offRoute >= 3 && Date.now() - lastRoute >= 15000) { bgRoute = null; previous = undefined; }
    pendingSpeech = null; speaking = false; await Speech.stop(); return;
  }
  offRoute = 0; previous = { along: progress.along, timestamp: fix.timestamp };
  const cue = guidanceCue(progress, language);
  if (cue && !spoken.has(cue.key) && (pendingSpeech?.key !== cue.key || Date.now() - pendingSpeech.at > 12000)) {
    selectedVoice ??= Speech.getAvailableVoicesAsync().then(voices => bestVoiceForLanguage(voices, language)).catch(() => undefined);
    const voice = await selectedVoice;
    if (version !== generation || inForeground() || !session?.voice) return;
    if (speaking) await Speech.stop();
    if (version !== generation || inForeground() || !session?.voice) return;
    pendingSpeech = { key: cue.key, at: Date.now() }; speaking = true;
    Speech.speak(cue.text, { language: language === 'ky' ? 'ky-KG' : Platform.OS === 'android' ? 'ru' : 'ru-RU', voice, rate: .9, volume: 1, useApplicationAudioSession: false,
      onStart: () => {
        if (version !== generation) return;
        spoken.add(cue.key);
        if (cue.priority >= 2) spoken.add(`${progress.stepIndex}:500`);
        if (cue.priority >= 3) spoken.add(`${progress.stepIndex}:100`);
        pendingSpeech = null;
      },
      onDone: () => { if (version === generation) { pendingSpeech = null; speaking = false; } },
      onStopped: () => { if (version === generation) { pendingSpeech = null; speaking = false; } },
      onError: () => { if (version === generation) { pendingSpeech = null; speaking = false; spoken.delete(cue.key); } },
    });
  }
}
async function guideInBackground(fix: NavigationFix, current: Session, version: number) {
  if (guiding) return;
  guiding = true;
  try { await backgroundGuidance(fix, current, version); }
  catch { /* Keep the last route and retry when connectivity returns. */ }
  finally { guiding = false; }
}
export async function reportDriverPosition(fix: NavigationFix) {
  if (!session || !activeOrder(session.order) || !usableNavigationFix(fix) || sending || Date.now() - lastSent < (fix.speed != null && fix.speed < 1.5 ? 2500 : 900)) return;
  const current = session, version = generation;
  sending = true; lastSent = Date.now();
  current.trackingStartedAt ??= Date.now();
  const sequence = (current.sequence || 0) + 1;
  current.sequence = sequence;
  const payload = { ...fix, driverId: current.userId, tripId: current.order.id,
    trackingSessionId: current.trackingSessionId, trackingStartedAt: current.trackingStartedAt, sequence, measuredAt: fix.timestamp,
    accuracyM: fix.accuracy,
    ...(fix.speed != null ? { speedMps: fix.speed } : {}),
    ...(fix.heading != null ? { bearingDeg: fix.heading } : {}) };
  storage = storage.catch(() => undefined).then(() => SecureStore.setItemAsync(KEY, JSON.stringify(current))).catch(() => undefined);
  try {
    const result = await api.patch<Reply>(`/orders/${current.order.id}/driver-location`, payload);
    if (version === generation) transportStatus = 'connected';
    if (version !== generation || result.driverId !== current.userId) return;
    if (result.status !== current.order.status) {
      await setDriverTrackingSession({ ...current, order: { id: result.orderId, status: result.status, pickup: result.pickup, dropoff: result.dropoff } });
      return;
    }
  } catch (error) {
    if (version === generation) transportStatus = 'delayed';
    if (version === generation && error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      await setDriverTrackingSession(null); await Speech.stop();
    }
    // No replay queue: stale positions must not move the car backwards on reconnect.
  } finally { sending = false; }
}

/** Single ingestion path for foreground watch and the native background task. */
export function ingestDriverLocation(raw: NavigationFix, report = true): NavigationFix | null {
  lastRawFix = raw;
  if (!usableNavigationFix(raw)) { lastDropReason = 'stale-or-inaccurate'; return null; }
  if (lastReliableFix && raw.timestamp <= lastReliableFix.timestamp) { lastDropReason = 'out-of-order'; return null; }
  const fix = stableNavigationFix(lastReliableFix, raw, Date.now(), pendingJump);
  if (fix.timestamp !== raw.timestamp) { pendingJump = raw; lastDropReason = 'implausible-jump'; return null; }
  pendingJump = null;
  lastReliableFix = fix;
  lastDropReason = '';
  listeners.forEach(listener => listener(fix));
  if (report) void reportDriverPosition(fix);
  return fix;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !isRoleAllowed('DRIVER')) return;
  await storage;
  if (session === undefined) {
    try { session = JSON.parse(await SecureStore.getItemAsync(KEY) || 'null'); } catch { session = null; }
  }
  if (!session || !activeOrder(session.order)) {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
    return;
  }
  if (!api.getTokens()) await api.restore();
  if (!api.getTokens()) { await setDriverTrackingSession(null); return; }
  const location = data?.locations?.slice().sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!location) return;
  const c = location.coords;
  const rawFix: NavigationFix = { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy ?? Infinity, timestamp: location.timestamp,
    ...(c.heading != null && c.heading >= 0 ? { heading: c.heading } : {}), ...(c.speed != null && c.speed >= 0 ? { speed: c.speed } : {}) };
  const fix = ingestDriverLocation(rawFix, false);
  if (!fix) { if (!inForeground()) await Speech.stop(); return; }
  const current = session, version = generation;
  await Promise.allSettled([
    reportDriverPosition(fix),
    current && !inForeground() ? guideInBackground(fix, current, version) : Promise.resolve(),
  ]);
});
