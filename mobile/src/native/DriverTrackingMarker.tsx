import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { ShapeSource, SymbolLayer, type ShapeSourceRef } from '@maplibre/maplibre-react-native';
import { TrackingPlayback, type PlaybackFix, type PlaybackFrame } from './trackingPlayback';

// Both inspected PNGs point up (north at iconRotate=0), with transparent backgrounds.
// MapLibre rotates clockwise in degrees, around the centre. Map alignment applies
// camera bearing/pitch exactly once: never subtract camera heading here.
export const VEHICLE_ASSET_BEARING_OFFSET_DEG = 0;
export const ARROW_ASSET_BEARING_OFFSET_DEG = 0;
const EMPTY_SHAPE: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();

export type MarkerFix = PlaybackFix & { playbackAgeAtReceiptMs?: number; playbackReceivedAtMs?: number };
export const DriverTrackingMarker = React.memo(function DriverTrackingMarker({ point, session, passengerView, onFrame, styleRevision }:
  { point: MarkerFix | null; session: string; passengerView: boolean; styleRevision: number;
    onFrame: React.MutableRefObject<((frame: PlaybackFrame, nowMs: number) => void) | null> }) {
  const source = useRef<ShapeSourceRef>(null);
  const hasPoint = point != null;
  const playback = useRef(new TrackingPlayback({ mode: passengerView ? 'client' : 'local' }));
  const identity = useRef('');
  const lastShape = useRef<GeoJSON.Feature<GeoJSON.Point> | null>(null);
  const paint = (nowMs: number) => {
    const frame = playback.current.sample(nowMs);
    if (!frame) return;
    onFrame.current?.(frame, nowMs);
    const previous = lastShape.current;
    if (previous?.geometry.coordinates[0] === frame.longitude && previous.geometry.coordinates[1] === frame.latitude
      && previous.properties?.bearing === frame.bearingDeg) return;
    const shape: GeoJSON.Feature<GeoJSON.Point> = { type: 'Feature', geometry: { type: 'Point', coordinates: [frame.longitude, frame.latitude] },
      properties: { bearing: frame.bearingDeg, hasBearing: frame.bearingDeg != null } };
    lastShape.current = shape;
    // MapLibre's public imperative source API updates just this feature. No React
    // screen (or marker component) is rendered on animation frames.
    source.current?.setNativeProps({ shape });
  };
  useEffect(() => {
    const key = `${session}:${passengerView}`;
    if (identity.current !== key) {
      identity.current = key;
      playback.current = new TrackingPlayback({ mode: passengerView ? 'client' : 'local' });
      lastShape.current = null;
    }
    if (!point) { playback.current.reset(); lastShape.current = null; source.current?.setNativeProps({ shape: EMPTY_SHAPE }); return; }
    const now = clock();
    const age = point.playbackAgeAtReceiptMs == null ? undefined : point.playbackAgeAtReceiptMs
      + Math.max(0, now - (point.playbackReceivedAtMs ?? now));
    playback.current.ingest(point, now, age);
    paint(now);
  }, [point, session, passengerView]);
  useEffect(() => { lastShape.current = null; paint(clock()); }, [styleRevision]);
  useEffect(() => {
    if (!hasPoint) return;
    let frameId = 0, lastPaint = -Infinity, active = AppState.currentState === 'active';
    const tick = () => {
      if (!active) return;
      const now = clock();
      if (now - lastPaint >= 1000 / 30) { paint(now); lastPaint = now; }
      frameId = requestAnimationFrame(tick);
    };
    if (active && typeof requestAnimationFrame === 'function') frameId = requestAnimationFrame(tick);
    const subscription = AppState.addEventListener('change', state => {
      active = state === 'active';
      if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId);
      if (active && typeof requestAnimationFrame === 'function') { lastPaint = -Infinity; frameId = requestAnimationFrame(tick); }
    });
    return () => { active = false; subscription.remove(); if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId); };
  }, [hasPoint]);
  const id = passengerView ? 'client-driver' : 'driver-navigation';
  return <ShapeSource ref={source} id={`${id}-position`} shape={EMPTY_SHAPE} testID={`${id}-position`}>
    <SymbolLayer id={passengerView ? 'client-driver-car' : 'driver-navigation-arrow'} style={{
      iconImage: passengerView ? require('../../assets/tracking-car-white.png') : require('../../assets/driver-navigation-arrow.png'),
      iconSize: passengerView ? .025 : .42,
      // Keep the original car and arrow even before a course exists. Zero is
      // only its initial visual orientation; measured course remains null.
      iconRotate: ['+', ['coalesce', ['get', 'bearing'], 0], passengerView ? VEHICLE_ASSET_BEARING_OFFSET_DEG : ARROW_ASSET_BEARING_OFFSET_DEG],
      iconRotationAlignment: 'map', iconPitchAlignment: 'map', iconAnchor: 'center', iconOffset: [0, 0],
      iconAllowOverlap: true, iconIgnorePlacement: true,
    }}/>
  </ShapeSource>;
});
