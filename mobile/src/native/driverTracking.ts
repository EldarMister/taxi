import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { api, ApiError } from '../api';
import { isRoleAllowed } from '../appVariant';
import type { DriverLocationUpdate, Language, Order, Point } from '../types';
import { DrivingRoute, NavigationFix, NavigationProgress, PreparedRoute, PreviousRouteProgress, bestVoiceForLanguage, distanceBetween, guidanceCue, navigationConfig, navigationDestination, prepareRoute, routeProgress, usableNavigationFix } from '../navigation';

const inForeground = () => AppState.currentState === 'active';
const TASK = 'taxigo-driver-active-trip-v1';
const KEY = 'taxi.driverTracking.v1';
export const DRIVER_GPS_CONFIG = {
  requestIntervalMs: 1000,
  movingUploadMinMs: 900,
  stationaryUploadMinMs: 2500,
  maxFixAgeMs: 30_000,
  maxFutureMs: 5_000,
  maxAccuracyM: 80,
  maxReportedSpeedMps: 100,
  maximumTravelSpeedMps: 45,
  jumpAllowanceM: 35,
  jumpConfirmationMaxGapMs: 10_000,
  jumpConfirmationMinRadiusM: 15,
  jumpConfirmationMaxRadiusM: 40,
  stationarySpeedMps: 1.5,
  stationaryNoiseMinM: 5,
  stationaryNoiseMaxM: 18,
  stationaryNoiseAccuracyFactor: 0.35,
  stationaryConfirmations: 2,
} as const;
type Session = { userId: string; order: Pick<Order, 'id' | 'status' | 'pickup' | 'dropoff' | 'assignmentId'>; voice: boolean; language?: Language; trackingSessionId?: string; trackingStartedAt?: number; sequence?: number };
type Reply = { orderId: string; driverId: string; assignmentId?: string | null; status: Order['status']; pickup: Point; dropoff: Point };
let session: Session | null | undefined;
let sessionLoad: Promise<void> | null = null;
let starting: Promise<boolean> | null = null;
let generation = 0, lastSent = 0, sending = false;
let sendingVersion: number | null = null;
let queuedFix: NavigationFix | null = null;
let storage: Promise<unknown> = Promise.resolve();
let bgRoute: PreparedRoute | null = null, bgSession = '', lastRoute = 0, offRoute = 0;
let guiding = false;
let previous: PreviousRouteProgress | undefined;
let bgRouteVersion = 0;
let latestBgProgress: NavigationProgress | null = null;
let lastReliableFix: NavigationFix | null = null;
let lastRawFix: NavigationFix | null = null;
let pendingJump: NavigationFix | null = null;
let stationaryCandidate: NavigationFix | null = null;
let stationaryCount = 0;
let lastDropReason = '';
let transportStatus: 'idle' | 'connected' | 'delayed' = 'idle';
let selectedVoice: Promise<string | undefined> | undefined;
const spoken = new Set<string>();
let pendingSpeech: { key: string; at: number } | null = null;
let speaking = false;
const listeners = new Set<(fix: NavigationFix) => void>();
let diagnosticMode: 'off' | 'freeze' | 'replay' = 'off';
let recording = false;
let recordedFixes: NavigationFix[] = [];
let replayTimer: ReturnType<typeof setTimeout> | null = null;
const diagnosticsAllowed = () => typeof __DEV__ !== 'undefined' && __DEV__
  && typeof process !== 'undefined' && process.env.EXPO_PUBLIC_TRACKING_DIAGNOSTICS === '1'
  && isRoleAllowed('DRIVER');
