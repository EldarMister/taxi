import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TaxiMapProps } from './TaxiMap';
import { appVariant } from '../appVariant';

export default function TaxiMap({ theme = 'light' }: TaxiMapProps) {
  const dark = theme === 'dark';
  return <View style={[styles.root, dark && styles.darkRoot]}><Text style={[styles.title, dark && styles.darkTitle]}>Ваша поездка начинается здесь</Text><Text style={[styles.text, dark && styles.darkText]}>Карта OpenStreetMap и навигация по маршруту доступны в приложении {appVariant === 'driver' ? 'Atlas pro' : 'Atlas'} для Android и iOS.</Text></View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#EAF1FB', alignItems: 'center', justifyContent: 'center', padding: 36 },
  darkRoot: { backgroundColor: '#101010' },
  title: { fontSize: 21, fontWeight: '700', color: '#192A48', textAlign: 'center' },
  darkTitle: { color: '#FFFFFF' },
  text: { marginTop: 12, color: '#65738B', textAlign: 'center', lineHeight: 22, maxWidth: 300 },
  darkText: { color: '#C7C7C7' },
});
