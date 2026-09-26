import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import * as SecureStore from 'expo-secure-store';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { api, messageOf } from './api';
import { ingestDriverLocation, requestDriverBackgroundAccess, setDriverTrackingRoute, setDriverTrackingSession, startDriverBackgroundTracking, subscribeDriverFix } from './native/driverTracking';
import { routeVoice } from './native/routeVoice';
import type { Language, Order } from './types';
import { DrivingRoute, GuidanceCue, NavigationFix, NavigationProgress, PreparedRoute, PreviousRouteProgress, bestVoiceForLanguage, distanceBetween, guidanceCue, navigationDestination, offRouteThreshold, prepareRoute, routeProgress, shouldReroute, unsupportedRouteOptions, usableNavigationFix } from './navigation';
import { RoadFeature, roadFeatureAnnouncement, roadFeatureWindow, visibleRoadFeatures } from './roadFeatures';

export function useDriverNavigation({ userId, order, enabled, locationEnabled, mapVisible = true, language = 'ru' }: { userId?: string; order: Order | null; enabled: boolean; locationEnabled: boolean; mapVisible?: boolean; language?: Language }) {
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [position, setPosition] = useState<NavigationFix | null>(null);
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [progress, setProgress] = useState<NavigationProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [routeError, setRouteError] = useState('');
  const [gpsError, setGpsError] = useState('');
  const [hasInaccurateFix, setHasInaccurateFix] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceSettingVersion = useRef(0);
  useEffect(() => {
    const version = ++voiceSettingVersion.current;
    setVoiceEnabled(true);
    if (!userId) return;
    void SecureStore.getItemAsync(`atlas.driver.routeVoice.v1.${userId}`).then(value => {
      if (voiceSettingVersion.current === version) setVoiceEnabled(value !== '0');
    }).catch(() => undefined);
    return () => { voiceSettingVersion.current++; };
  }, [userId]);
  const [followDriver, setFollowDriverState] = useState(true);
  const followPausedAt = useRef<number | null>(null);
  const setFollowDriver = useCallback((follow: boolean) => {
    followPausedAt.current = follow ? null : Date.now();
    setFollowDriverState(follow);
  }, []);
  useEffect(() => {
    // A deliberate drag pauses following only for the current visible map.
    // Returning to the map, foregrounding the app or changing trip stage
    // should start from the driver's live coordinate again.
    if (enabled && mapVisible && foreground) setFollowDriver(true);
  }, [enabled, mapVisible, foreground, order?.id, order?.status]);
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [backgroundError, setBackgroundError] = useState('');
  const [routeVersion, setRouteVersion] = useState(0);
  const [roadFeatures, setRoadFeatures] = useState<RoadFeature[]>([]);
  const featureRequestRef = useRef<AbortController | null>(null);
  const featureLoadedUntil = useRef(0);
  const featureRetryAfter = useRef(0);
  const [rerouteReason, setRerouteReason] = useState('');
  const destination = navigationDestination(order);
  const active = enabled && !!destination;
  const tracking = enabled && locationEnabled && !!userId && !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status);
  useEffect(() => {
    let live = true;
    const next = tracking && userId && order ? { userId, order: { id: order.id, status: order.status, pickup: order.pickup,
      dropoff: order.dropoff, assignmentId: order.assignmentId }, voice: voiceEnabled, language } : null;
    void setDriverTrackingSession(next).then(() => next ? startDriverBackgroundTracking() : false).then(ready => {
      if (live) setBackgroundReady(previous => ready || (!!next && !foreground && previous));
    }).catch(() => { if (live) { setBackgroundReady(false); setBackgroundError('Не удалось включить работу в фоне'); } });
    return () => { live = false; };
  }, [tracking, userId, order?.id, order?.assignmentId, order?.status, voiceEnabled, language, foreground, retry]);
  const enableBackground = useCallback(async () => {
    try { await requestDriverBackgroundAccess(); setRetry(value => value + 1); setBackgroundError(''); }
    catch { setBackgroundError('Разрешите геолокацию «Всегда» в настройках телефона'); }
  }, []);
  const session = active ? `${userId}:${order?.id}:${order?.assignmentId || ''}:${order?.status}:${destination?.latitude}:${destination?.longitude}:${language}` : '';
  const sessionRef = useRef(session); sessionRef.current = session;
  const destinationRef = useRef(destination); destinationRef.current = destination;
  const fixRef = useRef(position); fixRef.current = position;
  const routeRef = useRef<PreparedRoute | null>(null);
  const recentFixes = useRef<NavigationFix[]>([]);
  const progressRef = useRef<PreviousRouteProgress | undefined>(undefined);
  const latestGuidanceRef = useRef<NavigationProgress | null>(null);
  const routeVersionRef = useRef(0);
  const legIndexRef = useRef(0); legIndexRef.current = order?.status === 'IN_PROGRESS' ? 1 : 0;
  const requestRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const lastRequest = useRef(0);
  const legacyRouteServer = useRef(false);
  const offRouteCount = useRef(0);
  const offRouteSince = useRef(0);
  const offRouteStart = useRef<NavigationFix | null>(null);
  const spoken = useRef(new Set<string>());
  const announcedSigns = useRef(new Set<string>());
  const pendingSpeech = useRef<string | null>(null);
  const activeSpeechCue = useRef<string | null>(null);
  const speechVersion = useRef(0);
  const speechBusy = useRef(false);
  const speechPriority = useRef(0);
  const speechTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const voiceRef = useRef(voiceEnabled); voiceRef.current = voiceEnabled;
  const foregroundRef = useRef(foreground); foregroundRef.current = foreground;
  const selectedVoice = useRef<string | undefined>(undefined);
  const lastHeading = useRef<number | undefined>(undefined);
  const acceptFix = useCallback((raw: NavigationFix) => {
    // The shared driver tracker already checked age, accuracy, order and jumps.
    // The UI only preserves the last reliable course while the car is stopped.
    const movingHeading = raw.heading != null && raw.heading >= 0 && (raw.speed ?? 0) >= 1.5 ? raw.heading : undefined;
    const fix: NavigationFix = { ...raw, heading: movingHeading ?? lastHeading.current };
    setHasInaccurateFix(false);
    if (movingHeading != null) lastHeading.current = movingHeading;
    recentFixes.current = [...recentFixes.current, fix].slice(-8);
    setPosition(previous => previous && previous.timestamp >= fix.timestamp ? previous : fix);
    setGpsError('');
  }, []);
  const stopSpeech = useCallback((retryCurrentCue = false) => {
    if (retryCurrentCue && activeSpeechCue.current) spoken.current.delete(activeSpeechCue.current);
    activeSpeechCue.current = null;
    speechVersion.current++; speechBusy.current = false; pendingSpeech.current = null;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = undefined;
    void routeVoice.stop().catch(() => undefined);
  }, []);
  const say = useCallback((text: string, cue?: GuidanceCue, onStarted?: () => void) => {
    if (!voiceRef.current || !foregroundRef.current || !sessionRef.current) return false;
    const priority = cue?.priority ?? 0;
    if (speechBusy.current && priority <= speechPriority.current) return false;
    const interrupt = speechBusy.current;
    if (interrupt && activeSpeechCue.current) spoken.current.delete(activeSpeechCue.current);
    activeSpeechCue.current = null;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = undefined;
    const version = ++speechVersion.current;
    speechBusy.current = true; speechPriority.current = priority;
    pendingSpeech.current = cue?.key || null;
    void (interrupt ? routeVoice.stop() : Promise.resolve()).then(() => {
      if (version !== speechVersion.current || !voiceRef.current || !foregroundRef.current || !sessionRef.current) return;
      // A queued phrase may become wrong while the previous audio or TTS request
      // waits. Recompute it from the current route and GPS before speaking.
      let currentCue = cue;
      if (cue) {
        const progress = latestGuidanceRef.current;
        const refreshed = progress && usableNavigationFix(fixRef.current) && Date.now() - fixRef.current!.timestamp <= 15_000
          ? guidanceCue(progress, language, routeVersionRef.current, legIndexRef.current) : null;
        if (!refreshed || refreshed.key !== cue.key) {
          speechBusy.current = false; pendingSpeech.current = null; speechPriority.current = 0;
          return;
        }
        currentCue = refreshed; text = refreshed.text;
      }
      routeVoice.speak(text, { language, systemVoice: selectedVoice.current,
        onStart: () => {
          if (version !== speechVersion.current) return;
          if (currentCue) {
            const progress = latestGuidanceRef.current;
            const atStart = progress && usableNavigationFix(fixRef.current) && Date.now() - fixRef.current!.timestamp <= 15_000
              ? guidanceCue(progress, language, routeVersionRef.current, legIndexRef.current) : null;
            if (!atStart || atStart.key !== currentCue.key) {
              speechVersion.current++; speechBusy.current = false; pendingSpeech.current = null; activeSpeechCue.current = null;
              void routeVoice.stop().catch(() => undefined);
              return;
            }
          }
          pendingSpeech.current = null; setVoiceError('');
          onStarted?.();
          if (currentCue) {
            activeSpeechCue.current = currentCue.key;
            spoken.current.add(currentCue.key);
            for (const key of currentCue.supersedes) spoken.current.add(key);
          }
        },
        onDone: () => { if (version === speechVersion.current) { speechBusy.current = false; pendingSpeech.current = null; activeSpeechCue.current = null; if (speechTimer.current) clearTimeout(speechTimer.current); } },
        onStopped: () => { if (version === speechVersion.current) { speechBusy.current = false; pendingSpeech.current = null; if (activeSpeechCue.current) spoken.current.delete(activeSpeechCue.current); activeSpeechCue.current = null; if (speechTimer.current) clearTimeout(speechTimer.current); } },
        onError: () => {
          if (version !== speechVersion.current) return;
          speechBusy.current = false; pendingSpeech.current = null;
          activeSpeechCue.current = null;
          if (speechTimer.current) clearTimeout(speechTimer.current);
          if (currentCue) spoken.current.delete(currentCue.key);
          setVoiceError(language === 'ky' ? 'Не удалось включить кыргызский голос. Проверьте языки озвучки телефона.' : 'TTS недоступен. Проверьте интернет и повторите.');
        } });
      if (speechBusy.current) speechTimer.current = setTimeout(() => {
        if (version !== speechVersion.current) return;
        speechBusy.current = false; pendingSpeech.current = null;
      }, 38000);
    }).catch(() => {
      if (version === speechVersion.current) { speechBusy.current = false; pendingSpeech.current = null; setVoiceError('Озвучка недоступна на этом устройстве.'); }
    });
    return true;
  }, [language]);
  const testVoice = useCallback(() => {
    if (!voiceRef.current) { setVoiceError('Включите голосовые подсказки для проверки.'); return; }
    stopSpeech();
    say(language === 'ky' ? 'Үн текшерүүсү. Кийинки бурулушта көрсөтмө угасыз.' : 'Проверка голоса. Перед следующим поворотом вы услышите подсказку.');
  }, [language, say, stopSpeech]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foregroundRef.current = state === 'active';
      if (state !== 'active') stopSpeech();
      setForeground(state === 'active');
    });
    return () => { subscription.remove(); stopSpeech(); };
  }, [stopSpeech]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void Speech.getAvailableVoicesAsync().then(voices => {
      if (!live) return;
      selectedVoice.current = bestVoiceForLanguage(voices, language);
      // Some Android engines report no installed voice but can still speak
      // when the requested language is supplied explicitly.
      setVoiceError(language === 'ky' && voices.length > 0 && !selectedVoice.current ? 'Кыргызский голос не найден на устройстве.' : '');
    }).catch(() => { if (live) { selectedVoice.current = undefined; setVoiceError(''); } });
    return () => { live = false; };
  }, [enabled, retry, language]);
  useEffect(() => {
    setGpsError('');
    setHasInaccurateFix(false);
    if (!enabled || !locationEnabled || !foreground) return;
    let live = true;
    let watcher: Location.LocationSubscription | undefined;
    const receiveLocation = (location: Location.LocationObject) => {
      if (!live) return;
      const { latitude, longitude, accuracy, heading, speed } = location.coords;
      const fix: NavigationFix = { latitude, longitude, timestamp: location.timestamp, accuracy: accuracy ?? Infinity,
        heading: heading != null && heading >= 0 ? heading : undefined, speed: speed != null && speed >= 0 ? speed : undefined };
      if (!usableNavigationFix(fix)) setHasInaccurateFix(true);
      void ingestDriverLocation(fix);
    };
    // A very recent precise fix keeps the idle map near the driver while the
    // foreground GPS stream starts after returning to the app.
    void Location.getLastKnownPositionAsync({ maxAge: 5000, requiredAccuracy: 35 })
      .then(location => { if (location) receiveLocation(location); }).catch(() => undefined);
    // Keep the low-latency watch while the map is visible. The background task
    // still covers a locked screen; both feeds pass through the same filter.
    void Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: tracking ? 1000 : 3000, distanceInterval: 0, mayShowUserSettingsDialog: true }, receiveLocation, () => { if (live && !usableNavigationFix(fixRef.current)) { setGpsError('Не удаётся получить GPS. Проверьте геолокацию.'); stopSpeech(true); } }).then(subscription => {
      if (live) watcher = subscription; else subscription.remove();
    }).catch(() => { if (live) setGpsError('Разрешите точное местоположение в настройках телефона.'); });
    return () => { live = false; watcher?.remove(); };
  }, [enabled, locationEnabled, foreground, userId, retry, tracking, stopSpeech]);
  useEffect(() => {
    if (!enabled || !locationEnabled || !foreground) return;
    // Both native foreground-service and fallback watch publish through one
    // validated stream; the screen never creates its own competing filter.
    return subscribeDriverFix(acceptFix);
  }, [enabled, locationEnabled, foreground, acceptFix]);
  useEffect(() => {
    if (!enabled || !foreground) return;
    const timer = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(timer);
  }, [enabled, foreground]);
  useEffect(() => {
    if (!active || !foreground || !mapVisible || followDriver || followPausedAt.current == null
      || Date.now() - followPausedAt.current < 12_000
      || !usableNavigationFix(position) || Date.now() - position.timestamp > 5_000) return;
    setFollowDriver(true);
  }, [active, foreground, mapVisible, followDriver, position, now, setFollowDriver]);
  useEffect(() => {
    if (!active || !foreground) return;
    let live = true;
    void activateKeepAwakeAsync('driver-navigation').then(() => { if (!live) void deactivateKeepAwake('driver-navigation').catch(() => undefined); }).catch(() => undefined);
    return () => { live = false; void deactivateKeepAwake('driver-navigation').catch(() => undefined); };
  }, [active, foreground]);
  useEffect(() => {
    requestVersion.current++;
    requestRef.current?.abort(); requestRef.current = null;
    featureRequestRef.current?.abort(); featureRequestRef.current = null;
    featureLoadedUntil.current = 0; featureRetryAfter.current = 0; setRoadFeatures([]);
    routeRef.current = null; progressRef.current = undefined; latestGuidanceRef.current = null; routeVersionRef.current = 0;
    recentFixes.current = [];
    setDriverTrackingRoute?.(null);
    setRoute(null); setProgress(null); setLoading(false); setRouteError('');
    lastRequest.current = 0; offRouteCount.current = 0; offRouteSince.current = 0; offRouteStart.current = null; spoken.current.clear(); announcedSigns.current.clear(); stopSpeech(); setRouteVersion(0); setRerouteReason('');
    return () => { requestVersion.current++; requestRef.current?.abort(); requestRef.current = null; stopSpeech(); };
  }, [session, locationEnabled, retry, stopSpeech]);
  useEffect(() => {
    featureRequestRef.current?.abort(); featureRequestRef.current = null;
    featureLoadedUntil.current = 0; featureRetryAfter.current = 0; setRoadFeatures([]);
    return () => { featureRequestRef.current?.abort(); featureRequestRef.current = null; };
  }, [routeVersion]);
  useEffect(() => {
    if (foreground) return;
    requestVersion.current++; requestRef.current?.abort(); requestRef.current = null;
    lastRequest.current = 0; setLoading(false);
  }, [foreground]);
  const loadRoute = useCallback(async (rerouting = false, reason = 'initial') => {
    const fix = fixRef.current, target = destinationRef.current, currentSession = sessionRef.current;
    if (!target || !currentSession || !foregroundRef.current || !usableNavigationFix(fix) || Date.now() - fix.timestamp > 15_000 || requestRef.current) return;
    const controller = new AbortController(); requestRef.current = controller;
    const version = ++requestVersion.current;
    lastRequest.current = Date.now(); setLoading(true); setRouteError('');
    setRerouteReason(reason);
    if (rerouting) { stopSpeech(); say(language === 'ky' ? 'Маршрутту кайра куруп жатам.' : 'Перестраиваю маршрут.'); }
    try {
      let origin = { latitude: fix.latitude, longitude: fix.longitude };
      let bearing = fix.heading != null && (fix.speed ?? 0) >= 1.5 ? fix.heading : undefined;
      const trace = recentFixes.current.filter(point => point.accuracy <= 30 && fix.timestamp - point.timestamp <= 10_000);
      const distinct = trace.filter((point, index) => index === 0 || distanceBetween(point, trace[index - 1]) > 3);
      if (rerouting && reason === 'off-route' && distinct.length >= 3
        && distanceBetween(distinct[0], distinct[distinct.length - 1]) >= 10) {
        const matchController = new AbortController();
        const timeout = setTimeout(() => matchController.abort(), 1200);
        try {
          const match = await api.request<{latitude:number;longitude:number;bearing:number|null;confidence:number;distanceM:number}|null>('/routes/match', {
            method: 'POST', signal: matchController.signal, body: JSON.stringify({ points: distinct.slice(-8).map(point => ({
              latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy,
              heading: point.heading, speed: point.speed })) }),
          });
          if (match && Number.isFinite(match.latitude) && Number.isFinite(match.longitude)
            && match.confidence >= .55 && match.distanceM <= offRouteThreshold(fix.accuracy)
            && fixRef.current?.timestamp === fix.timestamp) {
            origin = { latitude: match.latitude, longitude: match.longitude };
            if (match.bearing != null) bearing = match.bearing;
          }
        } catch { /* A delayed matcher must never block the reroute. */ }
        finally { clearTimeout(timeout); }
      }
      const basicRequest = { pickup: { ...origin, address: 'Положение водителя' }, dropoff: target, language };
      const advancedRequest = { ...basicRequest, ...(bearing != null ? { bearing } : {}), ...(rerouting ? { fast: true } : {}) };
      const requestRoute = (body: typeof basicRequest | typeof advancedRequest) => api.request<DrivingRoute>('/routes', {
        method: 'POST', signal: controller.signal, body: JSON.stringify(body),
      });
      let result: DrivingRoute;
      if (legacyRouteServer.current || bearing == null && !rerouting) result = await requestRoute(basicRequest);
      else {
        try { result = await requestRoute(advancedRequest); }
        catch (error) {
          if (!unsupportedRouteOptions(error) || controller.signal.aborted) throw error;
          legacyRouteServer.current = true;
          result = await requestRoute(basicRequest);
        }
      }
      if (version !== requestVersion.current || currentSession !== sessionRef.current || controller.signal.aborted) return;
      const prepared = prepareRoute(result);
      const latest = fixRef.current;
      if (rerouting && latest && latest.timestamp > fix.timestamp + 1500
        && routeProgress(prepared, latest, undefined, language).offRouteMeters > offRouteThreshold(latest.accuracy)) {
        lastRequest.current = Date.now() - 3500;
        return;
      }
      setDriverTrackingRoute?.(prepared.route);
      routeRef.current = prepared; progressRef.current = { along: 0, timestamp: fix.timestamp, stepIndex: 1 }; latestGuidanceRef.current = null;
      routeVersionRef.current = version; spoken.current.clear(); offRouteCount.current = 0; offRouteSince.current = 0; offRouteStart.current = null;
      setRoute(prepared.route); setProgress(null); setRouteVersion(version);
    } catch (error) {
      if (version === requestVersion.current && !controller.signal.aborted) {
        // Retain the last road route if an attempted refresh loses network;
        // off-route guidance remains muted until an on-route GPS fix returns.
        if (!rerouting || !routeRef.current) { routeRef.current = null; latestGuidanceRef.current = null; setRoute(null); setProgress(null); }
        setRouteError(messageOf(error)); stopSpeech();
      }
    } finally { if (version === requestVersion.current) { requestRef.current = null; setLoading(false); } }
  }, [say, stopSpeech, language]);
  const usable = locationEnabled && !gpsError && usableNavigationFix(position, now) && now - position.timestamp <= 15_000;
  useEffect(() => {
    const prepared = routeRef.current;
    if (!active || !foreground || !usable || !prepared || !progress ||
      progress.offRouteMeters > offRouteThreshold(position?.accuracy ?? 20) || featureRequestRef.current ||
      (featureLoadedUntil.current >= prepared.total || progress.along + 500 < featureLoadedUntil.current) ||
      Date.now() < featureRetryAfter.current) return;
    const window = roadFeatureWindow(prepared, progress.along);
    if (window.points.length < 2 || window.endAlong <= window.startAlong) return;
    const controller = new AbortController();
    featureRequestRef.current = controller;
    void api.request<{ features: RoadFeature[] }>('/routes/road-features', {
      method: 'POST', signal: controller.signal,
      body: JSON.stringify({ startAlong: window.startAlong, points: window.points }),
    }).then(result => {
      if (controller.signal.aborted || routeRef.current !== prepared) return;
      featureLoadedUntil.current = window.endAlong;
      setRoadFeatures(previous => {
        const byId = new Map(previous.filter(item => item.along >= window.startAlong - 10).map(item => [item.id, item]));
        for (const item of result.features || []) if (item && typeof item.id === 'string' && Number.isFinite(item.along)) byId.set(item.id, item);
        return [...byId.values()];
      });
    }).catch(() => {
      if (!controller.signal.aborted) featureRetryAfter.current = Date.now() + 15000;
    }).finally(() => { if (featureRequestRef.current === controller) featureRequestRef.current = null; });
  }, [active, foreground, usable, progress?.along, progress?.offRouteMeters, position?.accuracy, routeVersion, now]);
  useEffect(() => {
    if (!active || !foreground || !usable || !position) { stopSpeech(active && foreground && !usable); return; }
    if (!routeRef.current) {
      if (Date.now() - lastRequest.current >= 15000) void loadRoute();
      return;
    }
    if (requestRef.current) return;
    const next = routeProgress(routeRef.current, position, progressRef.current, language);
    if (progressRef.current && position.timestamp - progressRef.current.timestamp > 15_000
      && next.offRouteMeters > offRouteThreshold(position.accuracy)) {
      progressRef.current = { ...progressRef.current, timestamp: position.timestamp }; latestGuidanceRef.current = null;
      setProgress(null); stopSpeech();
      if (Date.now() - lastRequest.current >= 15_000) void loadRoute(true, 'gps-gap');
      return;
    }
    latestGuidanceRef.current = next;
    if (next.offRouteMeters > offRouteThreshold(position.accuracy)) {
      // Count distinct fixes, not timer renders, before triggering a reroute.
      if (progressRef.current?.timestamp !== position.timestamp) {
        offRouteCount.current++;
        if (!offRouteSince.current) { offRouteSince.current = position.timestamp; offRouteStart.current = position; }
      }
      progressRef.current = { ...progressRef.current, along: progressRef.current?.along ?? 0, timestamp: position.timestamp };
      setProgress(next); stopSpeech();
      if (shouldReroute(offRouteCount.current, offRouteSince.current, position.timestamp,
        offRouteStart.current ? distanceBetween(offRouteStart.current, position) : 0)
        && Date.now() - lastRequest.current >= 3500) void loadRoute(true, 'off-route');
      return;
    }
    offRouteCount.current = 0; offRouteSince.current = 0; offRouteStart.current = null;
    progressRef.current = { along: next.along, timestamp: position.timestamp, stepIndex: next.stepIndex,
      pendingStepIndex: next.pendingStepIndex, pendingStepCount: next.pendingStepCount }; setProgress(next);
    const cue = guidanceCue(next, language, routeVersionRef.current, legIndexRef.current);
    if (cue && voiceEnabled && !spoken.current.has(cue.key) && pendingSpeech.current !== cue.key) say(cue.text, cue);
  }, [active, foreground, usable, position, route, now, voiceEnabled, language, loadRoute, stopSpeech]);
  useEffect(() => {
    if (!active || !foreground || !usable || !voiceEnabled || loading || !progress ||
      progress.offRouteMeters > offRouteThreshold(position?.accuracy ?? 20)) return;
    const newlyVisible = visibleRoadFeatures(roadFeatures, progress.along)
      .filter(feature => feature.along >= progress.along && !announcedSigns.current.has(feature.id));
    if (!newlyVisible.length) return;
    say(roadFeatureAnnouncement(newlyVisible, progress.along, language), undefined,
      () => { for (const feature of newlyVisible) announcedSigns.current.add(feature.id); });
  }, [active, foreground, usable, voiceEnabled, loading, progress?.along, progress?.offRouteMeters,
    position?.timestamp, position?.accuracy, roadFeatures, routeVersion, language, now, say]);
  const changeVoice = useCallback((enabled: boolean) => {
    stopSpeech(); spoken.current.clear();
    voiceSettingVersion.current++;
    voiceRef.current = enabled;
    setVoiceEnabled(enabled);
    if (userId) void SecureStore.setItemAsync(`atlas.driver.routeVoice.v1.${userId}`, enabled ? '1' : '0').catch(() => undefined);
  }, [stopSpeech, userId]);
  const toggleVoice = useCallback(() => changeVoice(!voiceRef.current), [changeVoice]);
  const retryNavigation = useCallback(() => setRetry(value => value + 1), []);
  const ageSeconds = position ? Math.max(0, Math.floor((now - position.timestamp) / 1000)) : 0;
  const status = !locationEnabled ? 'Разрешите геолокацию для навигации'
    : !position ? gpsError || (hasInaccurateFix ? 'Слабый сигнал GPS. Ожидаем точное положение…' : 'Определяем положение по GPS…')
    : ageSeconds > 15 ? `Актуальное местоположение недоступно · последняя точка ${ageSeconds} с назад`
    : ageSeconds > 5 ? `Местоположение обновляется с задержкой · ${ageSeconds} с назад`
    : gpsError || (hasInaccurateFix ? 'Слабый сигнал GPS. Ожидаем точное положение…' : '');
  return { active, position: enabled && locationEnabled ? position : null, route, progress, loading, error: routeError, gpsStatus: status,
    roadFeatures: usable && !loading && progress && progress.offRouteMeters <= offRouteThreshold(position?.accuracy ?? 20)
      ? visibleRoadFeatures(roadFeatures, progress.along) : [],
    voiceError, voiceEnabled, toggleVoice, setVoiceEnabled: changeVoice, testVoice, followDriver, setFollowDriver, retry: retryNavigation, destination,
    headingToPickup: order?.status === 'ASSIGNED', backgroundReady, backgroundError, enableBackground, routeVersion, rerouteReason,
    offRouteCount: offRouteCount.current };
}
