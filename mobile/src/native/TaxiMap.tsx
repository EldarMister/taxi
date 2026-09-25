import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Device from 'expo-device';
import { Camera, MapView, PointAnnotation, MarkerView, ShapeSource, LineLayer, FillLayer, SymbolLayer, UserLocation, addCustomHeader, type CameraRef, type MapViewRef } from '@maplibre/maplibre-react-native';
import { Button, Icon, PickupIcon, colors, shortAddress } from '../ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api';
import { BISHKEK, MapPoint, reverseGeocode } from './mapkit';
import { getCurrentPosition } from './location';
import { accuracyCircle, isMapPoint, routeFrame } from './routeFrame';
import { matchedCarRoutePath, sampleCarRoutePath, trustedCarDirectPath, trustedCarRoutePath } from './carRouteAnimation';
import { pointAlongRoad, remainingRoad, roadHeadingAt, snapCarToRoad } from './roadMatch';
import { darkRasterMapFallback, mapStyleForLanguage, rasterMapFallback } from './taxiMapStyle';
import type { Language } from '../types';

export { searchAddresses, reverseGeocode } from './mapkit';
export type { MapPoint } from './mapkit';

export interface TaxiMapProps {
  theme?: 'light' | 'dark';
  language?: Language;
  passengerView?: boolean;
  cameraSession?: string;
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  dropoffRouteLabel?: string;
  geometry?: MapPoint[] | null;
  approachGeometry?: MapPoint[] | null;
  routeOverview?: boolean;
  onSelectPoint?: (point: MapPoint) => void;
  onEditPoint?: (field: 'pickup' | 'dropoff') => void;
  onSearchPoint?: () => void;
  onPanelHeight?: (height: number) => void;
  focusPoint?: MapPoint | null;
  browsePickup?: boolean;
  onPickupChange?: (point: MapPoint & { address: string }) => void;
  selectionMode?: boolean | string | null;
  recenterKey?: number;
  showUserPosition?: boolean;
  onUserLocation?: (point: MapPoint) => void;
  contentTopInset?: number;
  contentBottomInset?: number;
  selecting?: boolean;
  driverPosition?: (MapPoint & { heading?: number; accuracy?: number; accuracyM?: number | null;
    snappedLatitude?: number; snappedLongitude?: number; routeAlong?: number; routeIndex?: number; routeProgress?: number;
    distanceToRoute?: number; matched?: boolean; matchedPath?: MapPoint[]; courseDeg?: number | null; speed?: number; speedMps?: number | null;
    measuredAtMs?: number; timestamp?: number; trackingSessionId?: string; sequence?: number; assignmentId?: string;
    stateVersion?: number; receivedAtMs?: number }) | null;
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

type DriverPoint = NonNullable<TaxiMapProps['driverPosition']>;
type DisplayDriverPoint = DriverPoint & { roadAlong?: number; authoritativePosition?: boolean };
const EMPTY_CAR_ROUTE: MapPoint[] = [];
const trackingDiagnosticsEnabled = typeof process !== 'undefined' && process.env.EXPO_PUBLIC_TRACKING_DIAGNOSTICS === '1';

function metresBetween(a: MapPoint, b: MapPoint) {
  return Math.hypot(
    (b.latitude - a.latitude) * 111320,
    (b.longitude - a.longitude) * 111320 * Math.cos(a.latitude * Math.PI / 180),
  );
}
function pointAhead(point: MapPoint, heading: number, metres: number): MapPoint {
  const radians = heading * Math.PI / 180;
  return { latitude: point.latitude + Math.cos(radians) * metres / 111320,
    longitude: point.longitude + Math.sin(radians) * metres / (111320 * Math.max(.1, Math.cos(point.latitude * Math.PI / 180))) };
}

// A matched car moves along road geometry. Its icon bearing is sampled at the
// animated position, so it cannot face the next street while still on this one.
function useAnimatedCarPosition(point?: DisplayDriverPoint | null, session = '', road: MapPoint[] = EMPTY_CAR_ROUTE): DisplayDriverPoint | null {
  const [rendered, setRendered] = useState<DisplayDriverPoint | null>(point && isMapPoint(point) ? point : null);
  const renderedRef = useRef(rendered);
  const rawRef = useRef<DisplayDriverPoint | null>(point && isMapPoint(point) ? point : null);
  const renderedRoadRef = useRef<MapPoint[] | null>(point?.roadAlong != null ? road : null);
  const sessionRef = useRef(session);
  const arrivalRef = useRef(Date.now());
  const roadRef = useRef(road); roadRef.current = road;
  useEffect(() => {
    const arrivedAt = Date.now();
    const fixInterval = arrivedAt - arrivalRef.current;
    arrivalRef.current = arrivedAt;
    const changedSession = sessionRef.current !== session;
    sessionRef.current = session;
    if (!point || !isMapPoint(point)) { rawRef.current = null; renderedRef.current = null; renderedRoadRef.current = null; setRendered(null); return; }
    const previousRaw = rawRef.current;
    rawRef.current = point;
    const from = renderedRef.current;
    // A delayed fix is a new known point, not evidence that the car travelled
    // along any route between two widely separated observations.
    if (!from || !previousRaw || changedSession || typeof requestAnimationFrame !== 'function') {
      renderedRoadRef.current = point.roadAlong != null ? road : null;
      renderedRef.current = point; setRendered(point); return;
    }
    const roadMotion = point.roadAlong != null && from.roadAlong != null && renderedRoadRef.current === road
      && fixInterval >= 200 && fixInterval <= 15000 && point.roadAlong > from.roadAlong + 1
      && point.roadAlong - from.roadAlong <= Math.min(350, Math.max(35, fixInterval / 1000 * 55 + 20));
    if (roadMotion) {
      const startAlong = from.roadAlong!;
      const endAlong = point.roadAlong!;
      const start = Date.now();
      const duration = Math.max(700, Math.min(1100, fixInterval * .9));
      let frame = 0, lastPaint = 0;
      const step = () => {
        const elapsed = Date.now() - start;
        const fraction = Math.min(1, elapsed / duration);
        if (elapsed - lastPaint >= 40 || fraction === 1) {
          const along = startAlong + (endAlong - startAlong) * fraction;
          const coordinate = pointAlongRoad(road, along);
          if (coordinate) {
            const next = { ...point, ...coordinate, roadAlong: along, heading: roadHeadingAt(road, along) ?? point.heading };
            renderedRoadRef.current = road;
            renderedRef.current = next; setRendered(next); lastPaint = elapsed;
          }
        }
        if (fraction < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
      return () => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame); };
    }
    // Never draw a straight shortcut between two points already matched to a
    // road (for example across the inside of a right-angle turn).
    if (point.roadAlong != null || from.roadAlong != null) {
      renderedRoadRef.current = point.roadAlong != null ? road : null;
      renderedRef.current = point; setRendered(point); return;
    }
    // A client must not invent a straight journey across a block or rematch a
    // confirmed driver fix to the fare preview's potentially different road.
    const authoritativeMotion = point.authoritativePosition || from.authoritativePosition;
    const path = authoritativeMotion
      ? point.authoritativePosition && previousRaw.authoritativePosition
        ? matchedCarRoutePath(previousRaw, point, from, roadRef.current, fixInterval) : null
      : trustedCarRoutePath(previousRaw, point, from, roadRef.current, fixInterval)
        ?? trustedCarDirectPath(previousRaw, point, from, fixInterval);
    if (!path) { renderedRoadRef.current = null; renderedRef.current = point; setRendered(point); return; }
    const start = Date.now();
    const duration = Math.max(700, Math.min(1100, fixInterval * .9));
    const movementHeading = (Math.atan2(
      (point.longitude - from.longitude) * Math.cos(point.latitude * Math.PI / 180),
      point.latitude - from.latitude,
    ) * 180 / Math.PI + 360) % 360;
    const fromHeading = Number.isFinite(from.heading) && from.heading! >= 0 ? from.heading! : movementHeading;
    const priorAccuracy = previousRaw.accuracyM ?? previousRaw.accuracy ?? Infinity;
    const nextAccuracy = point.accuracyM ?? point.accuracy ?? Infinity;
    const confidentCourse = priorAccuracy <= 10 && nextAccuracy <= 10
      && metresBetween(previousRaw, point) >= Math.max(8, priorAccuracy + nextAccuracy);
    const finalSegment = path.points[path.points.length - 2];
    const routeEndHeading = path.points.length > 2 && finalSegment ? (Math.atan2(
      (point.longitude - finalSegment.longitude) * Math.cos(point.latitude * Math.PI / 180),
      point.latitude - finalSegment.latitude,
    ) * 180 / Math.PI + 360) % 360 : movementHeading;
    const toHeading = confidentCourse ? routeEndHeading
      : Number.isFinite(point.heading) && point.heading! >= 0 ? point.heading! : fromHeading;
    const headingDelta = ((toHeading - fromHeading + 540) % 360) - 180;
    let frame = 0;
    let lastPaint = 0;
    const step = () => {
      const elapsed = Date.now() - start;
      const fraction = Math.min(1, elapsed / duration);
      if (elapsed - lastPaint >= 40 || fraction === 1) {
        const coordinate = sampleCarRoutePath(path, fraction);
        const ahead = sampleCarRoutePath(path, Math.min(1, fraction + .03));
        const segmentHeading = metresBetween(coordinate, ahead) > .5 ? (Math.atan2(
          (ahead.longitude - coordinate.longitude) * Math.cos(coordinate.latitude * Math.PI / 180),
          ahead.latitude - coordinate.latitude,
        ) * 180 / Math.PI + 360) % 360 : toHeading;
        const next = {
          ...point,
          ...coordinate,
          heading: authoritativeMotion
            ? fraction === 1 ? point.heading : segmentHeading
            : path.points.length > 2 && fraction > .25 ? segmentHeading : (fromHeading + headingDelta * fraction + 360) % 360,
        };
        renderedRef.current = next; setRendered(next); lastPaint = elapsed;
      }
      if (fraction < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => { if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame); };
  }, [point?.latitude, point?.longitude, point?.heading, point?.accuracy, point?.accuracyM,
    point?.measuredAtMs, point?.sequence, point?.roadAlong, point?.authoritativePosition, session, road]);
  return rendered;
}

const AnimatedDriverMarker = React.memo(function AnimatedDriverMarker({ point, session, road, passengerView }:
  { point: DisplayDriverPoint | null; session: string; road: MapPoint[]; passengerView: boolean }) {
  // The driver's route line advances with each accepted GPS fix. Delaying the
  // arrow by another animation leaves it behind the already-trimmed line.
  const animatedPassenger = useAnimatedCarPosition(passengerView ? point : null, session, road);
  const marker = passengerView ? animatedPassenger : point;
  // Keep the symbol layer mounted before GPS arrives so late route layers can
  // always be inserted below it, including after a reroute or style reload.
  const shape = useMemo<GeoJSON.Point | GeoJSON.FeatureCollection>(() => marker && isMapPoint(marker)
    ? { type: 'Point', coordinates: toCoordinate(marker) } : { type: 'FeatureCollection', features: [] }, [marker?.latitude, marker?.longitude]);
  return passengerView ? <ShapeSource id="client-driver-position" shape={shape} testID="client-driver-position">
    <SymbolLayer id="client-driver-car" style={{
      iconImage: require('../../assets/tracking-car-white.png'), iconSize: .025,
      iconRotate: Number.isFinite(marker?.heading) && marker!.heading! >= 0 ? marker!.heading! : 0,
      iconRotationAlignment: 'map', iconPitchAlignment: 'map', iconAnchor: 'center', iconOffset: [0, 0],
      iconAllowOverlap: true, iconIgnorePlacement: true,
    }}/>
  </ShapeSource> : <ShapeSource id="driver-navigation-position" shape={shape}>
    <SymbolLayer id="driver-navigation-arrow" style={{ iconImage: require('../../assets/driver-navigation-arrow.png'), iconSize: .42,
      iconRotate: Number.isFinite(marker?.heading) && marker!.heading! >= 0 ? marker!.heading! : 0,
      iconRotationAlignment: 'map', iconPitchAlignment: 'map', iconAllowOverlap: true, iconIgnorePlacement: true }}/>
  </ShapeSource>;
});

const headingDifference = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function useStableDriverHeading(point?: DriverPoint | null, session = ''): { heading: number | null; reliable: boolean } {
  const last = useRef<{ point: DriverPoint; heading: number | null; reliable: boolean; confirmedAtMs?: number; session: string } | null>(null);
  if (!point || !isMapPoint(point)) return { heading: last.current?.heading ?? null, reliable: false };
  const previous = last.current;
  if (previous?.session === session && previous.point.latitude === point.latitude && previous.point.longitude === point.longitude
    && (previous.point === point || previous.point.measuredAtMs != null && previous.point.measuredAtMs === point.measuredAtMs))
    return { heading: previous.heading, reliable: previous.reliable };
  const travel = previous?.session === session ? metresBetween(previous.point, point) : 0;
  const reported = Number.isFinite(point.heading) && point.heading! >= 0 ? point.heading! : null;
  const speed = point.speedMps ?? point.speed ?? 0;
  const courseChanged = reported != null && speed >= 1.5 && previous?.heading != null
    && headingDifference(reported, previous.heading) >= 12;
  if (!previous || previous.session !== session || travel >= 5 || courseChanged) {
    let heading = previous?.session === session ? previous.heading : reported;
    const accuracy = point.accuracyM ?? point.accuracy ?? Infinity;
    const previousAccuracy = previous?.point.accuracyM ?? previous?.point.accuracy ?? Infinity;
    const previousMeasuredAt = previous?.point.measuredAtMs;
    const measuredAt = point.measuredAtMs;
    const confidentMovement = previous?.session === session && accuracy <= 15 && previousAccuracy <= 15
      && travel >= Math.max(8, accuracy + previousAccuracy)
      && (measuredAt == null || previousMeasuredAt == null || measuredAt > previousMeasuredAt && measuredAt - previousMeasuredAt <= 8000);
    const movement = confidentMovement && previous ? (Math.atan2(
        (point.longitude - previous.point.longitude) * Math.cos(point.latitude * Math.PI / 180),
        point.latitude - previous.point.latitude,
      ) * 180 / Math.PI + 360) % 360 : null;
    const fixAt = point.measuredAtMs ?? point.timestamp ?? Date.now();
    if (movement == null && previous?.confirmedAtMs != null && fixAt - previous.confirmedAtMs <= 6000
      && reported != null && previous.heading != null && headingDifference(reported, previous.heading) > 100)
      return { heading: previous.heading, reliable: true };
    if (movement != null && (reported == null || headingDifference(reported, movement) > 45)) heading = movement;
    else if (reported != null && (speed >= 1.5 || travel >= 5 || !previous || previous.session !== session)) heading = reported;
    const reliable = movement != null || reported != null && speed >= 1.5;
    last.current = { point, heading, reliable, confirmedAtMs: movement != null ? fixAt : previous?.confirmedAtMs, session };
  }
  const current = last.current;
  const sameFix = current?.point === point || current?.point.measuredAtMs != null
    && current.point.measuredAtMs === point.measuredAtMs;
  return { heading: current?.heading ?? null, reliable: !!current?.reliable && (sameFix || speed >= 1.5) };
}

export default function TaxiMap({
  theme = 'light',
  language = 'ru',
  pickup, dropoff, dropoffRouteLabel, geometry, approachGeometry, routeOverview = false, onSelectPoint, onEditPoint, onSearchPoint, onPanelHeight,
  focusPoint, browsePickup = false, onPickupChange, selectionMode, recenterKey,
  showUserPosition = false, onUserLocation, contentTopInset = 0, contentBottomInset = 0, selecting = false, driverPosition, passengerView = false, cameraSession = '',
  navigationActive = false, followDriver = false, onFollowDriverChange,
}: TaxiMapProps) {
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
  const [candidate, setCandidate] = useState<MapPoint>(pickup ?? BISHKEK);
  const [candidateAddress, setCandidateAddress] = useState('');
  const [moving, setMoving] = useState(false);
  const [panelHeight, setPanelHeight] = useState(180);
  const [passengerFollowing, setPassengerFollowing] = useState(true);
  const [userLocation, setUserLocation] = useState<MapPoint | null>(null);
  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);
  const center = pickup ?? BISHKEK;
  const initialCamera = useRef({ centerCoordinate: toCoordinate(driverPosition ?? center), zoomLevel: 14 });
  const zoomLevel = useRef(initialCamera.current.zoomLevel);
  const cameraCenter = useRef<GeoJSON.Position>(initialCamera.current.centerCoordinate);
  const cameraHeading = useRef(0);
  const cameraPadding = useRef({ paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 });
  const zoomRequest = useRef(0);
  const locatingRef = useRef(false);
  const picking = !!selectionMode || browsePickup;
  const pickupChange = useRef(onPickupChange);
  const followPaused = useRef(false);
  const manualCamera = useRef(false);
  const followCameraKey = useRef('');
  const lastFollowCamera = useRef<{ point: MapPoint; heading: number; top: number; bottom: number; height: number } | null>(null);
  const followedOrder = useRef(cameraSession.split(':')[0]);
  const lastRecenter = useRef(recenterKey);
  const followActive = passengerView ? passengerFollowing && !!driverPosition : followDriver;
  const driverLayerID = passengerView ? 'client-driver-car' : 'driver-navigation-arrow';
  const userLocationCallback = useRef(onUserLocation);
  userLocationCallback.current = onUserLocation;
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
      lastFollowCamera.current = null; followCameraKey.current = '';
      if (passengerView) setPassengerFollowing(true);
    }
  }, [cameraSession, recenterKey]);
  pickupChange.current = onPickupChange;
  const suppliedRoute = useMemo(() => geometry && geometry.length > 1 && geometry.every(isMapPoint) ? geometry : [], [geometry]);
  const approachRoute = useMemo(() => approachGeometry && approachGeometry.length > 1 && approachGeometry.every(isMapPoint) ? approachGeometry : [], [approachGeometry]);
  const routeKey = pickup && dropoff ? [pickup.latitude, pickup.longitude, dropoff.latitude, dropoff.longitude].join(',') : '';
  const route = suppliedRoute.length > 1 ? suppliedRoute : serverRoute?.key === routeKey && (!navigationActive || routeOverview) ? serverRoute.points : EMPTY_CAR_ROUTE;
  const driverIdentity = `${cameraSession.split(':')[0]}:${driverPosition?.assignmentId || driverPosition?.trackingSessionId || ''}`;
  const observedCourse = useStableDriverHeading(driverPosition, driverIdentity);
  const activeRoad = routeOverview ? approachRoute : route;
  const lastRoadMatch = useRef<{ road: MapPoint[]; driver: string; along: number; point: MapPoint; heading: number;
    fixAt: number } | null>(null);
  const lastRoadCalculation = useRef<{ road: MapPoint[]; driver: string; fix: string;
    match: ReturnType<typeof snapCarToRoad>; courseMatch: ReturnType<typeof snapCarToRoad> } | null>(null);
  const previousAlong = lastRoadMatch.current?.road === activeRoad && lastRoadMatch.current.driver === driverIdentity
    ? lastRoadMatch.current.along : undefined;
  const fixAt = driverPosition?.measuredAtMs ?? driverPosition?.timestamp ?? driverPosition?.receivedAtMs ?? Date.now();
  const lastMatch = lastRoadMatch.current;
  const forwardWindow = lastMatch ? Math.max(180, Math.min(1000, (fixAt - lastMatch.fixAt) / 1000 * 55)) : 180;
  const serverMatchedPoint = passengerView && driverPosition?.matched === true && isMapPoint(driverPosition) ? driverPosition : null;
  const matchEnabled = !!driverPosition && !serverMatchedPoint
    && (passengerView || navigationActive && driverPosition.matched !== false);
  const movingDriver = !passengerView && (driverPosition?.speedMps ?? driverPosition?.speed ?? 0) >= 1.5;
  const fixKey = driverPosition ? [driverPosition.latitude, driverPosition.longitude,
    driverPosition.accuracyM ?? driverPosition.accuracy, driverPosition.heading,
    driverPosition.snappedLatitude, driverPosition.snappedLongitude, driverPosition.routeAlong, driverPosition.matched,
    driverPosition.measuredAtMs ?? driverPosition.timestamp ?? driverPosition.receivedAtMs,
    driverPosition.sequence, driverPosition.stateVersion, matchEnabled].join(':') : '';
  const calculated = lastRoadCalculation.current;
  const reused = calculated?.road === activeRoad && calculated.driver === driverIdentity && calculated.fix === fixKey;
  const authoritative = !passengerView && !routeOverview && driverPosition?.matched === true
    && Number.isFinite(driverPosition.snappedLatitude) && Number.isFinite(driverPosition.snappedLongitude)
    && Number.isFinite(driverPosition.routeAlong);
  let roadMatch = reused ? calculated.match : authoritative ? {
    latitude: driverPosition!.snappedLatitude!, longitude: driverPosition!.snappedLongitude!,
    along: driverPosition!.routeAlong!, distance: driverPosition!.distanceToRoute ?? 0,
    heading: roadHeadingAt(activeRoad, driverPosition!.routeAlong!) ?? driverPosition!.heading ?? 0,
    segmentIndex: driverPosition!.routeIndex ?? 0,
    progress: driverPosition!.routeProgress ?? 0,
  } : matchEnabled ? snapCarToRoad(driverPosition!, activeRoad, previousAlong, forwardWindow) : null;
  let courseMatch = reused ? calculated.courseMatch : null;
  if (!reused && !roadMatch && matchEnabled && passengerView && observedCourse.reliable && driverPosition)
    courseMatch = snapCarToRoad({ ...driverPosition, heading: undefined }, activeRoad, previousAlong, forwardWindow);
  const hasFixTime = driverPosition?.measuredAtMs != null || driverPosition?.timestamp != null || driverPosition?.receivedAtMs != null;
  if (!reused && roadMatch && hasFixTime && lastMatch?.road === activeRoad && lastMatch.driver === driverIdentity) {
    const elapsed = Math.max(0, (fixAt - lastMatch.fixAt) / 1000);
    const accuracy = driverPosition?.accuracyM ?? driverPosition?.accuracy ?? 20;
    if (roadMatch.along - lastMatch.along > Math.max(30, elapsed * 35 + Math.min(accuracy, 45))) roadMatch = null;
  }
  if (!reused && roadMatch && !authoritative && observedCourse.reliable && observedCourse.heading != null
    && headingDifference(roadMatch.heading, observedCourse.heading) > 65) {
    // Keep the car on a plausible street, but do not borrow the route's
    // conflicting bearing or trim the route as though it had been driven.
    courseMatch = passengerView ? snapCarToRoad({ ...driverPosition!, heading: undefined }, activeRoad, previousAlong, forwardWindow) ?? roadMatch : null;
    roadMatch = null;
  }
  if (!reused) {
    lastRoadCalculation.current = { road: activeRoad, driver: driverIdentity, fix: fixKey, match: roadMatch, courseMatch };
    if (roadMatch) lastRoadMatch.current = { road: activeRoad, driver: driverIdentity, along: roadMatch.along,
      point: { latitude: roadMatch.latitude, longitude: roadMatch.longitude }, heading: roadMatch.heading,
      fixAt };
  }
  const heldMatch = !roadMatch && !courseMatch && driverPosition && lastMatch?.driver === driverIdentity
    && (!movingDriver || passengerView)
    && metresBetween(driverPosition, lastMatch.point) <= (passengerView ? Math.max(30, Math.min(65,
      (driverPosition.accuracyM ?? driverPosition.accuracy ?? 20) * 1.5)) : 15) ? lastMatch : null;
  const displayedMatch = roadMatch || courseMatch || heldMatch;
  const localRoadConfirmed = !serverMatchedPoint || roadMatch && metresBetween(serverMatchedPoint, roadMatch) <= 7
    && (driverPosition?.heading == null || headingDifference(driverPosition.heading, roadMatch.heading) <= 60);
  const displayedRoadPoint = serverMatchedPoint || roadMatch || courseMatch || heldMatch?.point;
  const snappedDriverPosition: DisplayDriverPoint | null | undefined = serverMatchedPoint
    ? { ...serverMatchedPoint, authoritativePosition: true, roadAlong: undefined }
    : driverPosition && displayedMatch && displayedRoadPoint
    ? { ...driverPosition, latitude: displayedRoadPoint.latitude,
      longitude: displayedRoadPoint.longitude, heading: courseMatch ? observedCourse.heading ?? courseMatch.heading : displayedMatch.heading,
      ...(roadMatch && localRoadConfirmed ? { roadAlong: roadMatch.along } : {}) } : driverPosition;
  const reportedHeading = driverPosition?.courseDeg ?? driverPosition?.heading;
  const driverHeading = !passengerView && roadMatch ? roadMatch.heading
    : (authoritative || serverMatchedPoint) && reportedHeading != null
    ? reportedHeading
    : courseMatch ? observedCourse.heading ?? courseMatch.heading : displayedMatch?.heading ?? observedCourse.heading ?? 0;
  const markerPoint = snappedDriverPosition ? { ...snappedDriverPosition, heading: driverHeading } : null;
  const markerRoad = serverMatchedPoint ? serverMatchedPoint.matchedPath ?? EMPTY_CAR_ROUTE : activeRoad;
  const shownRoute = useMemo(() => route.length > 1 && ((navigationActive && !routeOverview && roadMatch && localRoadConfirmed)
    || (passengerView && !routeOverview && roadMatch && localRoadConfirmed))
    ? remainingRoad(route, roadMatch?.along ?? 0) : route,
  [route, navigationActive, routeOverview, passengerView, roadMatch?.along, localRoadConfirmed]);
  const shownApproach = useMemo(() => approachRoute.length > 1 && ((navigationActive && routeOverview && roadMatch && localRoadConfirmed)
    || (passengerView && routeOverview && roadMatch && localRoadConfirmed))
    ? remainingRoad(approachRoute, roadMatch?.along ?? 0) : approachRoute,
  [approachRoute, navigationActive, routeOverview, passengerView, roadMatch?.along, localRoadConfirmed]);
  const routeShape = useMemo<GeoJSON.LineString>(() => ({ type: 'LineString', coordinates: shownRoute.map(toCoordinate) }), [shownRoute]);
  const approachShape = useMemo<GeoJSON.LineString>(() => ({ type: 'LineString', coordinates: shownApproach.map(toCoordinate) }), [shownApproach]);
  const debugAccuracyShape = trackingDiagnosticsEnabled && !passengerView && driverPosition
    ? accuracyCircle({ ...driverPosition, accuracy: driverPosition.accuracy ?? driverPosition.accuracyM ?? undefined }) : null;
  const moveTo = (point: MapPoint, zoom = 16) => {
    zoomLevel.current = zoom;
    cameraCenter.current = toCoordinate(point);
    if (!passengerView && navigationActive) cameraHeading.current = driverHeading;
    cameraPadding.current = { paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 };
    camera.current?.setCamera({
      centerCoordinate: toCoordinate(point), zoomLevel: zoom,
      ...(!passengerView && navigationActive ? { heading: driverHeading } : {}),
      padding: cameraPadding.current,
      animationDuration: 300, animationMode: 'easeTo',
    });
  };
  const changeZoom = async (step: number) => {
    if (!attached) return;
    const next = Math.max(2, Math.min(19, zoomLevel.current + step));
    if (next === zoomLevel.current) return;
    zoomLevel.current = next;
    if (!followActive) manualCamera.current = true;
    const request = ++zoomRequest.current;
    const observedCenter = mapView.current ? await mapView.current.getCenter().catch(() => null) : null;
    if (request !== zoomRequest.current) return;
    if (followActive && snappedDriverPosition && isMapPoint(snappedDriverPosition)) cameraCenter.current = toCoordinate(snappedDriverPosition);
    else if (observedCenter && isMapPoint({ latitude: observedCenter[1], longitude: observedCenter[0] })) cameraCenter.current = observedCenter;
    camera.current?.setCamera({
      centerCoordinate: cameraCenter.current, heading: cameraHeading.current, zoomLevel: next,
      padding: cameraPadding.current,
      animationDuration: 250, animationMode: 'easeTo',
    });
  };
  const locateOnMap = async () => {
    if (!attached || locatingRef.current) return;
    setLocationError('');
    if (snappedDriverPosition && isMapPoint(snappedDriverPosition)) {
      followPaused.current = false;
      manualCamera.current = false;
      if (passengerView) setPassengerFollowing(true);
      else onFollowDriverChange?.(true);
      moveTo(snappedDriverPosition, navigationActive ? 17 : 16);
      return;
    }
    locatingRef.current = true;
    setLocating(true);
    try {
      const point = await getCurrentPosition();
      if (!passengerView) {
        followPaused.current = false;
        manualCamera.current = false;
        onFollowDriverChange?.(true);
      } else manualCamera.current = true;
      moveTo(point);
      if (picking) setCandidate(point);
    } catch (error) {
      setLocationError(error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message : 'Не удалось определить местоположение. Попробуйте ещё раз.');
    } finally {
      locatingRef.current = false;
      setLocating(false);
    }
  };

  useEffect(() => {
    setCandidateAddress('');
    if (!picking || moving) return;
    let live = true;
    const timer = setTimeout(() => {
      reverseGeocode(candidate, language).then(point => {
        if (!live) return;
        setCandidateAddress(shortAddress(point.address));
        if (browsePickup) pickupChange.current?.(point);
      }).catch(() => {
        if (!live) return;
        setCandidateAddress('Точка на карте');
        if (browsePickup) pickupChange.current?.({ ...candidate, address: 'Точка на карте' });
      });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [picking, browsePickup, moving, candidate.latitude, candidate.longitude, language]);

  useEffect(() => {
    if (attached) return;
    const timeout = setTimeout(() => setLoadTimeout(true), 20000);
    return () => clearTimeout(timeout);
  }, [attached, attempt]);

  useEffect(() => {
    if (!attached || !selectionMode) return;
    const point = selectionMode === 'dropoff' ? dropoff ?? pickup ?? BISHKEK : pickup ?? BISHKEK;
    setCandidate(point);
    moveTo(point);
  }, [selectionMode, attached, recenterKey]);

  useEffect(() => {
    if (!attached || !browsePickup) return;
    if (manualCamera.current) return;
    const point = userLocation ?? center;
    moveTo(point);
    setCandidate(point);
  }, [attached, mapReadyRevision, browsePickup, recenterKey, userLocation?.latitude, userLocation?.longitude]);

  useEffect(() => {
    if (!attached || !focusPoint) return;
    const point = browsePickup && userLocation && !manualCamera.current ? userLocation : focusPoint;
    if (picking) setCandidate(point);
    moveTo(point);
  }, [focusPoint, attached]);

  useEffect(() => {
    if (!attached || viewport.width <= 0 || viewport.height <= 0 || picking || navigationActive && !routeOverview || followActive || manualCamera.current) return;
    if ((pickup && dropoff) || route.length > 1 || approachRoute.length > 1) {
      const frame = routeFrame([
        ...route, ...approachRoute,
        ...(!passengerView && driverPosition && isMapPoint(driverPosition) ? [driverPosition] : []),
        ...(pickup ? [pickup] : []), ...(dropoff ? [dropoff] : []),
      ], viewport.width, viewport.height, contentTopInset, contentBottomInset);
      if (frame) {
        cameraHeading.current = 0;
        cameraPadding.current = { paddingTop: frame.padding[0], paddingRight: frame.padding[1], paddingBottom: frame.padding[2], paddingLeft: frame.padding[3] };
        camera.current?.setCamera({ heading: 0, pitch: 0, animationDuration: 0 });
        camera.current?.fitBounds(frame.ne, frame.sw, frame.padding, 400);
      }
    } else moveTo(driverPosition && isMapPoint(driverPosition) ? driverPosition : userLocation ?? center, 15);
  }, [attached, mapReadyRevision, picking, navigationActive, routeOverview, followActive, routeKey, suppliedRoute, approachRoute, serverRoute, recenterKey, viewport.width, viewport.height, contentTopInset, contentBottomInset, cameraSession.split(':')[0], driverPosition?.latitude, driverPosition?.longitude, userLocation?.latitude, userLocation?.longitude]);

  useEffect(() => { if (followActive) { followPaused.current = false; manualCamera.current = false; } }, [followActive, recenterKey]);
  useEffect(() => {
    if (!attached || picking || !followActive || followPaused.current || !snappedDriverPosition || !isMapPoint(snappedDriverPosition)) return;
    const key = `${cameraSession.split(':')[0]}:${recenterKey}:${navigationActive}`;
    const resetView = followCameraKey.current !== key;
    followCameraKey.current = key;
    const previousCamera = lastFollowCamera.current;
    if (!resetView && previousCamera && metresBetween(previousCamera.point, snappedDriverPosition) < 2
      && headingDifference(previousCamera.heading, driverHeading) < 3
      && previousCamera.top === contentTopInset && previousCamera.height === viewport.height && previousCamera.bottom === contentBottomInset) return;
    lastFollowCamera.current = { point: snappedDriverPosition, heading: driverHeading, top: contentTopInset, bottom: contentBottomInset, height: viewport.height };
    const drivingFollow = navigationActive && !passengerView;
    const speed = driverPosition?.speedMps ?? driverPosition?.speed ?? 0;
    const lookAhead = Math.max(35, Math.min(80, 40 + speed * 3));
    // Follow the bend itself, so the next road section stays above the arrow
    // on screen instead of sliding sideways as the car approaches a turn.
    const roadAhead = drivingFollow && roadMatch && activeRoad.length > 1
      ? pointAlongRoad(activeRoad, roadMatch.along + lookAhead) : null;
    const center = drivingFollow ? roadAhead ?? pointAhead(snappedDriverPosition, driverHeading, lookAhead) : snappedDriverPosition;
    cameraCenter.current = toCoordinate(center);
    cameraHeading.current = drivingFollow ? cameraHeading.current + ((driverHeading - cameraHeading.current + 540) % 360 - 180) : 0;
    cameraPadding.current = drivingFollow
      ? { paddingTop: contentTopInset + 16, paddingBottom: contentBottomInset + 16, paddingLeft: 0, paddingRight: 0 }
      : { paddingTop: Math.min(contentTopInset + 48, viewport.height * .4), paddingBottom: Math.max(70, contentBottomInset + 30), paddingLeft: 0, paddingRight: 0 };
    camera.current?.setCamera({
      centerCoordinate: cameraCenter.current, heading: cameraHeading.current, pitch: drivingFollow ? 40 : 0,
      ...(resetView ? { zoomLevel: navigationActive ? 17 : 16 } : {}),
      padding: cameraPadding.current,
      animationDuration: resetView ? 350 : 500, animationMode: 'easeTo',
    });
  }, [attached, mapReadyRevision, picking, followActive, navigationActive, snappedDriverPosition?.latitude, snappedDriverPosition?.longitude, driverHeading, roadMatch?.along, activeRoad, recenterKey, contentTopInset, contentBottomInset, viewport.height, cameraSession]);

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
    if (point) { setCandidate(point); moveTo(point); }
  };
  const onRegionChanging = (feature: GeoJSON.Feature<GeoJSON.Point, { isUserInteraction?: boolean; heading?: number; zoomLevel?: number }>) => {
    if (picking) setMoving(true);
    const regionCenter = pointFromFeature(feature);
    if (regionCenter) cameraCenter.current = toCoordinate(regionCenter);
    if (Number.isFinite(feature.properties?.heading)) cameraHeading.current = feature.properties.heading!;
    if (Number.isFinite(feature.properties?.zoomLevel)) zoomLevel.current = feature.properties.zoomLevel!;
    if (feature.properties?.isUserInteraction) manualCamera.current = true;
    if (feature.properties?.isUserInteraction && !followPaused.current) {
      if (passengerView && passengerFollowing) { followPaused.current = true; setPassengerFollowing(false); }
      else if (followDriver) { followPaused.current = true; onFollowDriverChange?.(false); }
    }
  };
  const retry = () => { setLoadTimeout(false); setAttached(false); setRasterFallback(false); setAttempt(value => value + 1); };
  const dropoffRouteParts = dropoffRouteLabel?.split(' · ');
  // A driver offer can leave a short map above its detail card. Keep all three
  // targets visible by laying the same controls in one row on short viewports.
  const controlsBottomGap = navigationActive ? 16 : passengerView ? (selectionMode ? panelHeight + 24 : 100) : 92;
  const compactControls = viewport.height > 0 && viewport.height - contentBottomInset - contentTopInset < (passengerView ? 216 : 297);
  const controlsHeight = compactControls ? 60 : 193;
  const controlsTop = viewport.height > 0
    ? Math.min(
      Math.max(insets.top + 54, contentTopInset + 10, viewport.height - contentBottomInset - controlsHeight - controlsBottomGap),
      Math.max(insets.top + 54, viewport.height - contentBottomInset - controlsHeight - 12),
    )
    : contentTopInset + 56;

  return <View style={styles.root}>
    <View testID="map-viewport" onLayout={({ nativeEvent: { layout } }) => setViewport(previous => previous.width === layout.width && previous.height === layout.height ? previous : { width: layout.width, height: layout.height })} style={[StyleSheet.absoluteFill, { bottom: selectionMode ? panelHeight : 0 }]}>
      <MapView
        ref={mapView}
        preferredFramesPerSecond={Device.isDevice ? undefined : 30}
        key={`${attempt}:${rasterFallback ? 'raster' : 'vector'}`}
        style={StyleSheet.absoluteFill}
        mapStyle={rasterFallback ? dark ? darkRasterMapFallback : rasterMapFallback : mapStyleForLanguage(language, dark)}
        pitchEnabled={navigationActive}
        rotateEnabled
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        onDidFinishLoadingStyle={() => { followCameraKey.current = ''; setMapReadyRevision(value => value + 1); setAttached(true); setLoadTimeout(false); }}
        onDidFinishLoadingMap={() => { setAttached(true); setLoadTimeout(false); }}
        onDidFailLoadingMap={() => { if (!rasterFallback) { setAttached(false); setRasterFallback(true); } else setLoadTimeout(true); }}
        regionWillChangeDebounceTime={0}
        regionDidChangeDebounceTime={80}
        onRegionWillChange={onRegionChanging}
        onRegionIsChanging={onRegionChanging}
        onRegionDidChange={feature => {
          const regionCenter = pointFromFeature(feature);
          if (regionCenter) cameraCenter.current = toCoordinate(regionCenter);
          if (Number.isFinite(feature.properties.heading)) cameraHeading.current = feature.properties.heading;
          if (Number.isFinite(feature.properties.zoomLevel)) zoomLevel.current = feature.properties.zoomLevel;
          if (picking) { setMoving(false); const point = pointFromFeature(feature); if (point) setCandidate(point); }
        }}
        onPress={selectFeature}
        onLongPress={selectFeature}
      >
        <Camera ref={camera} defaultSettings={initialCamera.current} maxZoomLevel={19} />
        <AnimatedDriverMarker point={markerPoint} session={driverIdentity} road={markerRoad} passengerView={passengerView}/>
        {shownRoute.length > 1 && <ShapeSource id="route" shape={routeShape}>
          <LineLayer id="route-halo" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#101010' : '#FFFFFF', lineWidth: 15, lineOpacity: .94, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="route-outline" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#858585' : '#0B55C5', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="route-line" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#F0F0F0' : '#57AAFF', lineWidth: 5.5, lineCap: 'round', lineJoin: 'round' }} />
        </ShapeSource>}
        {shownApproach.length > 1 && <ShapeSource id="approach-route" shape={approachShape}>
          <LineLayer id="approach-route-halo" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#101010' : '#FFFFFF', lineWidth: 13, lineOpacity: .95, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="approach-route-outline" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#9B5D00' : '#B77908', lineWidth: 9, lineCap: 'round', lineJoin: 'round' }} />
          <LineLayer id="approach-route-line" belowLayerID={driverLayerID} style={{ lineColor: dark ? '#FFBC4B' : '#FFD54A', lineWidth: 6, lineCap: 'round', lineJoin: 'round' }} />
        </ShapeSource>}
        {debugAccuracyShape && <ShapeSource id="driver-accuracy" shape={debugAccuracyShape}>
          <FillLayer id="driver-accuracy-fill" belowLayerID={driverLayerID} style={{ fillColor: '#FF7A00', fillOpacity: .13 }}/>
          <LineLayer id="driver-accuracy-outline" belowLayerID={driverLayerID} style={{ lineColor: '#FF7A00', lineWidth: 1.5 }}/>
        </ShapeSource>}
        {trackingDiagnosticsEnabled && !passengerView && driverPosition && <PointAnnotation id="driver-raw-debug" coordinate={toCoordinate(driverPosition)}>
          <View collapsable={false} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF7A00', borderColor: '#FFFFFF', borderWidth: 1 }}/>
        </PointAnnotation>}
        {showUserPosition && passengerView && <UserLocation visible={false} onUpdate={location => {
          const point = { latitude: location.coords.latitude, longitude: location.coords.longitude };
          const timestamp = location.timestamp;
          if (!isMapPoint(point) || location.coords.accuracy != null && location.coords.accuracy > 80
            || timestamp != null && timestamp > 1_000_000_000_000 && Date.now() - timestamp > 30_000) return;
          setUserLocation(previous => previous && metresBetween(previous, point) < 2 ? previous : point);
          onUserLocation?.(point);
        }}/>}
        {showUserPosition && passengerView && userLocation && <PointAnnotation id="client-user-position" coordinate={toCoordinate(userLocation)}>
          <View collapsable={false} style={styles.userPositionDot}/>
        </PointAnnotation>}
        {pickup && !browsePickup && selectionMode !== 'pickup' && <MarkerView testID="pickup" coordinate={toCoordinate(pickup)} allowOverlap anchor={{ x: .5, y: 1 }}>
          <Pressable onPress={() => onEditPoint?.('pickup')} accessibilityLabel="Место подачи" collapsable={false} style={{ width: 48, height: 67, alignItems: 'center' }}><View style={[styles.pinBody, dark && styles.darkPinBody]}><PickupIcon color={dark ? '#101010' : 'white'} size={24}/></View><View style={[styles.stem, dark && styles.darkStem]}/></Pressable>
        </MarkerView>}
        {dropoff && selectionMode !== 'dropoff' && <MarkerView testID="dropoff" coordinate={toCoordinate(dropoff)} allowOverlap anchor={{ x: .5, y: dropoffRouteLabel ? .81 : .5 }}>
          <Pressable onPress={() => onEditPoint?.('dropoff')} accessibilityLabel="Пункт назначения" collapsable={false} style={dropoffRouteLabel ? styles.destinationWithRoute : styles.destination}>
            {!!dropoffRouteLabel && <View style={[styles.dropoffRouteBadge, dark && styles.darkDropoffRouteBadge]} accessible accessibilityLabel={`Пункт назначения Б, ${dropoffRouteLabel}`}>
              <View style={[styles.dropoffRouteLetter, dark && styles.darkDropoffRouteLetter]}><Text style={[styles.dropoffRouteLetterText, dark && styles.darkDropoffRouteLetterText]}>Б</Text></View>
              <View style={styles.dropoffRouteMetrics}>
                <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.dropoffRouteDistance, dark && styles.darkDropoffRouteText]}>{dropoffRouteParts?.[0]}</Text>
                {dropoffRouteParts && dropoffRouteParts.length > 1 && <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.dropoffRouteDuration, dark && styles.darkDropoffRouteText]}>{dropoffRouteParts.slice(1).join(' · ')}</Text>}
              </View>
            </View>}
            <View style={[styles.destination, dark && styles.darkDestination]}><Icon name="flag" color={dark ? '#101010' : 'white'} size={19}/></View>
          </Pressable>
        </MarkerView>}
      </MapView>
      {picking && <View pointerEvents="none" accessibilityLabel={selectionMode !== 'dropoff' ? 'Метка места подачи' : 'Метка пункта назначения'} style={[styles.centerPin, moving && { transform: [{ translateY: -8 }] }]}><View style={[styles.pinBody, dark && styles.darkPinBody]}>{selectionMode !== 'dropoff' ? <PickupIcon color={dark ? '#101010' : 'white'} size={24}/> : <Icon name="flag" color={dark ? '#101010' : 'white'} size={24}/>}</View><View style={[styles.stem, dark && styles.darkStem]}/></View>}
      <View style={styles.attribution}>
        <Pressable accessibilityRole="link" accessibilityLabel="Стиль OpenMapTiles Bright" onPress={() => { void Linking.openURL('https://github.com/hyperknot/openfreemap-styles/blob/main/LICENSE.md'); }}><Text style={[styles.attributionText, dark && styles.darkAttributionText]}>© OpenMapTiles Bright</Text></Pressable>
        <Text style={[styles.attributionText, dark && styles.darkAttributionText]}> · </Text>
        <Pressable accessibilityRole="link" accessibilityLabel="© OpenStreetMap contributors" onPress={() => { void Linking.openURL('https://www.openstreetmap.org/copyright'); }}><Text style={[styles.attributionText, dark && styles.darkAttributionText]}>© OpenStreetMap</Text></Pressable>
      </View>
    </View>
    {trackingDiagnosticsEnabled && passengerView && driverPosition && <View testID="client-tracking-diagnostics" pointerEvents="none"
      style={[styles.trackingDiagnostics, dark && styles.darkTrackingDiagnostics, { top: contentTopInset + 10 }]}>
      <Text style={[styles.trackingDiagnosticsText, dark && styles.darkTrackingDiagnosticsText]}>{[
        `GPS: ${driverPosition.latitude.toFixed(6)}, ${driverPosition.longitude.toFixed(6)}`,
        `Карта: ${markerPoint ? `${markerPoint.latitude.toFixed(6)}, ${markerPoint.longitude.toFixed(6)}` : '—'}`,
        `Точность: ${driverPosition.accuracyM ?? driverPosition.accuracy ?? '—'} м · замер: ${driverPosition.measuredAtMs ? Math.max(0, Math.round((Date.now() - driverPosition.measuredAtMs) / 1000)) : '—'} с`,
        `Сессия: ${driverPosition.trackingSessionId || '—'} · № ${driverPosition.sequence ?? '—'}`,
        `Назначение: ${driverPosition.assignmentId || '—'} · версия: ${driverPosition.stateVersion ?? '—'}`,
      ].join('\n')}</Text>
    </View>}
    <View testID="map-controls" style={[styles.mapControls, compactControls && styles.compactMapControls, { top: controlsTop }]}>
      <View testID="map-zoom-controls" style={[styles.zoomControls, compactControls && styles.compactZoomControls, dark && styles.darkControl]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Приблизить карту" hitSlop={5} onPress={() => { void changeZoom(1); }} style={({ pressed }) => [styles.zoomButton, compactControls && styles.compactZoomButton, pressed && styles.controlPressed]}>
          <Icon name="add" size={30} color={dark ? '#FFFFFF' : '#111827'}/>
        </Pressable>
        <View style={[styles.zoomDivider, compactControls && styles.compactZoomDivider, dark && styles.darkZoomDivider]}/>
        <Pressable accessibilityRole="button" accessibilityLabel="Отдалить карту" hitSlop={5} onPress={() => { void changeZoom(-1); }} style={({ pressed }) => [styles.zoomButton, compactControls && styles.compactZoomButton, pressed && styles.controlPressed]}>
          <Icon name="remove" size={30} color={dark ? '#FFFFFF' : '#111827'}/>
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={driverPosition ? 'Показать водителя' : 'Моё местоположение'} accessibilityState={{ busy: locating }} hitSlop={5} onPress={() => { void locateOnMap(); }} style={({ pressed }) => [styles.locationControl, dark && styles.darkControl, pressed && styles.controlPressed]}>
        {locating ? <ActivityIndicator color={dark ? '#FFFFFF' : '#111827'}/> : <Icon name="navigate" size={27} color={dark ? '#FFFFFF' : '#111827'}/>}
      </Pressable>
    </View>
    {!!locationError && <Pressable accessibilityRole="alert" onPress={() => setLocationError('')} style={[styles.locationNotice, { top: Math.max(insets.top + 54, controlsTop - 72), right: 16 }]}><Text style={styles.locationNoticeText}>{locationError}</Text></Pressable>}
    {selectionMode && <View onLayout={event => { setPanelHeight(event.nativeEvent.layout.height); onPanelHeight?.(event.nativeEvent.layout.height); }} style={[styles.confirm, dark && styles.darkConfirm, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: dark ? '#FFFFFF' : colors.ink }}>{selectionMode === 'pickup' ? 'Точка посадки' : 'Точка назначения'}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Найти адрес" onPress={onSearchPoint} style={styles.addressSearch}>
        {selectionMode === 'pickup' ? <PickupIcon size={22} color={dark ? '#FFFFFF' : colors.blue}/> : <Icon name="flag" size={22} color={dark ? '#FFFFFF' : colors.blue}/>}
        <Text numberOfLines={2} style={[styles.hintText, dark && styles.darkHintText, { flex: 1 }]}>{moving ? 'Выбираем точку…' : candidateAddress || 'Определяем адрес…'}</Text><Icon name="chevron-forward" color={dark ? '#FFFFFF' : undefined} size={18}/>
      </Pressable>
      <Button label="Готово" disabled={!attached || moving} busy={selecting} onPress={() => onSelectPoint?.(candidate)}/>
    </View>}
    {(!attached || loadTimeout) && <View style={[styles.loading, dark && styles.darkLoading, { top: contentTopInset + 55 }]}>{loadTimeout ? <><Text style={[styles.noticeText, dark && styles.darkNoticeText]}>Не удалось открыть карту. Повторите попытку.</Text><Pressable accessibilityRole="button" onPress={retry} style={[styles.retry, dark && styles.darkRetry]}><Text style={{ color: dark ? '#FFFFFF' : colors.blue }}>Повторить загрузку</Text></Pressable></> : <ActivityIndicator color={dark ? '#FFFFFF' : colors.blue}/>}</View>}
    {routeError && !navigationActive && <View pointerEvents="none" style={[styles.notice, dark && styles.darkNotice, { top: contentTopInset + 58 }]}><Text style={[styles.noticeText, dark && styles.darkNoticeText]}>Маршрут временно недоступен</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  trackingDiagnostics: { position: 'absolute', left: 12, maxWidth: '70%', padding: 8, borderRadius: 8, backgroundColor: 'rgba(255,255,255,.9)' },
  darkTrackingDiagnostics: { backgroundColor: 'rgba(16,16,16,.9)' },
  trackingDiagnosticsText: { color: '#152644', fontSize: 10, lineHeight: 14 },
  darkTrackingDiagnosticsText: { color: '#FFFFFF' },
  attribution: { position: 'absolute', right: 8, bottom: 6, paddingHorizontal: 4, paddingVertical: 2, flexDirection: 'row' },
  attributionText: { fontSize: 10, color: '#475569', textShadowColor: '#FFFFFF', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  darkAttributionText: { color: '#E6E6E6', textShadowColor: '#101010' },
  root: { flex: 1 },
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
  controlPressed: { opacity: .72 },
  locationNotice: { position: 'absolute', right: 84, maxWidth: 230, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 12, backgroundColor: '#202126', elevation: 4 },
  locationNoticeText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18 },
  retry: { padding: 14, marginTop: 10, borderRadius: 15, backgroundColor: '#FFFFFF' },
  darkRetry: { backgroundColor: '#292929' },
  loading: { position: 'absolute', alignSelf: 'center', padding: 16, borderRadius: 18, backgroundColor: '#FFFFFF' },
  darkLoading: { backgroundColor: '#202020' },
  pinBody: { width: 48, height: 48, borderRadius: 17, borderWidth: 4, borderColor: 'white', backgroundColor: colors.blue, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  darkPinBody: { borderColor: '#101010', backgroundColor: '#FFFFFF' },
  stem: { width: 3, height: 19, backgroundColor: colors.ink, alignSelf: 'center' },
  darkStem: { backgroundColor: '#FFFFFF' },
  centerPin: { position: 'absolute', top: '50%', left: '50%', marginLeft: -24, marginTop: -67 },
  confirm: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingTop: 18, gap: 12, backgroundColor: 'white', borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  darkConfirm: { backgroundColor: '#101010' },
  addressSearch: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  instruction: { fontSize: 12, color: colors.muted, marginTop: -8 },
  unavailable: { flex: 1, backgroundColor: '#EAF1FB', justifyContent: 'center', alignItems: 'center', padding: 34 },
  unavailableTitle: { fontSize: 20, fontWeight: '700', color: '#192A48', marginBottom: 10 },
  unavailableText: { color: '#65738B', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  pickup: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#246BFD' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#246BFD' },
  userPositionDot: { width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: '#246BFD', elevation: 5 },
  destination: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#246BFD', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  darkDestination: { backgroundColor: '#FFFFFF', borderColor: '#101010' },
  destinationWithRoute: { width: 174, height: 88, alignItems: 'center', justifyContent: 'flex-end' },
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
