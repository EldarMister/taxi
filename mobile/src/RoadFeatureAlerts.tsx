import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';
import { roadFeatureDistanceLabel, type RoadFeature, type RoadFeatureKind } from './roadFeatures';
import { useTheme } from './design/theme';

const images: Partial<Record<RoadFeatureKind, number>> = {
  stop: require('../assets/road-signs/stop.png'),
  give_way: require('../assets/road-signs/give-way.png'),
  speed_limit_60: require('../assets/road-signs/speed-60.png'),
  pedestrian_crossing: require('../assets/road-signs/pedestrian-crossing.png'),
  speed_camera: require('../assets/road-signs/speed-camera.png'),
};
const names: Record<RoadFeatureKind, string> = {
  stop: 'Стоп', give_way: 'Уступи дорогу', speed_limit_60: 'Ограничение 60',
  pedestrian_crossing: 'Пешеходный переход', speed_camera: 'Камера скорости', traffic_light: 'Светофор',
};

function TrafficLight() {
  return <Svg width={43} height={55} viewBox="0 0 43 55" accessibilityLabel="Светофор">
    <Rect x="5" y="1" width="33" height="53" rx="10" fill="#18243A" stroke="#F4F7FB" strokeWidth="2"/>
    <Rect x="8" y="4" width="27" height="47" rx="7" fill="#26354B"/>
    <Circle cx="21.5" cy="13" r="6" fill="#F04438"/><Circle cx="19.5" cy="11" r="2" fill="#FF9A91"/>
    <Circle cx="21.5" cy="27" r="6" fill="#F9B62F"/><Circle cx="19.5" cy="25" r="2" fill="#FFE5A6"/>
    <Circle cx="21.5" cy="41" r="6" fill="#26B66B"/><Circle cx="19.5" cy="39" r="2" fill="#9EF1BE"/>
  </Svg>;
}

export function RoadFeatureAlerts({ features, along, top }: { features: RoadFeature[]; along: number; top: number }) {
  const theme = useTheme();
  if (!features.length) return null;
  return <View testID="road-feature-alerts" pointerEvents="none" style={[styles.position, { top }]}>
    {features.map(feature => {
      const distance = Math.round(feature.along - along);
      return <View key={feature.id} testID={`road-feature-${feature.kind}`} accessibilityLabel={`${names[feature.kind]}, ${distance > 0 ? `через ${distance} метров` : distance < -10 ? 'уже позади' : 'рядом'}`}
        style={[styles.card, theme.isDark && styles.cardDark]}>
        {feature.kind === 'traffic_light' ? <TrafficLight/> : <Image source={images[feature.kind]} resizeMode="contain" style={styles.image}/>}
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