const activeOrder = (order: Session['order'] | null | undefined) => !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status);
function resetGuidance() { bgRoute = null; previous = undefined; latestBgProgress = null; bgRouteVersion++; spoken.clear(); pendingSpeech = null; speaking = false; lastRoute = 0; offRoute = 0; selectedVoice = undefined; }
export function subscribeDriverFix(listener: (fix: NavigationFix) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getDriverTrackingDiagnostics() {
  return { raw: lastRawFix, processed: lastReliableFix, ageMs: lastReliableFix ? Date.now() - lastReliableFix.timestamp : null,
    trackingSessionId: session?.trackingSessionId || null, sequence: session?.sequence || 0,
    assignmentId: session?.order.assignmentId || null, protocol: session?.order.assignmentId ? 'v1' : 'legacy',
    transportStatus, lastDropReason, diagnosticMode: diagnosticsAllowed() ? diagnosticMode : 'off',
    recordedFixCount: diagnosticsAllowed() ? recordedFixes.length : 0 };
}

/** Diagnostic sources are restricted to a development driver build and never sent to the server. */
export function startDriverGpsRecording(): boolean {
  if (!diagnosticsAllowed() || diagnosticMode !== 'off') return false;
  recordedFixes = []; recording = true; return true;
}
export function stopDriverGpsRecording(): NavigationFix[] {
  recording = false;
  return diagnosticsAllowed() ? recordedFixes.slice() : [];
}
export function stopDriverGpsDiagnostic() {
  if (!diagnosticsAllowed()) return;
  if (replayTimer) clearTimeout(replayTimer);
  replayTimer = null; diagnosticMode = 'off';
  lastReliableFix = null; lastRawFix = null; pendingJump = null; stationaryCandidate = null; stationaryCount = 0;
}
export function freezeDriverGps(): boolean {
  if (!diagnosticsAllowed() || !lastReliableFix) return false;
  if (replayTimer) clearTimeout(replayTimer);
  replayTimer = null; recording = false; queuedFix = null; diagnosticMode = 'freeze';
  return true;
}
export function replayDriverGps(trace: NavigationFix[]): boolean {
  if (!diagnosticsAllowed() || trace.length < 2 || trace.length > 1000
    || trace.some((fix, index) => !Number.isFinite(fix.timestamp)
      || (index > 0 && fix.timestamp <= trace[index - 1].timestamp))) return false;
  if (replayTimer) clearTimeout(replayTimer);
  replayTimer = null; recording = false; queuedFix = null; diagnosticMode = 'replay';
  lastReliableFix = null; pendingJump = null; stationaryCandidate = null; stationaryCount = 0;
  let index = 0;
  const emitNext = () => {
    if (diagnosticMode !== 'replay') return;
    // New timestamps are explicitly synthetic and remain local to the test build.
    void ingestDriverLocation({ ...trace[index], timestamp: Date.now() }, false, true);
    index++;
    if (index < trace.length) replayTimer = setTimeout(emitNext,
      Math.max(50, Math.min(10_000, trace[index].timestamp - trace[index - 1].timestamp)));
    else replayTimer = null;
  };
  emitNext();
  return true;
}

function newTrackingSessionId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
async function restoreTrackingSession() {
  if (session !== undefined) return;
  sessionLoad ??= SecureStore.getItemAsync(KEY).then(value => {
    if (session === undefined) {
      try { session = value ? JSON.parse(value) as Session : null; }
      catch { session = null; }
    }
  }).catch(() => { if (session === undefined) session = null; });
  await sessionLoad;
}

export async function setDriverTrackingSession(next: Session | null) {
  await restoreTrackingSession();
  const key = next ? `${next.userId}:${next.order.id}:${next.order.assignmentId || ''}` : '';
  const old = session ? `${session.userId}:${session.order.id}:${session.order.assignmentId || ''}` : '';
  const guidanceKey = next ? `${key}:${next.order.status}:${next.language || 'ru'}:${next.voice}` : '';
  const previousGuidanceKey = session ? `${old}:${session.order.status}:${session.language || 'ru'}:${session.voice}` : '';
  if (key !== old) {
    stopDriverGpsDiagnostic();
    generation++; lastSent = 0; lastReliableFix = null; lastRawFix = null; pendingJump = null; stationaryCandidate = null;
    stationaryCount = 0; queuedFix = null; sending = false; sendingVersion = null; transportStatus = 'idle'; resetGuidance();
  }
  else if (guidanceKey !== previousGuidanceKey) {
    generation++; lastSent = 0; sending = false; sendingVersion = null; queuedFix = null; resetGuidance();
  }
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
  if (starting) return starting;
  const pending = (async () => {
    if (Platform.OS === 'web' || !isRoleAllowed('DRIVER') || !session) return false;
    const assignmentKey = `${session.userId}:${session.order.id}:${session.order.assignmentId || ''}`;
    const sameAssignment = () => !!session && `${session.userId}:${session.order.id}:${session.order.assignmentId || ''}` === assignmentKey;
    if (!(await Location.getBackgroundPermissionsAsync()).granted) return false;
    const foregroundPermission = await Location.getForegroundPermissionsAsync();
    if (!foregroundPermission.granted || (Platform.OS === 'android' && foregroundPermission.android?.accuracy === 'coarse')) {
      lastDropReason = 'precise-location-permission-required';
      return false;
    }
    if (!sameAssignment() || !inForeground()) return false;
    if (!await Location.hasStartedLocationUpdatesAsync(TASK)) {
      if (!sameAssignment() || !inForeground()) return false;
      await Location.startLocationUpdatesAsync(TASK, {
        accuracy: Location.Accuracy.BestForNavigation, timeInterval: DRIVER_GPS_CONFIG.requestIntervalMs, distanceInterval: 0,
        deferredUpdatesInterval: 0, pausesUpdatesAutomatically: false,
        activityType: Location.ActivityType.AutomotiveNavigation, showsBackgroundLocationIndicator: true,
        foregroundService: { notificationTitle: 'Atlas pro · поездка активна', notificationBody: 'Навигация и положение для вашего пассажира', notificationColor: '#2477F3', killServiceOnDestroy: true },
      });
      if (!sameAssignment()) {
        if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
        return false;
      }
    }
    return true;
  })();
  starting = pending;
  try { return await pending; }
  finally { if (starting === pending) starting = null; }
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
    bgRoute = prepareRoute(route); previous = { along: 0, timestamp: fix.timestamp }; bgRouteVersion++; latestBgProgress = null; spoken.clear();
  }
  if (!bgRoute || version !== generation || inForeground()) return;
  const progress = routeProgress(bgRoute, fix, previous, language);
  if (progress.offRouteMeters > navigationConfig.offRouteMeters) {
    offRoute = progress.offRouteMeters > Math.max(navigationConfig.offRouteMeters, fix.accuracy * 2) ? offRoute + 1 : 0;
    if (offRoute >= navigationConfig.rerouteFixes && Date.now() - lastRoute >= 15000) { bgRoute = null; previous = undefined; latestBgProgress = null; }
    pendingSpeech = null; speaking = false; await Speech.stop(); return;
  }
  offRoute = 0; previous = { along: progress.along, timestamp: fix.timestamp, stepIndex: progress.stepIndex,
    pendingStepIndex: progress.pendingStepIndex, pendingStepCount: progress.pendingStepCount };
  latestBgProgress = progress;
  const routeVersion = bgRouteVersion, legIndex = current.order.status === 'IN_PROGRESS' ? 1 : 0;
  const cue = guidanceCue(progress, language, routeVersion, legIndex);
  if (cue && !spoken.has(cue.key) && (pendingSpeech?.key !== cue.key || Date.now() - pendingSpeech.at > 12000)) {
    selectedVoice ??= Speech.getAvailableVoicesAsync().then(voices => bestVoiceForLanguage(voices, language)).catch(() => undefined);
    const voice = await selectedVoice;
    if (version !== generation || inForeground() || !session?.voice || routeVersion !== bgRouteVersion) return;
    if (speaking) await Speech.stop();
    if (version !== generation || inForeground() || !session?.voice || routeVersion !== bgRouteVersion) return;
    const liveFix = lastReliableFix;
    if (!usableNavigationFix(liveFix) || Date.now() - liveFix.timestamp > 15_000 || !bgRoute) return;
    const refreshedProgress = liveFix.timestamp > fix.timestamp
      ? routeProgress(bgRoute, liveFix, previous, language) : latestBgProgress;
    const refreshedCue = refreshedProgress && guidanceCue(refreshedProgress, language, routeVersion, legIndex);
    if (!refreshedCue || refreshedCue.key !== cue.key || spoken.has(refreshedCue.key)) return;
    pendingSpeech = { key: cue.key, at: Date.now() }; speaking = true;
    Speech.speak(refreshedCue.text, { language: language === 'ky' ? 'ky-KG' : Platform.OS === 'android' ? 'ru' : 'ru-RU', voice, rate: .9, volume: 1, useApplicationAudioSession: false,
      onStart: () => {
        if (version !== generation || routeVersion !== bgRouteVersion || !usableNavigationFix(lastReliableFix)
          || Date.now() - lastReliableFix.timestamp > 15_000) { void Speech.stop(); return; }
        spoken.add(cue.key);
        for (const key of refreshedCue.supersedes) spoken.add(key);
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
  if (diagnosticMode !== 'off' || !session || !activeOrder(session.order) || !usableNavigationFix(fix)) return;
  if (sending && sendingVersion === generation) {
    if (!queuedFix || fix.timestamp > queuedFix.timestamp) queuedFix = fix;
    return;
  }
  const minimumInterval = fix.speed != null && fix.speed < DRIVER_GPS_CONFIG.stationarySpeedMps
    ? DRIVER_GPS_CONFIG.stationaryUploadMinMs : DRIVER_GPS_CONFIG.movingUploadMinMs;
  if (Date.now() - lastSent < minimumInterval) return;
  const current = session, version = generation;
  sending = true; sendingVersion = version; lastSent = Date.now();
  current.trackingStartedAt ??= Date.now();
  current.trackingSessionId ??= newTrackingSessionId();
  const sequence = (current.sequence || 0) + 1;
  current.sequence = sequence;
  const payload: DriverLocationUpdate | Record<string, unknown> = current.order.assignmentId ? {
    schemaVersion: 1, orderId: current.order.id, assignmentId: current.order.assignmentId,
    trackingSessionId: current.trackingSessionId, trackingStartedAtMs: current.trackingStartedAt, sequence,
    latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracy,
    speedMps: fix.speed ?? null, courseDeg: fix.heading ?? null, measuredAtMs: fix.timestamp,
  } : { ...fix, driverId: current.userId, tripId: current.order.id,
    trackingSessionId: current.trackingSessionId, trackingStartedAt: current.trackingStartedAt, sequence, measuredAt: fix.timestamp,
    accuracyM: fix.accuracy,
    ...(fix.speed != null ? { speedMps: fix.speed } : {}),
    ...(fix.heading != null ? { bearingDeg: fix.heading } : {}) };
  storage = storage.catch(() => undefined).then(() => SecureStore.setItemAsync(KEY, JSON.stringify(current))).catch(() => undefined);
  try {
    await storage;
    if (version !== generation || diagnosticMode !== 'off') return;
    const result = await api.patch<Reply>(`/orders/${current.order.id}/driver-location`, payload);
    if (version === generation) transportStatus = 'connected';
    if (version !== generation || result.driverId !== current.userId) return;
    if (result.status !== current.order.status) {
      await setDriverTrackingSession({ ...current, order: { id: result.orderId, status: result.status, pickup: result.pickup, dropoff: result.dropoff,
        assignmentId: result.assignmentId ?? current.order.assignmentId } });
      return;
    }
  } catch (error) {
    if (version === generation) transportStatus = 'delayed';
    if (version === generation && error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      await setDriverTrackingSession(null); await Speech.stop();
    }
    // No replay queue: stale positions must not move the car backwards on reconnect.
  } finally {
    if (sendingVersion === version) {
      sending = false; sendingVersion = null;
      const pending = queuedFix;
      queuedFix = null;
      if (pending && version === generation && Date.now() - pending.timestamp <= DRIVER_GPS_CONFIG.maxFixAgeMs)
        void reportDriverPosition(pending);
    }
  }
}

/** Single ingestion path for foreground watch and the native background task. */
export function ingestDriverLocation(raw: NavigationFix, report = true, diagnosticSource = false): NavigationFix | null {
  if (diagnosticMode !== 'off' && !diagnosticSource) return null;
  if (recording && !diagnosticSource && recordedFixes.length < 1000) recordedFixes.push({ ...raw });
  lastRawFix = raw;
  if (raw.heading === 360) raw = { ...raw, heading: 0 };
  const now = Date.now();
  if (!Number.isFinite(raw.latitude) || Math.abs(raw.latitude) > 90
    || !Number.isFinite(raw.longitude) || Math.abs(raw.longitude) > 180
    || !Number.isFinite(raw.accuracy) || raw.accuracy < 0 || raw.accuracy > DRIVER_GPS_CONFIG.maxAccuracyM
    || !Number.isFinite(raw.timestamp) || now - raw.timestamp > DRIVER_GPS_CONFIG.maxFixAgeMs
    || raw.timestamp - now > DRIVER_GPS_CONFIG.maxFutureMs
    || (raw.speed != null && (!Number.isFinite(raw.speed) || raw.speed < 0 || raw.speed > DRIVER_GPS_CONFIG.maxReportedSpeedMps))
    || (raw.heading != null && (!Number.isFinite(raw.heading) || raw.heading < 0 || raw.heading >= 360))) {
    lastDropReason = 'invalid-stale-or-inaccurate'; return null;
  }
  if (lastReliableFix && raw.timestamp <= lastReliableFix.timestamp) { lastDropReason = 'out-of-order'; return null; }
  let fix = raw;
  if (lastReliableFix && now - lastReliableFix.timestamp <= DRIVER_GPS_CONFIG.maxFixAgeMs) {
    const elapsedSeconds = (raw.timestamp - lastReliableFix.timestamp) / 1000;
    const distanceM = distanceBetween(lastReliableFix, raw);
    const allowedM = DRIVER_GPS_CONFIG.jumpAllowanceM + elapsedSeconds * DRIVER_GPS_CONFIG.maximumTravelSpeedMps
      + Math.max(lastReliableFix.accuracy, raw.accuracy);
    if (distanceM > allowedM) {
      const confirmationRadius = Math.max(DRIVER_GPS_CONFIG.jumpConfirmationMinRadiusM,
        Math.min(DRIVER_GPS_CONFIG.jumpConfirmationMaxRadiusM, Math.max(pendingJump?.accuracy ?? 0, raw.accuracy)));
      if (!pendingJump || raw.timestamp <= pendingJump.timestamp
        || raw.timestamp - pendingJump.timestamp > DRIVER_GPS_CONFIG.jumpConfirmationMaxGapMs
        || distanceBetween(pendingJump, raw) > confirmationRadius) {
        pendingJump = raw;
        stationaryCandidate = null;
        stationaryCount = 0;
        lastDropReason = 'implausible-jump';
        return null;
      }
    } else if (raw.speed != null && raw.speed < DRIVER_GPS_CONFIG.stationarySpeedMps) {
      const noiseM = Math.max(DRIVER_GPS_CONFIG.stationaryNoiseMinM,
        Math.min(DRIVER_GPS_CONFIG.stationaryNoiseMaxM,
          Math.max(lastReliableFix.accuracy, raw.accuracy) * DRIVER_GPS_CONFIG.stationaryNoiseAccuracyFactor));
      if (distanceM < noiseM) {
        if (!stationaryCandidate || raw.timestamp <= stationaryCandidate.timestamp
          || distanceBetween(stationaryCandidate, raw) >= noiseM) {
          stationaryCandidate = raw;
          stationaryCount = 1;
          lastDropReason = 'awaiting-stationary-confirmation';
          return null;
        }
        stationaryCount++;
        if (stationaryCount < DRIVER_GPS_CONFIG.stationaryConfirmations) {
          stationaryCandidate = raw;
          lastDropReason = 'awaiting-stationary-confirmation';
          return null;
        }
        fix = { ...raw, latitude: lastReliableFix.latitude, longitude: lastReliableFix.longitude,
          heading: lastReliableFix.heading };
      }
    }
  }
  pendingJump = null;
  stationaryCandidate = fix === raw ? null : raw;
  if (fix === raw) stationaryCount = 0;
  lastReliableFix = fix;
  lastDropReason = '';
  listeners.forEach(listener => listener(fix));
  if (report && !diagnosticSource) void reportDriverPosition(fix);
  return fix;
}

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(TASK, async ({ data, error }) => {
  if (error || !isRoleAllowed('DRIVER')) return;
  await storage;
  await restoreTrackingSession();
  if (!session || !activeOrder(session.order)) {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
    return;
  }
  if (!api.getTokens()) await api.restore();
  if (!api.getTokens()) { await setDriverTrackingSession(null); return; }
  let fix: NavigationFix | null = null;
  for (const location of [...(data?.locations || [])].sort((a, b) => a.timestamp - b.timestamp)) {
    const c = location.coords;
    const rawFix: NavigationFix = { latitude: c.latitude, longitude: c.longitude, accuracy: c.accuracy ?? Infinity, timestamp: location.timestamp,
      ...(c.heading != null && c.heading >= 0 ? { heading: c.heading } : {}), ...(c.speed != null && c.speed >= 0 ? { speed: c.speed } : {}) };
    fix = ingestDriverLocation(rawFix, false) || fix;
  }
  if (!fix) { if (!inForeground()) await Speech.stop(); return; }
  const current = session, version = generation;
  await Promise.allSettled([
    reportDriverPosition(fix),
    current && !inForeground() ? guideInBackground(fix, current, version) : Promise.resolve(),
  ]);
});
