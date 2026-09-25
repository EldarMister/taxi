import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { roadFeatureDistanceLabel, type RoadFeature, type RoadFeatureKind } from './roadFeatures';
import { useTheme } from './design/theme';

const images: Partial<Record<RoadFeatureKind, number>> = {
  stop: require('../assets/road-signs/stop.png'),
  give_way: require('../assets/road-signs/give-way.png'),
  speed_limit_60: require('../assets/road-signs/speed-60.png'),
  pedestrian_crossing: require('../assets/road-signs/pedestrian-crossing.png'),
  speed_camera: require('../assets/road-signs/speed-camera.png'),
  traffic_light: require('../assets/road-signs/traffic-light.png'),
};
const names: Record<RoadFeatureKind, string> = {
  stop: 'Стоп', give_way: 'Уступи дорогу', speed_limit_60: 'Ограничение 60',
  pedestrian_crossing: 'Пешеходный переход', speed_camera: 'Камера скорости', traffic_light: 'Светофор',
};

export function RoadFeatureAlerts({ features, along, top }: { features: RoadFeature[]; along: number; top: number }) {
  const theme = useTheme();
  if (!features.length) return null;
  return <View testID="road-feature-alerts" pointerEvents="none" style={[styles.position, { top }]}>
    {features.map(feature => {
      const distance = Math.round(feature.along - along);
      return <View key={feature.id} testID={`road-feature-${feature.kind}`} accessibilityLabel={`${names[feature.kind]}, ${distance > 0 ? `через ${distance} метров` : distance < -10 ? 'уже позади' : 'рядом'}`}
        style={[styles.card, theme.isDark && styles.cardDark]}>
        <Image source={images[feature.kind]} resizeMode="contain" style={styles.image}/>
        <Text style={[styles.distance, theme.isDark && styles.distanceDark]}>{roadFeatureDistanceLabel(feature, along)}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  position: { position: 'absolute', right: 12, alignItems: 'flex-end', gap: 7, zIndex: 11, elevation: 7 },
  card: { width: 78, minHeight: 75, alignItems: 'center', justifyContent: 'center', paddingVertical: 5,
    borderRadius: 15, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5ECF5',
    shadowColor: '#19334F', shadowOpacity: .18, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  cardDark: { backgroundColor: '#151D2B', borderColor: '#3C4A5E' },
  image: { width: 56, height: 51 },
  distance: { fontSize: 12, fontWeight: '800', color: '#182A46', marginTop: 2, fontVariant: ['tabular-nums'] },
  distanceDark: { color: '#F5F8FC' },
});
