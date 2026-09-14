import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { api, messageOf } from './api';
import { ingestDriverLocation, requestDriverBackgroundAccess, setDriverTrackingSession, startDriverBackgroundTracking, subscribeDriverFix } from './native/driverTracking';
import type { Language, Order } from './types';
import { DrivingRoute, NavigationFix, NavigationProgress, PreparedRoute, bestVoiceForLanguage, guidanceCue, navigationDestination, prepareRoute, routeProgress, usableNavigationFix } from './navigation';

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
  const [followDriver, setFollowDriver] = useState(true);
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
  const [rerouteReason, setRerouteReason] = useState('');
  const destination = navigationDestination(order);
  const active = enabled && !!destination;
  const tracking = enabled && locationEnabled && !!userId && !!order && ['ASSIGNED', 'ARRIVED', 'IN_PROGRESS'].includes(order.status);
  useEffect(() => {
    let live = true;
    const next = tracking && userId && order ? { userId, order: { id: order.id, status: order.status, pickup: order.pickup, dropoff: order.dropoff }, voice: voiceEnabled, language } : null;
    void setDriverTrackingSession(next).then(() => next ? startDriverBackgroundTracking() : false).then(ready => {
      if (live) setBackgroundReady(previous => ready || (!!next && !foreground && previous));
    }).catch(() => { if (live) { setBackgroundReady(false); setBackgroundError('Не удалось включить работу в фоне'); } });
    return () => { live = false; };
  }, [tracking, userId, order?.id, order?.status, voiceEnabled, language, foreground, retry]);
  useEffect(() => () => { void setDriverTrackingSession(null).catch(() => undefined); }, []);
  const enableBackground = useCallback(async () => {
    try { await requestDriverBackgroundAccess(); setRetry(value => value + 1); setBackgroundError(''); }
    catch { setBackgroundError('Разрешите геолокацию «Всегда» в настройках телефона'); }
  }, []);
  const session = active ? `${userId}:${order?.id}:${order?.status}:${destination?.latitude}:${destination?.longitude}:${language}` : '';
  const sessionRef = useRef(session); sessionRef.current = session;
  const destinationRef = useRef(destination); destinationRef.current = destination;
  const fixRef = useRef(position); fixRef.current = position;
  const routeRef = useRef<PreparedRoute | null>(null);
  const progressRef = useRef<{ along: number; timestamp: number } | undefined>(undefined);
  const requestRef = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const lastRequest = useRef(0);
  const offRouteCount = useRef(0);
  const spoken = useRef(new Set<string>());
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
    setPosition(previous => previous && previous.timestamp >= fix.timestamp ? previous : fix);
    setGpsError('');
  }, []);
  const stopSpeech = useCallback((retryCurrentCue = false) => {
    if (retryCurrentCue && activeSpeechCue.current) spoken.current.delete(activeSpeechCue.current);
    activeSpeechCue.current = null;
    speechVersion.current++; speechBusy.current = false; pendingSpeech.current = null;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = undefined;
    void Speech.stop().catch(() => undefined);
  }, []);
  const say = useCallback((text: string, cue?: { key: string; priority: number; stepIndex: number }) => {
    if (!voiceRef.current || !foregroundRef.current || !sessionRef.current) return;
    if (speechBusy.current && (cue?.priority || 1) <= speechPriority.current) return;
    const interrupt = speechBusy.current;
    if (interrupt && activeSpeechCue.current) spoken.current.delete(activeSpeechCue.current);
    activeSpeechCue.current = null;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    speechTimer.current = undefined;
    const version = ++speechVersion.current;
    speechBusy.current = true; speechPriority.current = cue?.priority || 1;
    pendingSpeech.current = cue?.key || null;
    void (interrupt ? Speech.stop() : Promise.resolve()).then(() => {
      if (version !== speechVersion.current || !voiceRef.current || !foregroundRef.current || !sessionRef.current) return;
      Speech.speak(text, { language: language === 'ky' ? 'ky-KG' : Platform.OS === 'android' ? 'ru' : 'ru-RU', voice: selectedVoice.current, rate: .9, volume: 1, useApplicationAudioSession: false,
        onStart: () => {
          if (version !== speechVersion.current) return;
          pendingSpeech.current = null; setVoiceError('');
          if (cue) {
            activeSpeechCue.current = cue.key;
            spoken.current.add(cue.key);
            if (cue.priority >= 2) spoken.current.add(`${cue.stepIndex}:500`);
            if (cue.priority >= 3) spoken.current.add(`${cue.stepIndex}:100`);
          }
        },
        onDone: () => { if (version === speechVersion.current) { speechBusy.current = false; pendingSpeech.current = null; activeSpeechCue.current = null; if (speechTimer.current) clearTimeout(speechTimer.current); } },
        onStopped: () => { if (version === speechVersion.current) { speechBusy.current = false; pendingSpeech.current = null; if (activeSpeechCue.current) spoken.current.delete(activeSpeechCue.current); activeSpeechCue.current = null; if (speechTimer.current) clearTimeout(speechTimer.current); } },
        onError: () => {
          if (version !== speechVersion.current) return;
          speechBusy.current = false; pendingSpeech.current = null;
          activeSpeechCue.current = null;
          if (speechTimer.current) clearTimeout(speechTimer.current);
          if (cue) spoken.current.delete(cue.key);
          setVoiceError(language === 'ky' ? 'Не удалось включить кыргызский голос. Проверьте языки озвучки телефона.' : 'Не удалось включить голос. Проверьте русский голос в настройках телефона.');
        } });
      if (speechBusy.current) speechTimer.current = setTimeout(() => {
        if (version !== speechVersion.current) return;
        speechBusy.current = false; pendingSpeech.current = null;
      }, 12000);
    }).catch(() => {
      if (version === speechVersion.current) { speechBusy.current = false; pendingSpeech.current = null; setVoiceError('Озвучка недоступна на этом устройстве.'); }
    });
  }, [language]);
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
      setVoiceError('');
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
    // The foreground service is the GPS source during a trip. A foreground
    // watch is used only when that service is unavailable or the driver is idle.
    if (!tracking || !backgroundReady) void Location.watchPositionAsync({ accuracy: Location.Accuracy.BestForNavigation, timeInterval: tracking ? 1000 : 3000, distanceInterval: 0, mayShowUserSettingsDialog: true }, receiveLocation, () => { if (live && !usableNavigationFix(fixRef.current)) { setGpsError('Не удаётся получить GPS. Проверьте геолокацию.'); stopSpeech(true); } }).then(subscription => {
      if (live) watcher = subscription; else subscription.remove();
    }).catch(() => { if (live) setGpsError('Разрешите точное местоположение в настройках телефона.'); });
    return () => { live = false; watcher?.remove(); };
  }, [enabled, locationEnabled, foreground, userId, retry, tracking, backgroundReady, stopSpeech]);
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
    if (!active || !foreground) return;
    let live = true;
    void activateKeepAwakeAsync('driver-navigation').then(() => { if (!live) void deactivateKeepAwake('driver-navigation').catch(() => undefined); }).catch(() => undefined);
    return () => { live = false; void deactivateKeepAwake('driver-navigation').catch(() => undefined); };
  }, [active, foreground]);
  useEffect(() => {
    requestVersion.current++;
    requestRef.current?.abort(); requestRef.current = null;
    routeRef.current = null; progressRef.current = undefined;
    setRoute(null); setProgress(null); setLoading(false); setRouteError('');
    lastRequest.current = 0; offRouteCount.current = 0; spoken.current.clear(); stopSpeech(); setRouteVersion(0); setRerouteReason('');
    return () => { requestVersion.current++; requestRef.current?.abort(); requestRef.current = null; stopSpeech(); };
  }, [session, locationEnabled, retry, stopSpeech]);
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
      const result = await api.request<DrivingRoute>('/routes', { method: 'POST', signal: controller.signal, body: JSON.stringify({
        pickup: { latitude: fix.latitude, longitude: fix.longitude, address: 'Положение водителя' }, dropoff: target, language,
      }) });
      if (version !== requestVersion.current || currentSession !== sessionRef.current || controller.signal.aborted) return;
      const prepared = prepareRoute(result);
      routeRef.current = prepared; progressRef.current = { along: 0, timestamp: fix.timestamp }; spoken.current.clear(); offRouteCount.current = 0;
      setRoute(prepared.route); setProgress(null); setRouteVersion(version);
    } catch (error) {
      if (version === requestVersion.current && !controller.signal.aborted) {
        routeRef.current = null; setRoute(null); setProgress(null); setRouteError(messageOf(error)); stopSpeech();
      }
    } finally { if (version === requestVersion.current) { requestRef.current = null; setLoading(false); } }
  }, [say, stopSpeech, language]);
  const usable = locationEnabled && !gpsError && usableNavigationFix(position, now) && now - position.timestamp <= 15_000;
  useEffect(() => {
    if (!active || !foreground || !usable || !position) { stopSpeech(active && foreground && !usable); return; }
    if (!routeRef.current) {
      if (Date.now() - lastRequest.current >= 15000) void loadRoute();
      return;
    }
    if (requestRef.current) return;
    if (progressRef.current && position.timestamp - progressRef.current.timestamp > 15_000) {
      routeRef.current = null; progressRef.current = undefined; setRoute(null); setProgress(null); stopSpeech();
      if (Date.now() - lastRequest.current >= 15_000) void loadRoute(true, 'gps-gap');
      return;
    }
    const next = routeProgress(routeRef.current, position, progressRef.current, language);
    if (next.offRouteMeters > 60) {
      // Count distinct fixes, not timer renders, before triggering a reroute.
      if (progressRef.current?.timestamp !== position.timestamp) {
        offRouteCount.current = next.offRouteMeters > Math.max(60, position.accuracy * 2) ? offRouteCount.current + 1 : 0;
      }
      progressRef.current = { along: progressRef.current?.along || 0, timestamp: position.timestamp };
      setProgress(next); stopSpeech();
      if (offRouteCount.current >= 3 && Date.now() - lastRequest.current >= 15000) void loadRoute(true, 'off-route');
      return;
    }
    offRouteCount.current = 0;
    progressRef.current = { along: next.along, timestamp: position.timestamp }; setProgress(next);
    const cue = guidanceCue(next, language);
    if (cue && voiceEnabled && !spoken.current.has(cue.key) && pendingSpeech.current !== cue.key) say(cue.text, { ...cue, stepIndex: next.stepIndex });
  }, [active, foreground, usable, position, route, now, voiceEnabled, language, loadRoute, stopSpeech]);
  const toggleVoice = useCallback(() => {
    stopSpeech(); spoken.current.clear();
    setVoiceEnabled(value => { voiceRef.current = !value; return !value; });
  }, [stopSpeech]);
  const retryNavigation = useCallback(() => setRetry(value => value + 1), []);
  const ageSeconds = position ? Math.max(0, Math.floor((now - position.timestamp) / 1000)) : 0;
  const status = !locationEnabled ? 'Разрешите геолокацию для навигации'
    : !position ? gpsError || (hasInaccurateFix ? 'Слабый сигнал GPS. Ожидаем точное положение…' : 'Определяем положение по GPS…')
    : ageSeconds > 15 ? `Актуальное местоположение недоступно · последняя точка ${ageSeconds} с назад`
    : ageSeconds > 5 ? `Местоположение обновляется с задержкой · ${ageSeconds} с назад`
    : gpsError || (hasInaccurateFix ? 'Слабый сигнал GPS. Ожидаем точное положение…' : '');
  return { active, position: enabled && locationEnabled ? position : null, route, progress, loading, error: routeError, gpsStatus: status,
    voiceError, voiceEnabled, toggleVoice, followDriver, setFollowDriver, retry: retryNavigation, destination,
    headingToPickup: order?.status === 'ASSIGNED', backgroundReady, backgroundError, enableBackground, routeVersion, rerouteReason };
}
