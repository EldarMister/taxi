import type { PreparedRoute } from './navigation';
import type { Language } from './types';

export type RoadFeatureKind = 'stop' | 'give_way' | 'speed_limit_60' | 'pedestrian_crossing' | 'speed_camera' | 'traffic_light';
export type RoadFeature = { id: string; kind: RoadFeatureKind; latitude: number; longitude: number; along: number };
export type RoadFeatureWindow = { startAlong: number; endAlong: number; points: { latitude: number; longitude: number }[] };

function pointAt(prepared: PreparedRoute, along: number) {
  const { geometry } = prepared.route;
  const { cumulative } = prepared;
  const target = Math.max(0, Math.min(prepared.total, along));
  let low = 1, high = cumulative.length - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (cumulative[middle] < target) low = middle + 1; else high = middle;
  }
  const span = cumulative[low] - cumulative[low - 1];
  const fraction = span > 0 ? (target - cumulative[low - 1]) / span : 0;
  return {
    latitude: geometry[low - 1].latitude + (geometry[low].latitude - geometry[low - 1].latitude) * fraction,
    longitude: geometry[low - 1].longitude + (geometry[low].longitude - geometry[low - 1].longitude) * fraction,
  };
}

export function roadFeatureWindow(prepared: PreparedRoute, along: number): RoadFeatureWindow {
  const startAlong = Math.max(0, Math.floor(along - 15));
  const endAlong = Math.min(prepared.total, startAlong + 1200);
  const points = [];
  for (let distance = startAlong; distance < endAlong; distance += 20) points.push(pointAt(prepared, distance));
  points.push(pointAt(prepared, endAlong));
  return { startAlong, endAlong, points };
}

export function visibleRoadFeatures(features: RoadFeature[], along: number): RoadFeature[] {
  const relevant = features.filter(feature => Number.isFinite(feature.along)
    && feature.along - along >= -10 && feature.along - along <= 400);
  relevant.sort((a, b) => Math.abs(a.along - along) - Math.abs(b.along - along));
  const kinds = new Set<RoadFeatureKind>();
  return relevant.filter(feature => {
    if (kinds.has(feature.kind)) return false;
    kinds.add(feature.kind);
    return true;
  }).slice(0, 3);
}

const russianNames: Record<RoadFeatureKind, string> = {
  stop: 'знак Стоп', give_way: 'знак Уступи дорогу', speed_limit_60: 'ограничение скорости шестьдесят',
  pedestrian_crossing: 'пешеходный переход', speed_camera: 'камера контроля скорости', traffic_light: 'светофор',
};
const kyrgyzNames: Record<RoadFeatureKind, string> = {
  stop: 'Стоп белгиси', give_way: 'Жол бериңиз белгиси', speed_limit_60: 'ылдамдык чектөөсү алтымыш',
  pedestrian_crossing: 'жөө жүргүнчүлөр өтмөгү', speed_camera: 'ылдамдык камерасы', traffic_light: 'светофор',
};
function russianNumber(value: number) {
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const tens = ['', 'десять', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста'];
  const pieces = [hundreds[Math.floor(value / 100)], tens[Math.floor(value % 100 / 10)], ones[value % 10]];
  return pieces.filter(Boolean).join(' ');
}
export function roadFeatureAnnouncement(features: RoadFeature[], along: number, language: Language): string {
  const englishNames: Record<RoadFeatureKind, string> = {
    stop: 'stop sign', give_way: 'yield sign', speed_limit_60: 'speed limit sixty',
    pedestrian_crossing: 'pedestrian crossing', speed_camera: 'speed camera', traffic_light: 'traffic light',
  };
  const groups = new Map<number, RoadFeatureKind[]>();
  for (const feature of features) {
    const distance = Math.max(10, Math.round((feature.along - along) / 10) * 10);
    const kinds = groups.get(distance) ?? [];
    if (!kinds.includes(feature.kind)) kinds.push(feature.kind);
    groups.set(distance, kinds);
  }
  return [...groups].map(([distance, kinds]) => {
    const names = kinds.map(kind => language === 'ky' ? kyrgyzNames[kind] : language === 'en' ? englishNames[kind] : russianNames[kind]);
    const joined = names.length < 3 ? names.join(language === 'ky' ? ' жана ' : language === 'en' ? ' and ' : ' и ')
      : `${names.slice(0, -1).join(', ')}${language === 'ky' ? ' жана ' : language === 'en' ? ' and ' : ' и '}${names[names.length - 1]}`;
    return language === 'ky'
      ? `${distance} метрден кийин ${joined}.`
      : language === 'en' ? `In ${distance} meters, ${joined}.`
      : `Через ${russianNumber(distance)} метров ${joined}.`;
  }).join(' ');
}

export function roadFeatureDistanceLabel(feature: RoadFeature, along: number, language: Language = 'ru'): string {
  const distance = Math.round(feature.along - along);
  return distance > 0 ? `${Math.max(0, Math.round(distance / 10) * 10)} ${language === 'en' ? 'm' : 'м'}` : distance < -10 ? language === 'ky' ? 'артта' : language === 'en' ? 'passed' : 'позади' : language === 'en' ? '0 m' : '0 м';
}
