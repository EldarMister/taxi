import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import YaMap, { Marker, Polyline } from 'react-native-yamap';
import { BISHKEK, initializeMapKit, MapPoint } from './mapkit';

export { searchAddresses, reverseGeocode } from './mapkit';
export type { MapPoint } from './mapkit';

export interface TaxiMapProps {
  pickup?: MapPoint | null;
  dropoff?: MapPoint | null;
  geometry?: MapPoint[] | null;
  onSelectPoint?: (point: MapPoint) => void;
  selectionMode?: boolean | string | null;
  recenterKey?: number;
  showUserPosition?: boolean;
}
type NativeRoute = { status: string; routes: { sections: { points: { lat: number; lon: number }[] }[] }[] };
const toNative = (point: MapPoint) => ({ lat: point.latitude, lon: point.longitude });

export default function TaxiMap({ pickup, dropoff, geometry, onSelectPoint, selectionMode, recenterKey, showUserPosition = false }: TaxiMapProps) {
  const map = useRef<YaMap>(null);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [routeError, setRouteError] = useState(false);
  const [nativeGeometry, setNativeGeometry] = useState<MapPoint[]>([]);
  const center = pickup ?? BISHKEK;

  useEffect(() => {
    let mounted = true;
    initializeMapKit().then(() => { if (mounted) setReady(true); }).catch((e: Error) => { if (mounted) setError(e.message); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (pickup && dropoff) map.current?.fitMarkers([toNative(pickup), toNative(dropoff)]);
    else map.current?.setCenter(toNative(center), 15, 0, 0, 0.4);
  }, [loaded, pickup?.latitude, pickup?.longitude, dropoff?.latitude, dropoff?.longitude, recenterKey]);

  useEffect(() => {
    setNativeGeometry([]);
    setRouteError(false);
    if (!loaded || !pickup || !dropoff || (geometry && geometry.length > 1)) return;
    let active = true;
    const timeout = setTimeout(() => { if (active) setRouteError(true); }, 18000);
    map.current?.findDrivingRoutes([toNative(pickup), toNative(dropoff)], (raw) => {
      if (!active) return;
      clearTimeout(timeout);
      // Upstream removes nativeEvent before invoking its callback, despite its typings.
      const result = ((raw as unknown as { nativeEvent?: NativeRoute }).nativeEvent ?? raw) as unknown as NativeRoute;
      const points = result.routes?.[0]?.sections?.flatMap((section) => section.points ?? []) ?? [];
      if (result.status !== 'success' || points.length < 2) { setRouteError(true); return; }
      setNativeGeometry(points.map(({ lat, lon }) => ({ latitude: lat, longitude: lon })));
    });
    return () => { active = false; clearTimeout(timeout); };
  }, [loaded, pickup?.latitude, pickup?.longitude, dropoff?.latitude, dropoff?.longitude, geometry]);

  if (!ready) return <View style={styles.unavailable} accessibilityRole="text">
    {error ? <><Text style={styles.unavailableTitle}>Карта недоступна</Text><Text style={styles.unavailableText}>{error}</Text></> : <ActivityIndicator size="large" color="#246BFD" />}
  </View>;

  const route = geometry && geometry.length > 1 ? geometry : nativeGeometry;
  return <View style={styles.root}>
    <YaMap
      ref={map}
      style={StyleSheet.absoluteFill}
      initialRegion={{ ...toNative(center), zoom: 14 }}
      showUserPosition={showUserPosition}
      followUser={false}
      nightMode={false}
      tiltGesturesEnabled={false}
      rotateGesturesEnabled={false}
      logoPosition={{ horizontal: 'left', vertical: 'top' }}
      logoPadding={{ horizontal: 14, vertical: 104 }}
      onMapLoaded={() => setLoaded(true)}
      onMapPress={(event) => { if (selectionMode && onSelectPoint) onSelectPoint({ latitude: event.nativeEvent.lat, longitude: event.nativeEvent.lon }); }}
      onMapLongPress={(event) => onSelectPoint?.({ latitude: event.nativeEvent.lat, longitude: event.nativeEvent.lon })}
    >
      {route.length > 1 && <Polyline points={route.map(toNative)} strokeColor="#246BFD" strokeWidth={5} outlineColor="#FFFFFF" outlineWidth={2} />}
      {pickup && <Marker point={toNative(pickup)} anchor={{ x: 0.5, y: 0.5 }} zIndex={3}><View style={styles.pickup}><View style={styles.dot} /></View></Marker>}
      {dropoff && <Marker point={toNative(dropoff)} anchor={{ x: 0.5, y: 0.5 }} zIndex={3}><View style={styles.destination}><Text style={styles.destinationText}>Б</Text></View></Marker>}
    </YaMap>
    <Pressable accessibilityRole="link" accessibilityLabel="Открыть в Яндекс Картах" style={styles.openMaps} onPress={() => {
      void Linking.openURL(`https://yandex.ru/maps/?ll=${center.longitude}%2C${center.latitude}&z=15`).catch(() => Alert.alert('Не удалось открыть Карты', 'Повторите попытку после подключения к интернету.'));
    }}><Text style={styles.openMapsText}>Открыть в Картах ↗</Text></Pressable>
    {selectionMode && <View pointerEvents="none" style={styles.hint}><Text style={styles.hintText}>Нажмите на карте, чтобы выбрать адрес</Text></View>}
    {routeError && <View pointerEvents="none" style={styles.notice}><Text style={styles.noticeText}>Маршрут временно недоступен</Text></View>}
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  openMaps: { position: 'absolute', top: 106, right: 12, backgroundColor: '#FFFFFF', paddingVertical: 7, paddingHorizontal: 10, borderRadius: 10 },
  openMapsText: { color: '#435574', fontSize: 11 },
  unavailable: { flex: 1, backgroundColor: '#EAF1FB', justifyContent: 'center', alignItems: 'center', padding: 34 },
  unavailableTitle: { fontSize: 20, fontWeight: '700', color: '#192A48', marginBottom: 10 },
  unavailableText: { color: '#65738B', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  pickup: { width: 27, height: 27, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#246BFD' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#246BFD' },
  destination: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#246BFD', borderWidth: 3, borderColor: '#FFF', alignItems: 'center', justifyContent: 'center' },
  destinationText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  hint: { position: 'absolute', top: 146, alignSelf: 'center', paddingVertical: 11, paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#FFFFFF' },
  hintText: { color: '#192A48', fontSize: 13 },
  notice: { position: 'absolute', top: 192, alignSelf: 'center', backgroundColor: '#FFF8E9', borderRadius: 12, padding: 10 },
  noticeText: { color: '#956315', fontSize: 12 },
});
