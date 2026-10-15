import Animated, { Easing, useAnimatedStyle, useSharedValue, useReducedMotion, withSpring, withTiming, ReduceMotion, type SharedValue } from 'react-native-reanimated';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as Device from 'expo-device';
import { Camera, MapView, ShapeSource, LineLayer, FillLayer, SymbolLayer, UserLocation, addCustomHeader, type CameraRef, type MapViewRef } from '@maplibre/maplibre-react-native';
import { Button, Icon, PickupIcon, colors, shortAddress, tr } from '../ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { BISHKEK, MapPoint, reverseGeocode } from './mapkit';
import { getCurrentPosition } from './location';
import { centerPointInVisibleArea, isMapPoint, routeFrame } from './routeFrame';
import { DriverTrackingMarker } from './DriverTrackingMarker';
import { advanceFollowCamera, followCameraTarget, type CameraPose } from './followCamera';
import type { PlaybackFrame } from './trackingPlayback';
import { navigationDisplayMatch, remainingRoad, snapCarToRoad } from './roadMatch';
import { carMetresBetween as metresBetween } from './carRouteAnimation';
import { darkRasterMapFallback, mapStyleForLanguage, rasterMapFallback } from './taxiMapStyle';
import { alignCrossingsToRoads, crossingMarkings, validMapRoadFeature, type MapRoadFeature } from './mapRoadFeatures';
import type { Language } from '../types';
import { EndpointMarker } from './EndpointMarker';
import { canLocatePickup, clearRouteFocusCallout, compactPickupForZoom, initialRouteFocus, reconcileRouteFocus, stepRouteFocus } from './routeFocus';

export { searchAddresses, reverseGeocode } from './mapkit';
export type { MapPoint } from './mapkit';

export type MapSelectionPanel = {
  point: MapPoint;
  address: string;
  moving: boolean;
  ready: boolean;
  locatingAddress: boolean;
};

export type MapSelectionPreview = {
  field: 'pickup' | 'dropoff';
  point: MapPoint;
  address: string;
  pending: boolean;
};

export interface TaxiMapProps {
  theme?: 'light' | 'dark';
  language?: Language;
  passengerView?: boolean;
  passengerControlsVisible?: boolean;
  cameraSession?: string;
  cameraReady?: boolean;
  stableOverview?: boolean;
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  dropoffRouteLabel?: string;
  pickupEtaMinutes?: number | null;
  pickupAvailability?: 'unknown' | 'available' | 'unavailable';
  dropoffEstimate?: { durationMinutes: number; price: number | null } | null;
  geometry?: MapPoint[] | null;
  approachGeometry?: MapPoint[] | null;
  routeOverview?: boolean;
  onSelectPoint?: (point: MapPoint) => void;
  onEditPoint?: (field: 'pickup' | 'dropoff') => void;
  onSearchPoint?: () => void;
  onPanelHeight?: (height: number) => void;
  focusPoint?: MapPoint | null;
  browsePickup?: boolean;
  preferPickupCenter?: boolean;
  onPickupChange?: (point: MapPoint & { address: string }) => void;
  onSelectionPreview?: (selection: MapSelectionPreview) => void;
  onMapMovingChange?: (moving: boolean) => void;
  onBack?: () => void;
  backLabel?: string;
  browseControlsOffset?: SharedValue<number>;
  selectionMode?: boolean | string | null;
  selectionTitle?: string;
  renderSelectionPanel?: (selection: MapSelectionPanel) => React.ReactNode;
  selectionAppearance?: 'default' | 'food';
  onSelectionInteraction?: (action: 'move' | 'locate-start' | 'locate-success') => void;
  recenterKey?: number;
  showUserPosition?: boolean;
  onUserLocation?: (point: MapPoint) => void;
  contentTopInset?: number;
  contentBottomInset?: number;
  animatedBottomInset?: SharedValue<number>;
  centerInVisibleArea?: boolean;
  selecting?: boolean;
  driverPosition?: (MapPoint & { heading?: number; accuracy?: number | null; accuracyM?: number | null;
    snappedLatitude?: number; snappedLongitude?: number; routeAlong?: number; routeIndex?: number; routeProgress?: number;
    distanceToRoute?: number; matched?: boolean; matchedPath?: MapPoint[]; courseDeg?: number | null; speed?: number; speedMps?: number | null;
    measuredAtMs?: number; timestamp?: number; trackingSessionId?: string; sequence?: number; assignmentId?: string;
    stateVersion?: number; receivedAtMs?: number; courseAccuracyDeg?: number | null; courseSource?: 'gps' | 'displacement' | null;
    playbackAgeAtReceiptMs?: number; playbackReceivedAtMs?: number }) | null;
  navigationActive?: boolean;
  followDriver?: boolean;
  onFollowDriverChange?: (follow: boolean) => void;
}

const toCoordinate = (point: MapPoint) => [point.longitude, point.latitude];
const routeEndpoint = (point: MapPoint) => ({
  latitude: point.latitude, longitude: point.longitude,
  address: point.address && point.address.trim().length > 1 ? point.address.trim().slice(0, 250) : 'Точка на карте',
});
// Identify the app to tile services. Native MapLibre honours tile HTTP cache
// headers; no prefetching or offline bulk downloads are requested here.
addCustomHeader('User-Agent', 'Atlas/1.0 (' + api.baseUrl + ')');

function pointFromFeature(feature: GeoJSON.Feature): MapPoint | null {
  if (feature.geometry?.type !== 'Point') return null;
  const point = { latitude: feature.geometry.coordinates[1], longitude: feature.geometry.coordinates[0] };
  return isMapPoint(point) ? point : null;
}

type MapBounds = { south: number; west: number; north: number; east: number };
const EMPTY_CAR_ROUTE: MapPoint[] = [];
const PIN_WIDTH = 160;
const PIN_GROUND_X = 26;
const PIN_GROUND_Y = 90;
const PIN_HEIGHT = 96;
const PIN_EASE_OUT = Easing.bezier(.23, 1, .32, 1);

/** The bottom shadow stays at the coordinate while only the head and stem lift. */
function SelectionPin({ field, moving = false, pending = false, loading = false, dark, metrics, compact = false, etaMinutes, minuteLabel = 'мин' }: {
  field: 'pickup' | 'dropoff'; moving?: boolean; pending?: boolean; loading?: boolean; dark: boolean;
  metrics?: { label: string; value: string } | null;
  compact?: boolean; etaMinutes?: number | null; minuteLabel?: string;
}) {
  const reducedMotion = useReducedMotion();
  const lift = useSharedValue(0);
  const metricsProgress = useSharedValue(0);
  const timeOnly = field === 'pickup' && compact && !pending && !moving && etaMinutes != null && Number.isFinite(etaMinutes) && etaMinutes >= 0;
  const visibleMetrics = !pending && !moving && !timeOnly ? metrics : null;
  const [displayMetrics, setDisplayMetrics] = useState(metrics ?? null);
  useEffect(() => {
    if (visibleMetrics) setDisplayMetrics(visibleMetrics);
    metricsProgress.set(withTiming(visibleMetrics ? 1 : 0, {
      duration: reducedMotion ? 100 : 200, easing: PIN_EASE_OUT, reduceMotion: ReduceMotion.System,
    }));
  }, [visibleMetrics?.label, visibleMetrics?.value, reducedMotion, metricsProgress]);
  useEffect(() => {
    lift.set(withSpring(moving && !reducedMotion ? 1 : 0, {
      duration: 400, dampingRatio: 1, reduceMotion: ReduceMotion.System,
    }));
  }, [moving, reducedMotion, lift]);
  const headStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -12 * lift.get() }] }));
  const shadowStyle = useAnimatedStyle(() => ({ opacity: 1 - .42 * lift.get(), transform: [{ scale: 1 + .32 * lift.get() }] }));
  const metricsStyle = useAnimatedStyle(() => ({ opacity: metricsProgress.get(),
    transform: [{ translateX: reducedMotion ? 0 : -8 * (1 - metricsProgress.get()) }, { scale: reducedMotion ? 1 : .97 + .03 * metricsProgress.get() }],
  }));
  // Committed pins wrap this visual in an explicitly sized immediate native
  // child. Android MarkerView reads that child's width, not this nested frame.
  return <View testID={`${field}-pin-visual`} style={styles.pinFrame}>
    <Animated.View testID={`${field}-pin-shadow`} style={[styles.groundShadow, shadowStyle]}>
      <View style={styles.groundShadowMiddle}/><View style={styles.groundShadowCore}/>
    </Animated.View>
    <Animated.View testID={`${field}-pin-head`} style={[styles.pinHead, headStyle]}>
      {displayMetrics && <Animated.View testID={`${field}-pin-metrics`} pointerEvents="none" accessibilityElementsHidden={!visibleMetrics}
        importantForAccessibility={visibleMetrics ? 'auto' : 'no-hide-descendants'} style={[styles.pinMetricsBadge, dark && styles.darkPinBadge, metricsStyle]}>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.pinMetricLabel, dark && styles.darkPinMetricText]}>{displayMetrics.label}</Text>
        <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.pinMetricValue, dark && styles.darkPinMetricText]}>{displayMetrics.value}</Text>
      </Animated.View>}
      <View style={[styles.pinBadge, dark && styles.darkPinBadge]}>
        <View testID={`${field}-pin-icon`} style={[styles.pinIcon, dark && styles.darkPinBody]}>
          {loading ? reducedMotion ? <Icon name="ellipsis-horizontal" color={dark ? '#101010' : '#FFFFFF'} size={24}/> : <ActivityIndicator testID={`${field}-pin-loading`} color={dark ? '#101010' : '#FFFFFF'} size="small"/>
            : timeOnly ? <><Text style={[styles.compactPinTime, dark && { color: '#101010' }]}>{Math.max(1, Math.ceil(etaMinutes!))}</Text><Text style={[styles.compactPinUnit, dark && { color: '#101010' }]}>{minuteLabel}</Text></>
              : field === 'pickup' ? <PickupIcon color={dark ? '#101010' : '#FFFFFF'} size={24}/> : <Icon name="flag" color={dark ? '#101010' : '#FFFFFF'} size={24}/>}
        </View>
      </View>
      <View style={[styles.pinStem, dark && styles.darkStem]}/>
    </Animated.View>
  </View>;
}

