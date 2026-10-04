import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as SecureStore from 'expo-secure-store';
import * as Speech from 'expo-speech';
import { Alert, AppState, Linking, Platform } from 'react-native';
import { api, ApiError } from '../api';
import { isRoleAllowed } from '../appVariant';
import type { DriverLocationUpdate, Language, Order, Point } from '../types';
import { DrivingRoute, NavigationFix, NavigationProgress, PreparedRoute, PreviousRouteProgress, bestVoiceForLanguage, distanceBetween, guidanceCue, navigationDestination, offRouteThreshold, prepareRoute, routeProgress, shouldReroute, unsupportedRouteOptions, usableNavigationFix } from '../navigation';
import { DriverGpsFilter, DRIVER_GPS_CONFIG } from '../driverGps';
import { routeVoice } from './routeVoice';
import { getTrackingRecording, recordTrackingEvent, startTrackingRecording, stopTrackingRecording } from './trackingRecorder';

const inForeground = () => AppState.currentState === 'active';
const TASK = 'taxigo-driver-active-trip-v1';
const KEY = 'taxi.driverTracking.v1';
export { DRIVER_GPS_CONFIG } from '../driverGps';
type Session = { userId: string; order: Pick<Order, 'id' | 'status' | 'pickup' | 'dropoff' | 'assignmentId'>; voice: boolean; language?: Language; trackingSessionId?: string; trackingStartedAt?: number; sequence?: number };
type Reply = { orderId: string; driverId: string; assignmentId?: string | null; status: Order['status']; pickup: Point; dropoff: Point };
let session: Session | null | undefined;
let sessionLoad: Promise<void> | null = null;
let starting: Promise<boolean> | null = null;
let generation = 0, lastSent = 0, sending = false;
let sendingVersion: number | null = null;
let queuedFix: NavigationFix | null = null;
let omitCourseMetadata = false;
let storage: Promise<unknown> = Promise.resolve();
let bgRoute: PreparedRoute | null = null, bgSession = '', lastRoute = 0, offRoute = 0;
let offRouteStart: NavigationFix | null = null;
let legacyRouteServer = false;
let guiding = false;
let previous: PreviousRouteProgress | undefined;
let bgRouteVersion = 0;
let latestBgProgress: NavigationProgress | null = null;
let lastReliableFix: NavigationFix | null = null;
const gpsFilter = new DriverGpsFilter();
let lastRawFix: NavigationFix | null = null;
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
const diagnosticsAllowed = () => typeof process !== 'undefined' && process.env.EXPO_PUBLIC_TRACKING_DIAGNOSTICS === '1'
  && isRoleAllowed('DRIVER');
