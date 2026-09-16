import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, LineLayer, MapView, PointAnnotation, ShapeSource, type CameraRef } from '@maplibre/maplibre-react-native';
import { useTheme } from '../design/theme';
import type { Order, User } from '../types';
import { Icon, tr } from '../ui';
import { getCurrentPosition } from './location';
import { isMapPoint, routeFrame } from './routeFrame';
import { darkRasterMapFallback, mapStyleForLanguage, rasterMapFallback } from './taxiMapStyle';

export function HistoryRouteMap({ order, language, onError }: { order: Order; language: User['language']; onError: (message: string) => void }) {
  const { isDark, palette } = useTheme();
  const camera = useRef<CameraRef>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ready, setReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const points = useMemo(() => {
    const geometry = order.geometry || [];
    return geometry.length > 1 && geometry.every(isMapPoint) ? geometry : [];
  }, [order.geometry]);
  const pickupValid = isMapPoint(order.pickup);
  const dropoffValid = isMapPoint(order.dropoff);
  const frame = useMemo(() => routeFrame([...points, ...(pickupValid ? [order.pickup] : []), ...(dropoffValid ? [order.dropoff] : [])], size.width, size.height, 0), [points, pickupValid, dropoffValid, order.pickup, order.dropoff, size]);
  const line = useMemo<GeoJSON.LineString>(() => ({ type: 'LineString', coordinates: points.map(point => [point.longitude, point.latitude]) }), [points]);

  useEffect(() => {
    if (!ready || !frame || !size.width || !size.height) return;
    camera.current?.fitBounds(frame.ne, frame.sw, frame.padding, 0);
  }, [ready, frame, size.width, size.height, isDark, fallback]);

  async function locate() {
    try {
      const point = await getCurrentPosition();
      camera.current?.setCamera({ centerCoordinate: [point.longitude, point.latitude], zoomLevel: 15, animationDuration: 450 });
    } catch { onError(language === 'ky' ? 'Жайгашкан жериңизди аныктоо мүмкүн болгон жок' : 'Не удалось определить местоположение'); }
  }

  const center = pickupValid ? order.pickup : dropoffValid ? order.dropoff : null;
  if (!center) return null;
  return <View style={[styles.container, { backgroundColor: palette.elevated }]} onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })}>
    <MapView
      key={fallback ? 'raster' : 'vector'}
      style={StyleSheet.absoluteFill}
      mapStyle={fallback ? isDark ? darkRasterMapFallback : rasterMapFallback : mapStyleForLanguage(language, isDark)}
      scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
      logoEnabled={false} attributionEnabled={false} compassEnabled={false}
      onDidFinishLoadingStyle={() => setReady(true)}
      onDidFailLoadingMap={() => { if (!fallback) { setReady(false); setFallback(true); } }}
    >
      <Camera ref={camera} defaultSettings={{ centerCoordinate: [center.longitude, center.latitude], zoomLevel: 13 }} />
      {points.length > 1 && <ShapeSource id="history-route" shape={line}>
        <LineLayer id="history-route-halo" style={{ lineColor: isDark ? '#090909' : '#FFFFFF', lineWidth: 11, lineCap: 'round', lineJoin: 'round' }}/>
        <LineLayer id="history-route-outline" style={{ lineColor: '#0757BE', lineWidth: 7, lineCap: 'round', lineJoin: 'round' }}/>
        <LineLayer id="history-route-line" style={{ lineColor: '#39A2FF', lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}/>
      </ShapeSource>}
      {pickupValid && <PointAnnotation id="history-pickup" coordinate={[order.pickup.longitude, order.pickup.latitude]}><View collapsable={false} style={[styles.marker, { backgroundColor: '#1686EF' }]}><Text style={styles.markerText}>А</Text></View></PointAnnotation>}
      {dropoffValid && <PointAnnotation id="history-dropoff" coordinate={[order.dropoff.longitude, order.dropoff.latitude]}><View collapsable={false} style={[styles.marker, { backgroundColor: isDark ? '#FFFFFF' : '#172741' }]}><Text style={[styles.markerText, isDark && { color: '#101010' }]}>Б</Text></View></PointAnnotation>}
    </MapView>
    <Pressable accessibilityRole="button" accessibilityLabel={tr(language)('Моё местоположение')} onPress={() => void locate()} style={[styles.locate, { backgroundColor: palette.surface, borderColor: palette.line }]}><Icon name="navigate" size={19} color={palette.ink}/></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  container: { height: 232, borderRadius: 22, overflow: 'hidden' },
  marker: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
  markerText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  locate: { position: 'absolute', top: 13, right: 13, width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