export default function TaxiMap({
  theme = 'light',
  language = 'ru',
  pickup, dropoff, dropoffRouteLabel, pickupEtaMinutes, pickupAvailability = 'unknown', dropoffEstimate, geometry, approachGeometry, routeOverview = false, onSelectPoint, onEditPoint, onSearchPoint, onPanelHeight,
  focusPoint, browsePickup = false, preferPickupCenter = false, onPickupChange, onSelectionPreview, onMapMovingChange, onBack, backLabel, browseControlsOffset, selectionMode, selectionTitle, renderSelectionPanel, selectionAppearance = 'default', onSelectionInteraction, recenterKey,
  showUserPosition = false, onUserLocation, contentTopInset = 0, contentBottomInset = 0, animatedBottomInset, centerInVisibleArea = false, selecting = false, driverPosition, passengerView = false, passengerControlsVisible = true, cameraSession = '',
  navigationActive = false, followDriver = false, onFollowDriverChange, cameraReady = true, stableOverview = false,
}: TaxiMapProps) {
  const t = tr(language);
  const dark = theme === 'dark';
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const mapView = useRef<MapViewRef>(null);
  const [attached, setAttached] = useState(false);
  const [mapReadyRevision, setMapReadyRevision] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [routeError, setRouteError] = useState(false);
  const [serverRoute, setServerRoute] = useState<{ key: string; points: MapPoint[] } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadTimeout, setLoadTimeout] = useState(false);
  const [rasterFallback, setRasterFallback] = useState(false);
  const [candidate, setCandidate] = useState<MapPoint>(selectionMode === 'dropoff' ? dropoff ?? pickup ?? BISHKEK : pickup ?? BISHKEK);
  const candidateTarget = useRef(candidate);
  const [candidateAddress, setCandidateAddress] = useState('');
  const [addressSpinner, setAddressSpinner] = useState(false);
  const addressSpinnerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionGesture = useRef(false);
  const resolvedCandidate = useRef<MapPoint | null>(null);
  const previousSelectionMode = useRef(selectionMode);
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const reverseRevision = useRef(0);
  const movementCallback = useRef(onMapMovingChange);
  const previewCallback = useRef(onSelectionPreview);
  movementCallback.current = onMapMovingChange;
  previewCallback.current = onSelectionPreview;
  const selectionLocationRequest = useRef(0);
  const locationOperation = useRef(0);
  useEffect(() => () => { selectionLocationRequest.current++; }, []);
  const [panelHeight, setPanelHeight] = useState(180);
  const [passengerFollowing, setPassengerFollowing] = useState(true);
  const cameraFrame = useRef<((frame: PlaybackFrame, nowMs: number) => void) | null>(null);
  const followPose = useRef<CameraPose | null>(null);
  const followClock = useRef(0);
  const returningUntil = useRef(0);
  const [userLocation, setUserLocation] = useState<MapPoint | null>(null);
  const [mapRoadFeatures, setMapRoadFeatures] = useState<MapRoadFeature[]>([]);
  const [renderedRoads, setRenderedRoads] = useState<GeoJSON.FeatureCollection>({ type: 'FeatureCollection', features: [] });
  const [crossingZoom, setCrossingZoom] = useState(14);
  const mapFeatureCoverage = useRef<(MapBounds & { expiresAt: number }) | null>(null);
  const mapFeatureRequest = useRef(0);
  const mapFeatureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);
  const center = pickup ?? BISHKEK;
  const initialCamera = useRef({ centerCoordinate: toCoordinate(driverPosition ?? center), zoomLevel: 14 });
  const [routeFocus, setRouteFocus] = useState(initialRouteFocus);
  const [compactPickup, setCompactPickup] = useState(() => compactPickupForZoom(false, initialCamera.current.zoomLevel));
  const zoomLevel = useRef(initialCamera.current.zoomLevel);
  const observedZoom = useRef(initialCamera.current.zoomLevel);
  const observedPitch = useRef(0);
  const lastOverviewFrame = useRef<string | null>(null);
  const lastSentPose = useRef<(CameraPose & { paddingKey: string }) | null>(null);
  const cameraCenter = useRef<GeoJSON.Position>(initialCamera.current.centerCoordinate);
  const cameraHeading = useRef(0);
  const cameraPadding = useRef({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 });
  const zoomRequest = useRef(0);
  const locatingRef = useRef(false);
  const picking = !!selectionMode || browsePickup;
  const selectionField = selectionMode === 'dropoff' ? 'dropoff' : 'pickup';
  const routeControls = passengerView && !!pickup && !!dropoff && !picking && selectionAppearance === 'default' && !!onBack;
  const pickupLocationAllowed = canLocatePickup({ field: picking ? selectionField : null, dropoff, blocked: !passengerControlsVisible });
  const passengerLocationAllowed = !onBack || selectionAppearance === 'food' || pickupLocationAllowed;
  useEffect(() => {
    setRouteFocus(previous => reconcileRouteFocus(previous, { pickup, dropoff }));
  }, [pickup?.latitude, pickup?.longitude, dropoff?.latitude, dropoff?.longitude]);
  useEffect(() => {
    setRouteFocus(initialRouteFocus());
  }, [cameraSession.split(':')[0], recenterKey]);
  useEffect(() => {
    if (picking || !passengerControlsVisible) setRouteFocus(previous => clearRouteFocusCallout(previous));
  }, [picking, passengerControlsVisible]);
  const clearAddressSpinner = () => {
    if (addressSpinnerTimer.current) clearTimeout(addressSpinnerTimer.current);
    addressSpinnerTimer.current = null;
    setAddressSpinner(false);
  };
  const setSelectionCandidate = (point: MapPoint) => {
    candidateTarget.current = point;
    setCandidate(point);
  };
  const setMapMoving = (next: boolean) => {
    if (movingRef.current === next) return;
    movingRef.current = next;
    if (next) { reverseRevision.current++; setCandidateAddress(''); clearAddressSpinner(); }
    setMoving(next);
    movementCallback.current?.(next);
  };
  useEffect(() => {
    selectionLocationRequest.current++;
    locationOperation.current++;
    locatingRef.current = false;
    setLocating(false);
    selectionGesture.current = false;
    clearAddressSpinner();
    if (selectionMode) setSelectionCandidate(selectionMode === 'dropoff' ? dropoff ?? pickup ?? BISHKEK : pickup ?? BISHKEK);
    movingRef.current = false;
    setMoving(false);
    return () => {
      reverseRevision.current++;
      selectionLocationRequest.current++;
      locationOperation.current++;
      if (addressSpinnerTimer.current) clearTimeout(addressSpinnerTimer.current);
      addressSpinnerTimer.current = null;
      movingRef.current = false;
      movementCallback.current?.(false);
    };
  }, [picking, selectionMode]);
  const [showFoodPinHint, setShowFoodPinHint] = useState(false);
  const foodPinHintShown = useRef(false);
  useEffect(() => {
    if (!picking || selectionAppearance !== 'food' || !attached) { setShowFoodPinHint(false); return; }
    if (foodPinHintShown.current) return;
    foodPinHintShown.current = true;
    setShowFoodPinHint(true);
    const timer = setTimeout(() => setShowFoodPinHint(false), 2000);
    return () => clearTimeout(timer);
  }, [picking, selectionAppearance, attached]);
  const pickupChange = useRef(onPickupChange);
  const followPaused = useRef(false);
  const manualCamera = useRef(false);
  const followCameraKey = useRef('');
  const followedOrder = useRef(cameraSession.split(':')[0]);
  const lastRecenter = useRef(recenterKey);
  const followActive = passengerView ? passengerFollowing && !!driverPosition : followDriver;
  const driverLayerID = passengerView ? 'client-driver-car' : 'driver-navigation-arrow';
  const userLocationCallback = useRef(onUserLocation);
  userLocationCallback.current = onUserLocation;
  const alignedMapFeatures = useMemo(() => rasterFallback ? mapRoadFeatures : alignCrossingsToRoads(mapRoadFeatures, renderedRoads), [mapRoadFeatures, renderedRoads, rasterFallback]);
  const mapFeatureShape = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: alignedMapFeatures.filter(validMapRoadFeature).map(feature => ({
      type: 'Feature', id: feature.id, geometry: { type: 'Point', coordinates: toCoordinate(feature) },
      properties: { kind: feature.kind, bearing: ((feature.bearing ?? 0) % 360 + 360) % 360,
        bearingKnown: Number.isFinite(feature.bearing) },
    })),
  }), [alignedMapFeatures]);
  const crossingShape = useMemo(() => crossingMarkings(alignedMapFeatures, crossingZoom), [alignedMapFeatures, crossingZoom]);
  const loadMapFeatures = async () => {
    if (!mapView.current) return;
    if (zoomLevel.current < 14) {
      mapFeatureRequest.current++;
      mapFeatureCoverage.current = null;
      setMapRoadFeatures([]);
      return;
    }
    const readVersion = mapFeatureRequest.current;
    let request = readVersion;
    try {
      const [northEast, southWest] = await mapView.current.getVisibleBounds();
      if (readVersion !== mapFeatureRequest.current) return;
      if (!rasterFallback && viewport.width > 0 && viewport.height > 0) {
        try {
          const roads = await mapView.current.queryRenderedFeaturesInRect([0, viewport.width, viewport.height, 0], undefined,
            ['current-osm-road-major', 'current-osm-road-minor', 'current-osm-road-service']);
          if (readVersion !== mapFeatureRequest.current) return;
          setRenderedRoads(roads);
        } catch { /* Retain the previous geometry while vector tiles load. */ }
      }
      const visible = { south: southWest[1], west: southWest[0], north: northEast[1], east: northEast[0] };
      if (!Object.values(visible).every(Number.isFinite) || visible.south >= visible.north || visible.west >= visible.east) return;
      const covered = mapFeatureCoverage.current;
      if (covered && covered.expiresAt > Date.now() && visible.south >= covered.south && visible.west >= covered.west
        && visible.north <= covered.north && visible.east <= covered.east) return;
      const latSpan = visible.north - visible.south, lonSpan = visible.east - visible.west;
      if (latSpan >= .06 || lonSpan >= .08) return;
      const latPad = Math.min(latSpan * .2, (.06 - latSpan) * .49);
      const lonPad = Math.min(lonSpan * .2, (.08 - lonSpan) * .49);
      const bounds = { south: visible.south - latPad, west: visible.west - lonPad,
        north: visible.north + latPad, east: visible.east + lonPad };
      if (bounds.north - bounds.south > .06 || bounds.east - bounds.west > .08) return;
      request = ++mapFeatureRequest.current;
      mapFeatureCoverage.current = { ...bounds, expiresAt: Date.now() + 60000 };
      const query = Object.entries(bounds).map(([key, value]) => `${key}=${value.toFixed(6)}`).join('&');
      const result = await api.request<{ features: MapRoadFeature[] }>(`/routes/map-features?${query}`, { headers: { 'X-Atlas-Capabilities': 'road-features-v2' } });
      if (request !== mapFeatureRequest.current) return;
      setMapRoadFeatures(Array.isArray(result.features) ? result.features.filter(validMapRoadFeature) : []);
    } catch {
      if (request === mapFeatureRequest.current) mapFeatureCoverage.current = null;
    }
  };
  const scheduleMapFeatures = () => {
    if (mapFeatureTimer.current) return; // Throttle: following must not starve requests by restarting a debounce.
    mapFeatureTimer.current = setTimeout(() => { mapFeatureTimer.current = null; void loadMapFeatures(); }, 250);
  };
  useEffect(() => {
    if (attached) scheduleMapFeatures();
  }, [attached, mapReadyRevision]);
  useEffect(() => () => {
    if (mapFeatureTimer.current) clearTimeout(mapFeatureTimer.current);
    mapFeatureRequest.current++;
  }, []);
  useEffect(() => {
    if (!showUserPosition || !passengerView || !browsePickup) return;
    let live = true;
    void getCurrentPosition().then(point => {
      if (!live) return;
      setUserLocation(point);
      userLocationCallback.current?.(point);
    }).catch(error => {
      if (live) setLocationError(error instanceof Error ? error.message : 'Не удалось определить местоположение. Выберите адрес на карте.');
    });
    return () => { live = false; };
  }, [showUserPosition, passengerView, browsePickup]);
  useEffect(() => {
    // A status change within an order must not undo a deliberate map gesture.
    const orderId = cameraSession.split(':')[0];
    if (followedOrder.current !== orderId || lastRecenter.current !== recenterKey) {
      followedOrder.current = orderId;
      lastRecenter.current = recenterKey;
      manualCamera.current = false; followPaused.current = false;
      followPose.current = null; followCameraKey.current = '';
      if (passengerView) setPassengerFollowing(true);
    }
  }, [cameraSession, recenterKey]);
  pickupChange.current = onPickupChange;
  const suppliedRoute = useMemo(() => geometry && geometry.length > 1 && geometry.every(isMapPoint) ? geometry : [], [geometry]);
  const approachRoute = useMemo(() => approachGeometry && approachGeometry.length > 1 && approachGeometry.every(isMapPoint) ? approachGeometry : [], [approachGeometry]);
  const routeKey = pickup && dropoff ? [pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude].join(',') : '';
  const route = suppliedRoute.length > 1 ? suppliedRoute : !picking && serverRoute?.key === routeKey && (!navigationActive || routeOverview) ? serverRoute.points : EMPTY_CAR_ROUTE;
  const driverIdentity = `${cameraSession.split(':')[0]}:${driverPosition?.assignmentId || ''}`;
  const activeRoad = routeOverview ? approachRoute : route;
  // Guidance and network tracking retain measured GPS. Only the driver's visual
  // marker may make a small, unambiguous correction to the road centreline.
  const roadMatch = useMemo(() => driverPosition && navigationActive
    ? snapCarToRoad({ ...driverPosition, accuracy: driverPosition.accuracy ?? undefined }, activeRoad) : null,
  [driverPosition, activeRoad, navigationActive]);
  const markerPoint = useMemo(() => {
    if (!driverPosition || !isMapPoint(driverPosition)) return null;
    const display = navigationActive && !passengerView
      ? navigationDisplayMatch({ ...driverPosition, accuracy: driverPosition.accuracy ?? undefined }, activeRoad) : null;
    return display ? { ...driverPosition, latitude: display.latitude, longitude: display.longitude } : driverPosition;
  }, [driverPosition, activeRoad, navigationActive, passengerView]);
  const driverHeading = driverPosition?.courseDeg ?? driverPosition?.heading ?? null;
  const shownRoute = useMemo(() => !routeOverview && roadMatch ? remainingRoad(route, roadMatch.along) : route,
    [route, routeOverview, roadMatch]);
  const shownApproach = useMemo(() => routeOverview && roadMatch ? remainingRoad(approachRoute, roadMatch.along) : approachRoute,
    [approachRoute, routeOverview, roadMatch]);
  const routeShape = useMemo<GeoJSON.LineString>(() => ({ type: 'LineString', coordinates: shownRoute.map(toCoordinate) }), [shownRoute]);
  const approachShape = useMemo<GeoJSON.LineString>(() => ({ type: 'LineString', coordinates: shownApproach.map(toCoordinate) }), [shownApproach]);
  const moveTo = (point: MapPoint, zoom = 16) => {
    zoomLevel.current = zoom;
    const cameraPoint = centerInVisibleArea && !picking
      ? centerPointInVisibleArea(point, zoom, viewport.height, contentTopInset, contentBottomInset)
      : point;
    cameraCenter.current = toCoordinate(cameraPoint);
    if (!passengerView && navigationActive) cameraHeading.current = driverHeading ?? cameraHeading.current;
    cameraPadding.current = { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 };
    camera.current?.setCamera({
      centerCoordinate: cameraCenter.current, zoomLevel: zoom,
      ...(!passengerView && navigationActive ? { heading: cameraHeading.current } : {}),
      padding: cameraPadding.current,
      animationDuration: 300, animationMode: 'easeTo',
    });
  };
  const changeZoom = async (step: number) => {
    if (!attached) return;
    const next = Math.max(2, Math.min(19, zoomLevel.current + step));
    if (next === zoomLevel.current) return;
    zoomLevel.current = next;
    if (followActive && !followPaused.current) return; // The shared frame stream applies zoom alongside movement.
    manualCamera.current = true;
    const request = ++zoomRequest.current;
    const observedCenter = mapView.current ? await mapView.current.getCenter().catch(() => null) : null;
    if (request !== zoomRequest.current) return;
    if (followActive && markerPoint && isMapPoint(markerPoint)) cameraCenter.current = toCoordinate(markerPoint);
    else if (observedCenter && isMapPoint({ latitude: observedCenter[1], longitude: observedCenter[0] })) cameraCenter.current = observedCenter;
    camera.current?.setCamera({
      centerCoordinate: cameraCenter.current, heading: cameraHeading.current, zoomLevel: next,
      padding: cameraPadding.current,
      animationDuration: 250, animationMode: 'easeTo',
    });
  };
  const locateOnMap = async () => {
    if (!attached || locatingRef.current) return;
    if (passengerView && !driverPosition && !passengerLocationAllowed) return;
    setLocationError('');
    if (markerPoint && isMapPoint(markerPoint)) {
      followPaused.current = false;
      manualCamera.current = false;
      if (passengerView) setPassengerFollowing(true);
      else onFollowDriverChange?.(true);
      followPose.current = null; followCameraKey.current = '';
      zoomLevel.current = navigationActive ? 17 : 16;
      return;
    }
    locatingRef.current = true;
    setLocating(true);
    const request = ++selectionLocationRequest.current;
    const operation = ++locationOperation.current;
    if (picking) onSelectionInteraction?.('locate-start');
    try {
      const point = await getCurrentPosition();
      if (request !== selectionLocationRequest.current) return;
      if (!passengerView) {
        followPaused.current = false;
        manualCamera.current = false;
        onFollowDriverChange?.(true);
      } else manualCamera.current = true;
      moveTo(point);
      if (picking) { setSelectionCandidate(point); onSelectionInteraction?.('locate-success'); }
    } catch (error) {
      if (request !== selectionLocationRequest.current) return;
      setLocationError(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'Не удалось определить местоположение. Попробуйте ещё раз.');
    } finally {
      if (operation === locationOperation.current) {
        locatingRef.current = false;
        setLocating(false);
      }
    }
  };
  const focusEndpointCamera = (field: 'pickup' | 'dropoff', point: MapPoint) => {
    if (!attached || !isMapPoint(point) || viewport.height <= 0) return;
    manualCamera.current = true;
    followPaused.current = true;
    followPose.current = null;
    setPassengerFollowing(false);
    setRouteFocus({ next: field === 'pickup' ? 'dropoff' : 'route', callout: field });
    const zoom = 16;
    const cameraPoint = centerPointInVisibleArea(point, zoom, viewport.height, contentTopInset, contentBottomInset);
    cameraCenter.current = toCoordinate(cameraPoint);
    cameraHeading.current = 0;
    zoomLevel.current = zoom;
    cameraPadding.current = { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 };
    camera.current?.setCamera({ centerCoordinate: cameraCenter.current, zoomLevel: zoom, heading: 0, pitch: 0,
      padding: cameraPadding.current, animationDuration: 300, animationMode: 'easeTo' });
  };
  const cycleRouteFocus = () => {
    if (!attached || !routeControls || !passengerControlsVisible) return;
    const transition = stepRouteFocus(routeFocus, { pickup, dropoff });
    if (!transition.action) return;
    setRouteFocus(transition.state);
    if (transition.action.type === 'focus-point') {
      focusEndpointCamera(transition.action.field, transition.action.point);
      return;
    }
    const frame = routeFrame([...route, ...approachRoute, ...(pickup ? [pickup] : []), ...(dropoff ? [dropoff] : [])],
      viewport.width, viewport.height, contentTopInset, contentBottomInset);
    if (!frame) return;
    manualCamera.current = true;
    followPaused.current = true;
    followPose.current = null;
    setPassengerFollowing(false);
    cameraHeading.current = 0;
    cameraPadding.current = { paddingTop: frame.padding[0], paddingRight: frame.padding[1], paddingBottom: frame.padding[2], paddingLeft: frame.padding[3] };
    camera.current?.setCamera({ heading: 0, pitch: 0, animationDuration: 0 });
    camera.current?.fitBounds(frame.ne, frame.sw, frame.padding, 300);
  };

  useEffect(() => {
    const wasSelecting = !!previousSelectionMode.current;
    previousSelectionMode.current = selectionMode;
    if (!wasSelecting || selectionMode || !browsePickup) return;
    // Cancelling a destination edit must restore the committed pickup before
    // browsing starts publishing coordinates as a new pickup.
    const point = pickup ?? userLocation ?? BISHKEK;
    reverseRevision.current++;
    manualCamera.current = true;
    setSelectionCandidate(point);
    if (attached) moveTo(point);
  }, [selectionMode, browsePickup]);

  useEffect(() => {
    setCandidateAddress('');
    resolvedCandidate.current = null;
    clearAddressSpinner();
    const request = ++reverseRevision.current;
    if (!picking) return;
    // A mode change initializes the next endpoint in an earlier effect. Do not
    // geocode the previous render's candidate under the new endpoint's name.
    if (candidate.latitude !== candidateTarget.current.latitude || candidate.longitude !== candidateTarget.current.longitude) return;
    previewCallback.current?.({ field: selectionField, point: candidate, address: '', pending: true });
    if (moving) return;
    let live = true;
    let spinnerTimer: ReturnType<typeof setTimeout> | null = null;
    const publish = (address: string) => {
      if (!live || request !== reverseRevision.current) return;
      clearAddressSpinner();
      const point = { ...candidate, address };
      resolvedCandidate.current = point;
      setCandidateAddress(shortAddress(address));
      previewCallback.current?.({ field: selectionField, point, address: shortAddress(address), pending: false });
      if (browsePickup && !selectionMode) pickupChange.current?.(point);
    };
    const timer = setTimeout(() => {
      if (!live || request !== reverseRevision.current) return;
      // The settling debounce is not network loading. Fast replies never flash
      // a spinner; lift/drag always retains the original endpoint icon.
      spinnerTimer = setTimeout(() => {
        if (live && request === reverseRevision.current && !movingRef.current) setAddressSpinner(true);
      }, 150);
      addressSpinnerTimer.current = spinnerTimer;
      reverseGeocode(candidate, language).then(point => {
        publish(point.address?.trim() || t('Точка на карте'));
      }).catch(() => publish(t('Точка на карте')));
    }, 350);
    return () => {
      live = false; clearTimeout(timer);
      if (spinnerTimer) clearTimeout(spinnerTimer);
      if (addressSpinnerTimer.current === spinnerTimer) addressSpinnerTimer.current = null;
    };
  }, [picking, browsePickup, selectionMode, selectionField, moving, candidate.latitude, candidate.longitude, language]);

  useEffect(() => {
    if (attached) return;
    const timeout = setTimeout(() => setLoadTimeout(true), 20000);
    return () => clearTimeout(timeout);
  }, [attached, attempt]);

  useEffect(() => {
    if (!attached || !selectionMode) return;
    const point = selectionMode === 'dropoff' ? dropoff ?? pickup ?? BISHKEK : pickup ?? BISHKEK;
    setSelectionCandidate(point);
    moveTo(point);
  }, [selectionMode, attached, recenterKey]);

  useEffect(() => {
    if (!attached || !browsePickup || selectionMode) return;
    if (manualCamera.current) return;
    const point = preferPickupCenter && pickup ? pickup : userLocation ?? center;
    moveTo(point);
    setSelectionCandidate(point);
  }, [attached, mapReadyRevision, browsePickup, selectionMode, recenterKey, userLocation?.latitude, userLocation?.longitude]);

  useEffect(() => {
    if (!attached || !focusPoint || followActive) return;
    if (picking) selectionLocationRequest.current++;
    const point = browsePickup && userLocation && !manualCamera.current && !preferPickupCenter ? userLocation : focusPoint;
    if (picking) setSelectionCandidate(point);
    moveTo(point);
  }, [focusPoint, attached]);

  useEffect(() => {
    if (!attached || !cameraReady || viewport.width <= 0 || viewport.height <= 0 || picking || navigationActive && !routeOverview || followActive || manualCamera.current) return;
    // Offer geometry stays fixed while GPS and route-fetch objects keep updating.
    // Fit only after the current panel is measured, then refit for actual viewport,
    // panel detents, new route availability, a different offer or explicit recenter.
    const frameKey = stableOverview ? [cameraSession.split(':')[0], routeKey, recenterKey, mapReadyRevision,
      viewport.width, viewport.height, contentTopInset, contentBottomInset,
      route.length > 1, approachRoute.length > 1].join(':') : null;
    if (frameKey && lastOverviewFrame.current === frameKey) return;
    if (!stableOverview) lastOverviewFrame.current = null;
    if ((pickup && dropoff) || route.length > 1 || approachRoute.length > 1) {
      const frame = routeFrame([
        ...route, ...approachRoute,
        ...(!passengerView && driverPosition && isMapPoint(driverPosition) ? [driverPosition] : []),
        ...(pickup ? [pickup] : []), ...(dropoff ? [dropoff] : []),
      ], viewport.width, viewport.height, contentTopInset, contentBottomInset + (centerInVisibleArea ? 80 : 0));
      if (frame) {
        lastOverviewFrame.current = frameKey;
        cameraHeading.current = 0;
        cameraPadding.current = { paddingTop: frame.padding[0], paddingRight: frame.padding[1], paddingBottom: frame.padding[2], paddingLeft: frame.padding[3] };
        camera.current?.setCamera({ heading: 0, pitch: 0, animationDuration: 0 });
        camera.current?.fitBounds(frame.ne, frame.sw, frame.padding, 400);
      }
    } else moveTo(driverPosition && isMapPoint(driverPosition) ? driverPosition : userLocation ?? center, 15);
  }, [attached, cameraReady, stableOverview, mapReadyRevision, picking, navigationActive, routeOverview, followActive, routeKey, suppliedRoute, approachRoute, serverRoute, recenterKey, viewport.width, viewport.height, contentTopInset, contentBottomInset, centerInVisibleArea, cameraSession.split(':')[0], driverPosition?.latitude, driverPosition?.longitude, userLocation?.latitude, userLocation?.longitude]);

  useEffect(() => {
    if (followActive) { followPaused.current = false; manualCamera.current = false; followPose.current = null; }
  }, [followActive, recenterKey]);
  // A ref callback shares the marker's animation clock without rendering this
  // screen per frame. The SDK receives one pose, with no queued camera animations.
  cameraFrame.current = (frame, nowMs) => {
    if (!attached || !cameraReady || picking || !followActive || followPaused.current) { followPose.current = null; return; }
    const key = `${cameraSession.split(':')[0]}:${recenterKey}:${navigationActive}:${mapReadyRevision}`;
    if (followCameraKey.current !== key || !followPose.current) {
      followCameraKey.current = key;
      followPose.current = { longitude: cameraCenter.current[0], latitude: cameraCenter.current[1],
        heading: cameraHeading.current, zoom: observedZoom.current, pitch: observedPitch.current };
      lastSentPose.current = null;
      returningUntil.current = nowMs + 650;
      followClock.current = nowMs - 33;
      if (zoomLevel.current < 15) zoomLevel.current = navigationActive ? 17 : 16;
    }
    const driving = navigationActive && !passengerView;
    const target = followCameraTarget(frame, 'course', driving,
      driverPosition?.speedMps ?? driverPosition?.speed ?? 0, zoomLevel.current, followPose.current.heading);
    const pose = advanceFollowCamera(followPose.current, target, nowMs - followClock.current, nowMs < returningUntil.current);
    followClock.current = nowMs;
    followPose.current = pose;
    cameraCenter.current = [pose.longitude, pose.latitude];
    cameraHeading.current = pose.heading;
    cameraPadding.current = driving
      ? { paddingTop: contentTopInset + 16, paddingBottom: (animatedBottomInset?.get() ?? contentBottomInset) + 16, paddingLeft: 0, paddingRight: 0 }
      : { paddingTop: Math.min(contentTopInset + 48, viewport.height * .4), paddingBottom: Math.max(70, (animatedBottomInset?.get() ?? contentBottomInset) + 30), paddingLeft: 0, paddingRight: 0 };
    const paddingKey = Object.values(cameraPadding.current).join(':');
    const sent = lastSentPose.current;
    if (sent && Math.abs(sent.latitude - pose.latitude) < .00000025 && Math.abs(sent.longitude - pose.longitude) < .00000025
      && Math.abs(sent.heading - pose.heading) < .04 && Math.abs(sent.zoom - pose.zoom) < .001
      && Math.abs(sent.pitch - pose.pitch) < .02 && sent.paddingKey === paddingKey) return;
    lastSentPose.current = { ...pose, paddingKey };
    observedZoom.current = pose.zoom; observedPitch.current = pose.pitch;
    camera.current?.setCamera({ centerCoordinate: cameraCenter.current, heading: pose.heading,
      pitch: pose.pitch, zoomLevel: pose.zoom, padding: cameraPadding.current,
      animationDuration: 0, animationMode: 'moveTo' });
  };

  useEffect(() => {
    setRouteError(false);
    if (!pickup || !dropoff || suppliedRoute.length > 1 || picking || navigationActive && !routeOverview) return;
    let active = true;
    api.request<{ geometry: MapPoint[] }>('/routes', {
      method: 'POST', body: JSON.stringify({ pickup: routeEndpoint(pickup), dropoff: routeEndpoint(dropoff) }),
    }).then(result => {
      if (!active) return;
      if (!Array.isArray(result.geometry) || result.geometry.length < 2 || !result.geometry.every(isMapPoint)) throw new Error('Invalid route');
      setServerRoute({ key: routeKey, points: result.geometry });
    }).catch(() => { if (active) { setServerRoute(null); setRouteError(true); } });
    return () => { active = false; };
  }, [routeKey, suppliedRoute, picking, navigationActive, routeOverview]);

  const selectFeature = (feature: GeoJSON.Feature) => {
    if (!picking) return;
    const point = pointFromFeature(feature);
    if (point) {
      selectionLocationRequest.current++; reverseRevision.current++; selectionGesture.current = false;
      setCandidateAddress(''); clearAddressSpinner(); onSelectionInteraction?.('move'); setSelectionCandidate(point); moveTo(point);
    }
  };
  const onRegionChanging = (feature: GeoJSON.Feature<GeoJSON.Point, { isUserInteraction?: boolean; heading?: number; zoomLevel?: number; pitch?: number }>) => {
    if (feature.properties?.isUserInteraction) setRouteFocus(previous => clearRouteFocusCallout(previous));
    if (picking && feature.properties?.isUserInteraction) {
      selectionGesture.current = true;
      if (!movingRef.current) { selectionLocationRequest.current++; onSelectionInteraction?.('move'); }
      setMapMoving(true);
    }
    const regionCenter = pointFromFeature(feature);
    if (regionCenter && (!followActive || feature.properties?.isUserInteraction)) cameraCenter.current = toCoordinate(regionCenter);
    if ((!followActive || feature.properties?.isUserInteraction) && Number.isFinite(feature.properties?.heading)) cameraHeading.current = feature.properties.heading!;
    if ((!followActive || feature.properties?.isUserInteraction) && Number.isFinite(feature.properties?.zoomLevel)) observedZoom.current = zoomLevel.current = feature.properties.zoomLevel!;
    if ((!followActive || feature.properties?.isUserInteraction) && Number.isFinite(feature.properties?.pitch)) observedPitch.current = feature.properties.pitch!;
    if (feature.properties?.isUserInteraction) { manualCamera.current = true; followPose.current = null; }
    if (feature.properties?.isUserInteraction && !followPaused.current) {
      if (passengerView && passengerFollowing) { followPaused.current = true; setPassengerFollowing(false); }
      else if (followDriver) { followPaused.current = true; onFollowDriverChange?.(false); }
    }
  };
  const retry = () => { setLoadTimeout(false); setAttached(false); setRasterFallback(false); setAttempt(value => value + 1); };
  const pickupMetrics = pickupAvailability === 'unavailable' ? { label: t('Подача'), value: t('Нет машин') }
    : pickupEtaMinutes != null && Number.isFinite(pickupEtaMinutes) && pickupEtaMinutes >= 0
      ? { label: t('Подача'), value: `${Math.max(1, Math.ceil(pickupEtaMinutes))} ${t('мин')}` }
      : pickupAvailability === 'available' ? { label: t('Подача'), value: '—' } : null;
  const destinationMetrics = dropoffEstimate && Number.isFinite(dropoffEstimate.durationMinutes) && dropoffEstimate.durationMinutes >= 0
    && (dropoffEstimate.price === null || Number.isFinite(dropoffEstimate.price) && dropoffEstimate.price >= 0)
    ? { label: `${t('Ехать')} ${Math.max(1, Math.ceil(dropoffEstimate.durationMinutes))} ${t('мин')}`,
      value: dropoffEstimate.price === null ? '—' : `${Math.round(dropoffEstimate.price)} ${t('сом')}` } : null;
  const candidatePending = moving || !candidateAddress;
  const candidateMetrics = selectionField === 'dropoff' ? destinationMetrics : pickupMetrics;
  const passengerBottomControls = passengerView && selectionAppearance === 'default' && !!onBack;
  const routeControlLabel = routeFocus.next === 'pickup' ? t('Место подачи') : routeFocus.next === 'dropoff' ? t('Место назначения') : t('Показать весь маршрут');
  const bottomControlsInset = selectionMode ? panelHeight : contentBottomInset;
  const animatedPassengerControls = useAnimatedStyle(() => ({
    transform: [{ translateY: !selectionMode && browseControlsOffset ? browseControlsOffset.get() : 0 }],
  }));
  // A driver offer can leave a short map above its detail card. Keep all three
  // targets visible by laying the same controls in one row on short viewports.
  const controlsBottomGap = navigationActive ? 16 : passengerView ? (selectionMode ? panelHeight + 24 : 100) : 92;
  const deliveryPickupCrop = centerInVisibleArea && browsePickup && !selectionMode ? Math.max(0, contentBottomInset * .6) : 0;
  const visibleBottomInset = Math.max(0, contentBottomInset - deliveryPickupCrop);
  const compactControls = viewport.height > 0 && (animatedBottomInset
    ? viewport.height - contentTopInset < 560
    : viewport.height - visibleBottomInset - contentTopInset < (passengerView ? 216 : 297));
  const controlsHeight = compactControls ? 60 : navigationActive && !passengerView ? 260 : 193;
  const controlsTop = viewport.height > 0
    ? Math.min(
      Math.max(insets.top + 54, contentTopInset + 10, viewport.height - visibleBottomInset - controlsHeight - controlsBottomGap),
      Math.max(insets.top + 54, viewport.height - visibleBottomInset - controlsHeight - 12),
    )
    : contentTopInset + 56;
  const controlsReady = passengerView || !animatedBottomInset || cameraReady;
  const animatedControls = useAnimatedStyle(() => {
    const opacity = controlsReady && (!passengerView || passengerControlsVisible) ? 1 : 0;
    if (!animatedBottomInset || viewport.height <= 0) return { opacity };
    const bottom = Math.max(0, animatedBottomInset.get() - deliveryPickupCrop);
    const top = Math.min(
      Math.max(insets.top + 54, contentTopInset + 10, viewport.height - bottom - controlsHeight - controlsBottomGap),
      Math.max(insets.top + 54, viewport.height - bottom - controlsHeight - 12),
    );
    // A React top offset and a UI-thread correction can commit in different
    // frames when a sheet settles. Keep the origin fixed and position entirely
    // from the sheet's current UI-thread inset.
    return { opacity, transform: [{ translateY: top }] };
  });
  const activeMapStyle = rasterFallback ? dark ? darkRasterMapFallback : rasterMapFallback : mapStyleForLanguage(language, dark);
  const featureLayerBelow = typeof activeMapStyle === 'string' || rasterFallback
    ? driverLayerID : 'current-osm-street-major';

  return <View style={styles.root}>
    <View testID="map-viewport" onLayout={({ nativeEvent: { layout } }) => setViewport(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height })} style={[StyleSheet.absoluteFill, { bottom: selectionAppearance === 'food' && selectionMode ? panelHeight : deliveryPickupCrop }]}>
      <MapView
        ref={mapView}
        preferredFramesPerSecond={Device.isDevice ? undefined : 30}
        key={`${attempt}:${rasterFallback ? 'raster' : 'vector'}`}
        style={StyleSheet.absoluteFill}
        mapStyle={activeMapStyle}
        pitchEnabled={navigationActive}
        rotateEnabled
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onDidFinishLoadingStyle={() => { followCameraKey.current = ''; setMapReadyRevision(value => value + 1); setAttached(true); setLoadTimeout(false); }}
        onDidFinishLoadingMap={() => { setAttached(true); setLoadTimeout(false); scheduleMapFeatures(); }}
        onDidFailLoadingMap={() => { if (!rasterFallback) { setAttached(false); setRasterFallback(true); } else setLoadTimeout(true); }}
        regionWillChangeDebounceTime={0}
        regionDidChangeDebounceTime={80}
        onRegionWillChange={onRegionChanging}
        onRegionIsChanging={onRegionChanging}
        onRegionDidChange={feature => {
          const regionCenter = pointFromFeature(feature);
          if (regionCenter && (!followActive || feature.properties.isUserInteraction)) cameraCenter.current = toCoordinate(regionCenter);
          if ((!followActive || feature.properties.isUserInteraction) && Number.isFinite(feature.properties.heading)) cameraHeading.current = feature.properties.heading;
          if ((!followActive || feature.properties.isUserInteraction) && Number.isFinite(feature.properties.zoomLevel)) observedZoom.current = zoomLevel.current = feature.properties.zoomLevel;
          if (Number.isFinite(feature.properties.zoomLevel)) setCrossingZoom(feature.properties.zoomLevel);
          if (Number.isFinite(feature.properties.zoomLevel)) setCompactPickup(previous => compactPickupForZoom(previous, feature.properties.zoomLevel));
          if ((!followActive || feature.properties.isUserInteraction) && Number.isFinite(feature.properties.pitch)) observedPitch.current = feature.properties.pitch;
          scheduleMapFeatures();
          if (picking) {
            // Programmatic transitions already carry their selected point. An
            // old did-change from pickup/camera resizing cannot replace a newly
            // initialized destination or a point just tapped on the map.
            const activeGesture = selectionGesture.current;
            const atTarget = regionCenter && metresBetween(regionCenter, candidateTarget.current) < 1;
            if (activeGesture) {
              selectionGesture.current = false;
              setMapMoving(false);
              if (regionCenter) setSelectionCandidate(regionCenter);
            } else if (atTarget) setMapMoving(false);
          }
        }}
        onPress={selectFeature}
        onLongPress={selectFeature}
      >
        <Camera ref={camera} defaultSettings={initialCamera.current} maxZoomLevel={19} />
        <DriverTrackingMarker key={driverIdentity} point={markerPoint} session={driverIdentity} passengerView={passengerView} onFrame={cameraFrame} styleRevision={mapReadyRevision}/>
        {shownRoute.length > 1 && <ShapeSource id="route" shape={routeShape}>
          <LineLayer id="route-halo" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#101010' : '#FFFFFF', lineWidth: 15, lineOpacity: .94, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="route-outline" belowLayerID={driverLayerID} style={{ lineColor: '#0B55C5', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="route-line" belowLayerID={driverLayerID} style={{ lineColor: '#57AAFF', lineWidth: 5.5, lineCap: 'round', lineJoin: 'round' }} />
        </ShapeSource>}
        {shownApproach.length > 1 && <ShapeSource id="approach-route" shape={approachShape}>
          <LineLayer id="approach-route-halo" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#101010' : '#FFFFFF', lineWidth: 13, lineOpacity: .95, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="approach-route-outline" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#9B5D00' : '#B77908', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="approach-route-line" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#FFBC4B' : '#FFD54A', lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
        </ShapeSource>}
        <ShapeSource id="map-road-features" shape={mapFeatureShape}>
          <SymbolLayer id="map-traffic-lights" belowLayerID={featureLayerBelow}
            filter={['==', ['get', 'kind'], 'traffic_light']}
            minZoomLevel={14}
            style={{ iconImage: require('../../assets/road-signs/traffic-light.webp'),
              iconSize: ['interpolate', ['linear'], ['zoom'], 14.5, .014, 18, .025],
              iconAllowOverlap: true, iconIgnorePlacement: true }}/>
          <SymbolLayer id="map-crossings-without-bearing" belowLayerID={featureLayerBelow}
            filter={['all', ['==', ['get', 'kind'], 'pedestrian_crossing'], ['==', ['get', 'bearingKnown'], false]]} minZoomLevel={14}
            style={{ iconImage: require('../../assets/road-signs/pedestrian-crossing.png'), iconSize: .035,
              iconAllowOverlap: true, iconIgnorePlacement: true }}/>
        </ShapeSource>
        <ShapeSource id="map-crossing-markings" shape={crossingShape}>
          <FillLayer id="map-crossing-surface" belowLayerID={featureLayerBelow} minZoomLevel={14}
            filter={['==', ['get', 'role'], 'surface']}
            style={{ fillColor: dark ? '#62676E' : '#BFC6CC', fillOpacity: .85, fillAntialias: true }}/>
          <FillLayer id="map-pedestrian-crossings" belowLayerID={featureLayerBelow} minZoomLevel={14}
            filter={['==', ['get', 'role'], 'stripe']}
            style={{ fillColor: dark ? '#EDF0F2' : '#FFFFFF', fillAntialias: true }}/>
        </ShapeSource>
        {showUserPosition && passengerView && <UserLocation visible renderMode="native" androidRenderMode="compass" showsUserHeadingIndicator androidPreferredFramesPerSecond={30} onUpdate={location => {
          const point = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          const timestamp = location.timestamp;
          if (!isMapPoint(point) || location.coords.accuracy != null && location.coords.accuracy > 80
            || timestamp != null && timestamp > 1_000_000_000_000 && Date.now() - timestamp > 30_000) return;
          setUserLocation(previous => previous && metresBetween(previous, point) < 2 ? previous : point);
          onUserLocation?.(point);
        }}/>}
        {pickup && (!browsePickup || !!selectionMode) && selectionMode !== 'pickup' && <EndpointMarker id="pickup" field="pickup" point={pickup} dark={dark} language={language}
          presentation={routeFocus.callout === 'pickup' ? 'focused' : compactPickup && pickupEtaMinutes != null && Number.isFinite(pickupEtaMinutes) && pickupEtaMinutes >= 0 && pickupAvailability !== 'unavailable' ? 'compact' : 'detailed'}
          metrics={pickupMetrics} pickupEtaMinutes={pickupAvailability === 'unavailable' ? null : pickupEtaMinutes}
          onPress={!picking && routeControls && passengerControlsVisible ? () => focusEndpointCamera('pickup', pickup) : undefined}
          onEdit={!picking && passengerControlsVisible && onEditPoint ? () => onEditPoint('pickup') : undefined}/>}
        {dropoff && selectionMode !== 'dropoff' && <EndpointMarker id="dropoff" field="dropoff" point={dropoff} dark={dark} language={language}
          presentation={routeFocus.callout === 'dropoff' ? 'focused' : 'detailed'} metrics={destinationMetrics} routeLabel={dropoffRouteLabel}
          onPress={!picking && routeControls && passengerControlsVisible ? () => focusEndpointCamera('dropoff', dropoff) : undefined}
          onEdit={!picking && passengerControlsVisible && onEditPoint ? () => onEditPoint('dropoff') : undefined}/>}
      </MapView>
      {picking && <View pointerEvents="none" accessibilityLabel={selectionAppearance === 'food' ? t('Адрес доставки') : selectionMode !== 'dropoff' ? 'Метка места подачи' : 'Метка пункта назначения'} style={styles.centerPin}>
        {showFoodPinHint && <View testID="food-pin-hint" style={styles.foodPinHint}><Text style={styles.foodPinHintText}>{t('Пин можно перемещать')}</Text></View>}
        <SelectionPin field={selectionAppearance === 'food' ? 'dropoff' : selectionField} dark={dark} moving={moving} pending={candidatePending} loading={addressSpinner && !moving} metrics={selectionAppearance === 'food' ? null : candidateMetrics}
          compact={compactPickup} etaMinutes={pickupAvailability === 'unavailable' ? null : pickupEtaMinutes} minuteLabel={t('мин')}/>
      </View>}
      <View style={styles.attribution}>
        <Pressable accessibilityRole="link" accessibilityLabel="Стиль OpenMapTiles Bright" onPress={() => { void Linking.openURL('https://github.com/hyperknot/openfreemap-styles/blob/main/LICENSE.md'); }}><Text style={[styles.attributionText, dark && styles.darkAttributionText]}>© OpenMapTiles Bright</Text></Pressable>
        <Text style={[styles.attributionText, dark && styles.darkAttributionText]}> · </Text>
        <Pressable accessibilityRole="link" accessibilityLabel="© OpenStreetMap contributors" onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright'); }}><Text style={[styles.attributionText, dark && styles.darkAttributionText]}>© OpenStreetMap</Text></Pressable>
      </View>
    </View>
    <Animated.View testID="map-controls" pointerEvents={controlsReady && (!passengerView || passengerControlsVisible) ? 'auto' : 'none'} accessibilityElementsHidden={!controlsReady || passengerView && !passengerControlsVisible} importantForAccessibility={controlsReady && (!passengerView || passengerControlsVisible) ? 'auto' : 'no-hide-descendants'}
      style={[styles.mapControls, compactControls && styles.compactMapControls, selectionAppearance === 'food' ? { bottom: panelHeight + 12 } : { top: animatedBottomInset ? 0 : controlsTop }, animatedControls]}>
      {selectionAppearance !== 'food' && <View testID="map-zoom-controls" style={[styles.zoomControls, compactControls && styles.compactZoomControls, dark && styles.darkControl]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Приблизить карту" hitSlop={5} onPress={() => { void changeZoom(1); }} style={({ pressed }) => [styles.zoomButton, compactControls && styles.compactZoomButton, pressed && styles.controlPressed]}>
          <Icon name="add" size={30} color={dark ? '#FFFFFF' : '#111827'}/>
        </Pressable>
        <View style={[styles.zoomDivider, compactControls && styles.compactZoomDivider, dark && styles.darkZoomDivider]}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Отдалить карту" hitSlop={5} onPress={() => { void changeZoom(-1); }} style={({ pressed }) => [styles.zoomButton, compactControls && styles.compactZoomButton, pressed && styles.controlPressed]}>
          <Icon name="remove" size={30} color={dark ? '#FFFFFF' : '#111827'}/>
        </Pressable>
      </View>}
      {!passengerBottomControls && (!passengerView || driverPosition || passengerLocationAllowed) && <Pressable accessibilityRole="button" accessibilityLabel={driverPosition ? 'Показать водителя' : 'Моё местоположение'} accessibilityState={{ busy: locating }} hitSlop={5} onPress={() => { void locateOnMap(); }} style={({ pressed }) => [styles.locationControl, dark && styles.darkControl, pressed && styles.controlPressed]}>
        {locating ? <ActivityIndicator color={dark ? '#FFFFFF' : '#111827'}/> : <Icon name="navigate" size={27} color={dark ? '#FFFFFF' : '#111827'}/>}
      </Pressable>}
    </Animated.View>
    {passengerBottomControls && passengerControlsVisible && <Animated.View testID="passenger-map-bottom-controls" pointerEvents="box-none"
      style={[styles.passengerBottomControls, { bottom: Math.max(0, bottomControlsInset) + 16 }, animatedPassengerControls]}>
      <Pressable testID="passenger-map-back" accessibilityRole="button" accessibilityLabel={backLabel || t('Назад')} hitSlop={5} onPress={onBack}
        style={({ pressed }) => [styles.passengerLocationControl, dark && styles.darkControl, pressed && styles.controlPressed]}>
        <Svg width={22} height={22} viewBox="0 0 24 24" aria-hidden>
          <Path d="M19 12H5m7-7-7 7 7 7" fill="none" stroke={dark ? '#FFFFFF' : '#111827'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/>
        </Svg>
      </Pressable>
      {routeControls ? <Pressable testID="passenger-map-route-focus" accessibilityRole="button" accessibilityLabel={routeControlLabel} hitSlop={5} disabled={!attached}
        onPress={cycleRouteFocus} style={({ pressed }) => [styles.passengerLocationControl, dark && styles.darkControl, pressed && styles.controlPressed]}>
        {routeFocus.next === 'pickup' ? <PickupIcon size={23} color={dark ? '#FFFFFF' : '#111827'}/> : <Icon name={routeFocus.next === 'dropoff' ? 'flag' : 'git-network-outline'} size={23} color={dark ? '#FFFFFF' : '#111827'}/>}
      </Pressable> : passengerLocationAllowed && <Pressable accessibilityRole="button" accessibilityLabel={driverPosition ? 'Показать водителя' : 'Моё местоположение'} accessibilityState={{ busy: locating }} hitSlop={5}
        onPress={() => { void locateOnMap(); }} style={({ pressed }) => [styles.passengerLocationControl, dark && styles.darkControl, pressed && styles.controlPressed]}>
        {locating ? <ActivityIndicator color={dark ? '#FFFFFF' : '#111827'}/> : <Icon name="navigate" size={23} color={dark ? '#FFFFFF' : '#111827'}/>}
      </Pressable>}
    </Animated.View>}
    {!!locationError && <Pressable accessibilityRole="alert" onPress={() => setLocationError('')} style={[styles.locationNotice, { top: Math.max(insets.top + 54, controlsTop - 72), right: 16 }]}><Text style={styles.locationNoticeText}>{locationError}</Text></Pressable>}
    {selectionMode && <View onLayout={event => { setPanelHeight(event.nativeEvent.layout.height); onPanelHeight?.(event.nativeEvent.layout.height); }} style={renderSelectionPanel ? styles.customConfirm : [styles.confirm, dark && styles.darkConfirm, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      {renderSelectionPanel ? renderSelectionPanel({ point: candidate, address: candidateAddress, moving, ready: attached && !locating && !candidatePending, locatingAddress: candidatePending }) : <>
      <Text style={{ fontSize: 22, fontWeight: '700', color: dark ? '#FFFFFF' : colors.ink }}>{t(selectionTitle || (selectionMode === 'pickup' ? 'Точка посадки' : 'Точка назначения'))}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Найти адрес')} onPress={onSearchPoint} style={styles.addressSearch}>
        {selectionMode === 'pickup' ? <PickupIcon size={22} color={dark ? '#FFFFFF' : colors.blue}/> : <Icon name="flag" size={22} color={dark ? '#FFFFFF' : colors.blue}/>}
        <Text numberOfLines={2} style={[styles.hintText, dark && styles.darkHintText, { flex: 1 }]}>{candidatePending ? t('Уточняем…') : candidateAddress}</Text><Icon name="chevron-forward" color={dark ? '#FFFFFF' : undefined} size={18}/>
      </Pressable>
      <Button label={t('Готово')} disabled={!attached || candidatePending || locating} busy={selecting} onPress={() => {
        if (!attached || candidatePending || locating || selecting) return;
        onSelectPoint?.({ ...candidate, address: resolvedCandidate.current?.address || candidateAddress });
      }}/>
      </>}
    </View>}
    {(!attached || loadTimeout) && <View style={[styles.loading, dark && styles.darkLoading, { top: contentTopInset + 55 }]}>{loadTimeout ? <><Text style={[styles.noticeText, dark && styles.darkNoticeText]}>{t('Не удалось открыть карту. Повторите попытку.')}</Text><Pressable accessibilityRole="button" onPress={retry} style={[styles.retry, dark && styles.darkRetry]}><Text style={{ color: dark ? '#FFFFFF' : colors.blue }}>{t('Повторить загрузку')}</Text></Pressable></> : <ActivityIndicator color={dark ? '#FFFFFF' : colors.blue}/>}</View>}
    {routeError && !navigationActive && <View pointerEvents="none" style={[styles.notice, dark && styles.darkNotice, { top: contentTopInset + 58 }]}><Text style={[styles.noticeText, dark && styles.darkNoticeText]}>{t('Маршрут временно недоступен')}</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  attribution: { position: 'absolute', right: 8, bottom: 6, paddingHorizontal: 4, paddingVertical: 2, flexDirection: 'row' },
  attributionText: { fontSize: 10, color: '#475569', textShadowColor: '#FFFFFF', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  darkAttributionText: { color: '#E6E6E6', textShadowColor: '#101010' },
  root: { flex: 1 },
  passengerBottomControls: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mapControls: { position: 'absolute', right: 16, alignItems: 'center', gap: 14 },
  compactMapControls: { flexDirection: 'row', gap: 12 },
  zoomControls: { width: 58, borderRadius: 30, overflow: 'hidden', backgroundColor: '#FFFFFF', elevation: 5, shadowColor: '#000000', shadowOpacity: .2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  darkControl: { backgroundColor: '#101010', borderWidth: 1, borderColor: '#505050' },
  compactZoomControls: { width: 117, height: 58, flexDirection: 'row' },
  zoomButton: { width: 58, height: 59, alignItems: 'center', justifyContent: 'center' },
  compactZoomButton: { height: 58 },
  zoomDivider: { height: 1, marginHorizontal: 10, backgroundColor: '#E5E7EB' },
  darkZoomDivider: { backgroundColor: '#505050' },
  compactZoomDivider: { width: 1, height: 38, marginHorizontal: 0, alignSelf: 'center' },
  locationControl: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', elevation: 5, shadowColor: '#000000', shadowOpacity: .2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  passengerLocationControl: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', elevation: 3, shadowColor: '#000000', shadowOpacity: .12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  controlPressed: { opacity: .72 },
  locationNotice: { position: 'absolute', right: 84, maxWidth: 230, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12, backgroundColor: '#202126', elevation: 4 },
  locationNoticeText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18 },
  retry: { padding: 14, marginTop: 10, borderRadius: 15, backgroundColor: '#FFFFFF' },
  darkRetry: { backgroundColor: '#292929' },
  loading: { position: 'absolute', alignSelf: 'center', padding: 16, borderRadius: 18, backgroundColor: '#FFFFFF' },
  darkLoading: { backgroundColor: '#202020' },
  pinBody: { width: 48, height: 48, borderRadius: 17, borderWidth: 2, borderColor: 'white', backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  darkPinBody: { borderColor: '#101010', backgroundColor: '#FFFFFF' },
  stem: { width: 3, height: 19, backgroundColor: colors.ink, alignSelf: 'center' },
  darkStem: { backgroundColor: '#FFFFFF' },
  centerPin: { position: 'absolute', top: '50%', left: '50%', width: PIN_WIDTH, marginLeft: -PIN_GROUND_X, marginTop: -PIN_GROUND_Y },
  // Android MarkerView measures its immediate native child. Letting this
  // Pressable stretch to the map width offsets every geographic anchor.
  nativePinAnchor: { width: PIN_WIDTH, height: PIN_HEIGHT, alignSelf: 'flex-start' },
  pinFrame: { width: PIN_WIDTH, height: PIN_HEIGHT },
  pinHead: { position: 'absolute', left: 0, bottom: 6, width: PIN_WIDTH, height: 74 },
  pinBadge: { position: 'absolute', top: 0, left: 0, width: 52, height: 52, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', elevation: 5, shadowColor: '#16233C', shadowOpacity: .15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  darkPinBadge: { backgroundColor: '#24272D' },
  pinIcon: { width: 52, height: 52, borderRadius: 18, borderWidth: 2, borderColor: '#FFFFFF', backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center' },
  pinStem: { position: 'absolute', top: 52, left: PIN_GROUND_X - 1.5, width: 3, height: 22, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: colors.ink },
  pinMetricsBadge: { position: 'absolute', left: 28, top: 0, width: 132, height: 52, paddingLeft: 31, paddingRight: 8, borderTopRightRadius: 18, borderBottomRightRadius: 18, justifyContent: 'center', backgroundColor: '#FFFFFF', elevation: 4, shadowColor: '#16233C', shadowOpacity: .15, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  pinMetricLabel: { color: '#20252B', fontSize: 12, lineHeight: 16 },
  pinMetricValue: { color: '#20252B', fontSize: 15, lineHeight: 20, fontWeight: '700' },
  compactPinTime: { color: '#FFFFFF', fontSize: 20, lineHeight: 23, fontWeight: '700' },
  compactPinUnit: { color: '#FFFFFF', fontSize: 11, lineHeight: 13 },
  darkPinMetricText: { color: '#FFFFFF' },
  groundShadow: { position: 'absolute', left: PIN_GROUND_X - 10, width: 20, height: 12, borderRadius: 10, bottom: 0, backgroundColor: 'rgba(20, 28, 38, .06)', alignItems: 'center', justifyContent: 'center' },
  groundShadowMiddle: { position: 'absolute', width: 14, height: 9, borderRadius: 7, backgroundColor: 'rgba(20, 28, 38, .10)' },
  groundShadowCore: { width: 8, height: 6, borderRadius: 4, backgroundColor: 'rgba(20, 28, 38, .18)' },
  foodPinHint: { position: 'absolute', bottom: 84, width: 210, left: -81, borderRadius: 22, paddingVertical: 11, backgroundColor: '#FFFFFF', alignItems: 'center', elevation: 3, shadowColor: '#000', shadowOpacity: .08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } },
  foodPinHintText: { color: '#222222', fontSize: 14 },
  customConfirm: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  confirm: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingTop: 18, gap: 12, backgroundColor: 'white', borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  darkConfirm: { backgroundColor: '#101010' },
  addressSearch: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  instruction: { fontSize: 12, color: colors.muted, marginTop: -8 },
  unavailable: { flex: 1, backgroundColor: '#EAF1FB', justifyContent: 'center', alignItems: 'center', padding: 34 },
  unavailableTitle: { fontSize: 20, fontWeight: '700', color: '#192A48', marginBottom: 10 },
  unavailableText: { color: '#65738B', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  pickup: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#246BFD' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#246BFD' },
  destinationPin: { width: 48, height: 67, alignItems: 'center' },
  destinationWithRoute: { width: 174, height: 121, alignItems: 'center', justifyContent: 'flex-end' },
  dropoffRouteBadge: { position: 'absolute', top: 0, width: 174, height: 48, borderRadius: 16, padding: 4, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#E3E7F0', elevation: 5, shadowColor: '#13213A', shadowOpacity: .18, shadowRadius: 9, shadowOffset: { width: 0, height: 3 } },
  darkDropoffRouteBadge: { backgroundColor: '#101010', borderColor: '#505050', shadowColor: '#000000' },
  dropoffRouteLetter: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#246BFD', alignItems: 'center', justifyContent: 'center' },
  darkDropoffRouteLetter: { backgroundColor: '#FFFFFF' },
  dropoffRouteLetterText: { color: '#FFFFFF', fontSize: 22, fontWeight: '800' },
  darkDropoffRouteLetterText: { color: '#101010' },
  dropoffRouteMetrics: { flex: 1, paddingRight: 5, justifyContent: 'center' },
  dropoffRouteDistance: { color: '#202330', fontSize: 16, lineHeight: 20, fontWeight: '800' },
  dropoffRouteDuration: { color: '#202330', fontSize: 13, lineHeight: 17, fontWeight: '600' },
  darkDropoffRouteText: { color: '#FFFFFF' },
  destinationText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  hint: { position: 'absolute', top: 146, alignSelf: 'center', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#FFFFFF' },
  hintText: { color: '#192A48', fontSize: 16, lineHeight: 21 },
  darkHintText: { color: '#FFFFFF' },
  notice: { position: 'absolute', top: 192, alignSelf: 'center', backgroundColor: '#FFF8E9', borderRadius: 12, padding: 10 },
  darkNotice: { backgroundColor: '#292929' },
  noticeText: { color: '#956315', fontSize: 12 },
  darkNoticeText: { color: '#FFFFFF' },
});