const activeOrder = (order: Session['order'] | null | undefined) => !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status);
function resetGuidance() { bgRoute = null; previous = undefined; latestBgProgress = null; bgRouteVersion++; spoken.clear(); pendingSpeech = null; speaking = false; lastRoute = 0; offRoute = 0; offRouteStart = null; selectedVoice = undefined; }
// Compatibility for navigation callers. A planned route is guidance, not
// evidence that the car actually drove along that road or faces its tangent.
export function setDriverTrackingRoute(_route: DrivingRoute | null) {}
export function subscribeDriverFix(listener: (fix: NavigationFix) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function getDriverTrackingDiagnostics() {
  return { raw: lastRawFix, processed: lastReliableFix, ageMs: lastReliableFix ? Date.now() - lastReliableFix.timestamp : null,
    trackingSessionId: session?.trackingSessionId || null, sequence: session?.sequence || 0,
    assignmentId: session?.order.assignmentId || null, protocol: session?.order.assignmentId ? 'v1' : 'legacy',
    transportStatus, lastDropReason, diagnosticMode: diagnosticsAllowed() ? diagnosticMode : 'off',
    recordedFixCount: diagnosticsAllowed() ? recordedFixes.length : 0, recording: getTrackingRecording() };
}

/** Diagnostic sources are restricted to a development driver build and never sent to the server. */
export function startDriverGpsRecording(): boolean {
  if (!diagnosticsAllowed() || diagnosticMode !== 'off' || !startTrackingRecording()) return false;
  recordedFixes = []; recording = true; return true;
}
export function stopDriverGpsRecording(): NavigationFix[] {
  stopTrackingRecording();
  recording = false;
  return diagnosticsAllowed() ? recordedFixes.slice() : [];
}
export function stopDriverGpsDiagnostic() {
  if (!diagnosticsAllowed()) return;
  if (replayTimer) clearTimeout(replayTimer);
  replayTimer = null; diagnosticMode = 'off';
  lastReliableFix = null; lastRawFix = null; gpsFilter.reset();
}
export function freezeDriverGps(): boolean {
  if (!diagnosticsAllowed() || !lastReliableFix) return false;
  if (replayTimer) clearTimeout(replayTimer);
  stopTrackingRecording();
  replayTimer = null; recording = false; queuedFix = null; diagnosticMode = 'freeze';
  return true;
}
export function replayDriverGps(trace: NavigationFix[]): boolean {
  if (!diagnosticsAllowed() || trace.length < 2 || trace.length > 1000
    || trace.some((fix, index) => !Number.isFinite(fix.timestamp)
      || (index > 0 && fix.timestamp <= trace[index - 1].timestamp))) return false;
  if (replayTimer) clearTimeout(replayTimer);
  stopTrackingRecording();
  replayTimer = null; recording = false; queuedFix = null; diagnosticMode = 'replay';
  lastReliableFix = null; gpsFilter.reset();
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
    generation++; lastSent = 0; lastReliableFix = null; lastRawFix = null; gpsFilter.reset();
    queuedFix = null; sending = false; sendingVersion = null; transportStatus = 'idle'; resetGuidance();
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
  const proceed = await new Promise<boolean>(resolve => Alert.alert('Геолокация в фоне',
    'Когда вы на линии, Atlas pro обновляет ваше местоположение с выключенным экраном, чтобы находить заказы рядом. Во время поездки это также нужно для навигации. В настройках выберите «Разрешить всегда».',
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
  const loadRoute = async (rerouting: boolean) => {
    lastRoute = Date.now();
    const requestedAt = Date.now();
    recordTrackingEvent('route', { stage: 'requested', source: 'background', version: bgRouteVersion + 1,
      reason: rerouting ? 'off-route' : 'initial', measuredAtMs: fix.timestamp });
    const basic = { pickup: { latitude: fix.latitude, longitude: fix.longitude, address: 'Положение водителя' }, dropoff: target, language };
    const bearing = fix.heading != null && (fix.courseSource != null || (fix.speed ?? 0) >= 1.5) ? fix.heading : undefined;
    let route: DrivingRoute;
    try { route = await api.post<DrivingRoute>('/routes', legacyRouteServer ? basic
      : { ...basic, ...(bearing != null ? { bearing } : {}), ...(rerouting ? { fast: true } : {}) }); }
    catch (error) {
      if (!unsupportedRouteOptions(error) || version !== generation || inForeground()) {
        recordTrackingEvent('route', { stage: 'failed', source: 'background', latencyMs: Date.now() - requestedAt });
        throw error;
      }
      legacyRouteServer = true;
      route = await api.post<DrivingRoute>('/routes', basic);
    }
    recordTrackingEvent('route', { stage: 'received', source: 'background', latencyMs: Date.now() - requestedAt });
    if (version !== generation || inForeground()) return;
    bgRoute = prepareRoute(route); setDriverTrackingRoute(bgRoute.route);
    previous = { along: 0, timestamp: fix.timestamp }; bgRouteVersion++; latestBgProgress = null; spoken.clear();
    offRoute = 0; offRouteStart = null;
    recordTrackingEvent('route', { stage: 'applied', source: 'background', version: bgRouteVersion, latencyMs: Date.now() - requestedAt });
  };
  if (!bgRoute && Date.now() - lastRoute >= 3500) await loadRoute(false);
  if (!bgRoute || version !== generation || inForeground()) return;
  let progress = routeProgress(bgRoute, fix, previous, language);
  if (progress.offRouteMeters > offRouteThreshold(fix.accuracy)) {
    if (previous?.timestamp !== fix.timestamp) { offRoute++; offRouteStart ??= fix; }
    previous = { ...previous, along: previous?.along ?? 0, timestamp: fix.timestamp };
    latestBgProgress = null;
    pendingSpeech = null; speaking = false; await routeVoice.stop();
    if (!offRouteStart || !shouldReroute(offRoute, offRouteStart.timestamp, fix.timestamp,
      distanceBetween(offRouteStart, fix), fix.accuracy) || Date.now() - lastRoute < 3500) return;
    // Start on the confirming fix, without waiting for another background batch.
    // Keep the old geometry until a valid replacement arrives if the network fails.
    await loadRoute(true);
    if (!bgRoute || version !== generation || inForeground()) return;
    progress = routeProgress(bgRoute, fix, previous, language);
    if (progress.offRouteMeters > offRouteThreshold(fix.accuracy)) return;
  }
  offRoute = 0; offRouteStart = null; previous = { along: progress.along, timestamp: fix.timestamp, stepIndex: progress.stepIndex,
    pendingStepIndex: progress.pendingStepIndex, pendingStepCount: progress.pendingStepCount };
  latestBgProgress = progress;
  const routeVersion = bgRouteVersion, legIndex = current.order.status === 'IN_PROGRESS' ? 1 : 0;
  const cue = guidanceCue(progress, language, routeVersion, legIndex);
  if (cue && !spoken.has(cue.key) && (pendingSpeech?.key !== cue.key || Date.now() - pendingSpeech.at > 12000)) {
    selectedVoice ??= Speech.getAvailableVoicesAsync().then(voices => bestVoiceForLanguage(voices, language)).catch(() => undefined);
    const voice = await selectedVoice;
    if (version !== generation || inForeground() || !session?.voice || routeVersion !== bgRouteVersion) return;
    if (speaking) await routeVoice.stop();
    if (version !== generation || inForeground() || !session?.voice || routeVersion !== bgRouteVersion) return;
    const liveFix = lastReliableFix;
    if (!usableNavigationFix(liveFix) || Date.now() - liveFix.timestamp > 15_000 || !bgRoute) return;
    const refreshedProgress = liveFix.timestamp > fix.timestamp
      ? routeProgress(bgRoute, liveFix, previous, language) : latestBgProgress;
    const refreshedCue = refreshedProgress && guidanceCue(refreshedProgress, language, routeVersion, legIndex);
    if (!refreshedCue || refreshedCue.key !== cue.key || spoken.has(refreshedCue.key)) return;
    pendingSpeech = { key: cue.key, at: Date.now() }; speaking = true;
    routeVoice.speak(refreshedCue.text, { language, systemVoice: voice,
      shouldStart: () => {
        if (version !== generation || inForeground() || !session?.voice || routeVersion !== bgRouteVersion
          || !bgRoute || !usableNavigationFix(lastReliableFix) || Date.now() - lastReliableFix.timestamp > 15_000) return false;
        const latestProgress = routeProgress(bgRoute, lastReliableFix, previous, language);
        const atStart = guidanceCue(latestProgress, language, routeVersion, legIndex);
        return !!atStart && atStart.key === cue.key
          && (cue.stage !== 100 || Math.abs(latestProgress.maneuverDistance - refreshedProgress!.maneuverDistance) <= 20);
      },
      onStart: () => {
        if (version !== generation || routeVersion !== bgRouteVersion || !usableNavigationFix(lastReliableFix)
          || Date.now() - lastReliableFix.timestamp > 15_000) { void routeVoice.stop(); return; }
        spoken.add(cue.key);
        recordTrackingEvent('voice', { stage: 'started', source: 'background', text: refreshedCue.text,
          cueKey: cue.key, routeVersion, maneuverDistance: bgRoute && lastReliableFix
            ? routeProgress(bgRoute, lastReliableFix, previous, language).maneuverDistance : null });
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
    courseAccuracyDeg: fix.courseAccuracyDeg ?? null, courseSource: fix.courseSource ?? null,
  } : { latitude: fix.latitude, longitude: fix.longitude,
    timestamp: fix.timestamp, accuracy: fix.accuracy, heading: fix.heading ?? null, speed: fix.speed ?? null,
    courseAccuracyDeg: fix.courseAccuracyDeg ?? null, courseSource: fix.courseSource ?? null,
    driverId: current.userId, tripId: current.order.id,
    trackingSessionId: current.trackingSessionId, trackingStartedAt: current.trackingStartedAt, sequence, measuredAt: fix.timestamp,
    accuracyM: fix.accuracy,
    speedMps: fix.speed ?? null, bearingDeg: fix.heading ?? null };
  storage = storage.catch(() => undefined).then(() => SecureStore.setItemAsync(KEY, JSON.stringify(current))).catch(() => undefined);
  try {
    if (version !== generation || diagnosticMode !== 'off') return;
    recordTrackingEvent('upload', { stage: 'sending', sequence, measuredAtMs: fix.timestamp,
      trackingSessionId: current.trackingSessionId, orderId: current.order.id, assignmentId: current.order.assignmentId ?? null });
    const path = `/orders/${current.order.id}/driver-location`;
    const withoutCourseMetadata = () => {
      const compatiblePayload: Record<string, unknown> = { ...payload };
      delete compatiblePayload.courseAccuracyDeg;
      delete compatiblePayload.courseSource;
      return compatiblePayload;
    };
    let result: Reply;
    try {
      result = await api.patch<Reply>(path, omitCourseMetadata ? withoutCourseMetadata() : payload);
    } catch (error) {
      // Older servers strictly reject the two new optional quality fields.
      // Retry only that explicit validation response, preserving the same fix.
      const unsupportedMetadata = error instanceof ApiError && error.status === 400
        && error.message.split(/[,\n]\s*/).every(message =>
          /^property (courseAccuracyDeg|courseSource) should not exist$/.test(message.trim()));
      if (omitCourseMetadata || !unsupportedMetadata) throw error;
      omitCourseMetadata = true;
      if (version !== generation || diagnosticMode !== 'off'
        || Date.now() - fix.timestamp > DRIVER_GPS_CONFIG.maxFixAgeMs) return;
      result = await api.patch<Reply>(path, withoutCourseMetadata());
    }
    if (version === generation) transportStatus = 'connected';
    recordTrackingEvent('upload', { stage: 'accepted', sequence, measuredAtMs: fix.timestamp,
      trackingSessionId: current.trackingSessionId, orderId: current.order.id, currentSession: version === generation });
    if (version !== generation || result.driverId !== current.userId) return;
    if (result.status !== current.order.status) {
      await setDriverTrackingSession({ ...current, order: { id: result.orderId, status: result.status, pickup: result.pickup, dropoff: result.dropoff,
        assignmentId: result.assignmentId ?? current.order.assignmentId } });
      return;
    }
  } catch (error) {
    recordTrackingEvent('upload', { stage: 'failed', sequence, measuredAtMs: fix.timestamp,
      trackingSessionId: current.trackingSessionId, orderId: current.order.id,
      status: error instanceof ApiError ? error.status : null, currentSession: version === generation });
    if (version === generation) transportStatus = 'delayed';
    if (version === generation && error instanceof ApiError && [401, 403, 404].includes(error.status)) {
      await setDriverTrackingSession(null); await routeVoice.stop();
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
  const fix = gpsFilter.ingest(raw, Date.now());
  lastDropReason = gpsFilter.lastDropReason;
  if (!diagnosticSource) recordTrackingEvent('gps', { raw, processed: fix, dropReason: lastDropReason || null,
    transportStatus, trackingSessionId: session?.trackingSessionId ?? null, sequence: session?.sequence ?? 0,
    orderId: session?.order.id ?? null, assignmentId: session?.order.assignmentId ?? null, foreground: inForeground() });
  if (!fix) return null;
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
  if (!fix) { if (!inForeground()) await routeVoice.stop(); return; }
  const current = session, version = generation;
  await Promise.allSettled([
    reportDriverPosition(fix),
    current && !inForeground() ? guideInBackground(fix, current, version) : Promise.resolve(),
  ]);
});
