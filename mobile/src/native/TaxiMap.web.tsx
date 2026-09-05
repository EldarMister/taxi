import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TaxiMapProps } from './TaxiMap';

export default function TaxiMap(_props: TaxiMapProps) {
  return <View style={styles.root}><Text style={styles.title}>Ваша поездка начинается здесь</Text><Text style={styles.text}>Интерактивная карта Яндекса доступна в приложении Taxi GO для Android и iOS.</Text></View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#EAF1FB', alignItems: 'center', justifyContent: 'center', padding: 36 },
  title: { fontSize: 21, fontWeight: '700', color: '#192A48', textAlign: 'center' },
  text: { marginTop: 12, color: '#65738B', textAlign: 'center', lineHeight: 22, maxWidth: 300 },
});
