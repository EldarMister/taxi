import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TaxiMapProps } from './TaxiMap';
import { appVariant } from '../appVariant';

export default function TaxiMap({ theme = 'light', pickup, renderSelectionPanel }: TaxiMapProps) {
  const dark = theme === 'dark';
  return <View style={[styles.root, dark && styles.darkRoot]}><Text style={[styles.title, dark && styles.darkTitle]}>{renderSelectionPanel ? 'Адрес доставки' : 'Ваша поездка начинается здесь'}</Text><Text style={[styles.text, dark && styles.darkText]}>Карта OpenStreetMap и навигация по маршруту доступны в приложении {appVariant === 'driver' ? 'Atlas pro' : 'Atlas'} для Android и iOS.</Text>{renderSelectionPanel && <View style={styles.panel}>{renderSelectionPanel({ point: pickup ?? { latitude: 42.8746, longitude: 74.5698 }, address: pickup?.address ?? '', ready: !!pickup?.address, moving: false, locatingAddress: false })}</View>}</View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#EAF1FB', alignItems: 'center', justifyContent: 'center', padding: 36 },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  darkRoot: { backgroundColor: '#101010' },
  title: { fontSize: 21, fontWeight: '700', color: '#192A48', textAlign: 'center' },
  darkTitle: { color: '#FFFFFF' },
  text: { marginTop: 12, color: '#65738B', textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  darkText: { color: '#C7C7C7' },
});
