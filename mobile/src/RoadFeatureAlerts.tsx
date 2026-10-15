import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { featureSpeedLimit, roadFeatureDistanceLabel, type RoadFeature, type RoadFeatureKind } from './roadFeatures';
import { useTheme } from './design/theme';
import type { Language } from './types';
import { tr } from './ui';

const images: Partial<Record<RoadFeatureKind, number>> = {
  stop: require('../assets/road-signs/stop.png'),
  give_way: require('../assets/road-signs/give-way.png'),
  speed_limit_60: require('../assets/road-signs/speed-60.webp'),
  pedestrian_crossing: require('../assets/road-signs/pedestrian-crossing.png'),
  speed_camera: require('../assets/road-signs/speed-camera.webp'),
  traffic_light: require('../assets/road-signs/traffic-light.webp'),
};
const names: Record<RoadFeatureKind, string> = {
  stop: 'Стоп', give_way: 'Уступи дорогу', speed_limit: 'Ограничение скорости', speed_limit_60: 'Ограничение 60',
  pedestrian_crossing: 'Пешеходный переход', speed_camera: 'Камера скорости', traffic_light: 'Светофор',
};

export function SpeedLimitSign({ speedLimit, size = 52 }: { speedLimit: number; size?: number }) {
  return <View testID="speed-limit-sign" style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
    <Svg width={size} height={size} viewBox="0 0 56 56" style={StyleSheet.absoluteFill}>
      <Circle cx="28" cy="28" r="26" fill="#FFFFFF" stroke="#FFFFFF" strokeWidth="2"/>
      <Circle cx="28" cy="28" r="23" fill="#FFFFFF" stroke="#E43D3D" strokeWidth="5"/>
    </Svg>
    <Text maxFontSizeMultiplier={1.15} style={{ color: '#17212F', fontSize: size * (speedLimit >= 100 ? .34 : .43), fontWeight: '800', fontVariant: ['tabular-nums'], includeFontPadding: false }}>{speedLimit}</Text>
  </View>;
}

function CrossingSign() {
  return <Svg testID="pedestrian-crossing-sign" width={52} height={52} viewBox="0 0 56 56">
    <Rect x="2" y="2" width="52" height="52" rx="7" fill="#FFFFFF"/>
    <Rect x="5" y="5" width="46" height="46" rx="4" fill="#2577CF"/>
    <Path d="M28 10L48 45H8Z" fill="#FFFFFF"/>
    <Path d="M12 43H44M17 39H40" stroke="#17212F" strokeWidth="2"/>
    <Circle cx="29" cy="22" r="3" fill="#17212F"/>
    <Path d="M27 27L24 33L19 35M27 27L33 31L37 31M27 27L30 34L36 40M30 34L25 40" fill="none" stroke="#17212F" strokeWidth="2.7" strokeLinecap="round" strokeLinejoin="round"/>
  </Svg>;
}

export function RoadFeatureAlerts({ features, along, top, language = 'ru' }: { features: RoadFeature[]; along: number; top: number; language?: Language }) {
  const theme = useTheme();
  const t = tr(language);
  if (!features.length) return null;
  return <View testID="road-feature-alerts" pointerEvents="none" style={[styles.position, { top }]}>
    {features.map(feature => {
      const distance = Math.round(feature.along - along);
      const speedLimit = featureSpeedLimit(feature);
      const name = `${t(names[feature.kind])}${feature.kind === 'speed_limit' && speedLimit != null ? ` ${speedLimit}` : ''}`;
      return <View key={feature.id} testID={`road-feature-${feature.kind}`} accessibilityLabel={`${name}, ${distance > 0 ? language === 'ky' ? `${distance} метрден кийин` : language === 'en' ? `in ${distance} meters` : `через ${distance} метров` : distance < -10 ? t('уже позади') : t('рядом')}`}
        style={styles.card}>
        {feature.kind === 'pedestrian_crossing' ? <CrossingSign/> : (feature.kind === 'speed_limit' || feature.kind === 'speed_limit_60') && speedLimit != null
          ? <SpeedLimitSign speedLimit={speedLimit}/> : <Image source={images[feature.kind]} resizeMode="contain" style={styles.image}/>}
        <Text style={[styles.distance, theme.isDark && styles.distanceDark]}>{roadFeatureDistanceLabel(feature, along, language)}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  position: { position: 'absolute', right: 12, alignItems: 'flex-end', gap: 7, zIndex: 11 },
  card: { width: 78, minHeight: 75, alignItems: 'center', justifyContent: 'center', paddingVertical: 5 },
  image: { width: 56, height: 51 },
  distance: { fontSize: 12, fontWeight: '800', color: '#182A46', marginTop: 2, fontVariant: ['tabular-nums'],
    textShadowColor: '#FFFFFF', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  distanceDark: { color: '#F5F8FC', textShadowColor: '#111111' },
});
