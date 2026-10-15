import type { PreparedRoute } from './navigation';
import type { Language } from './types';

export type RoadFeatureKind = 'stop' | 'give_way' | 'speed_limit' | 'speed_limit_60' | 'pedestrian_crossing' | 'speed_camera' | 'traffic_light';
export type RoadFeature = { id: string; kind: RoadFeatureKind; latitude: number; longitude: number; along: number; speedLimit?: number; endAlong?: number };
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
  const requestedEnd = Math.min(prepared.total, startAlong + 1200);
  const candidates = [{ ...pointAt(prepared, startAlong), along: startAlong }];
  prepared.route.geometry.forEach((point, index) => {
    const distance = prepared.cumulative[index];
    if (distance > startAlong && distance < requestedEnd) candidates.push({ latitude: point.latitude, longitude: point.longitude, along: distance });
  });
  candidates.push({ ...pointAt(prepared, requestedEnd), along: requestedEnd });
  // Retain actual corners. Uniform 20 m sampling cuts diagonally across a
  // junction and makes the server reject objects on the route's own road.
  const keep = new Set([0, candidates.length - 1]);
  const ranges = [[0, candidates.length - 1]];
  const xScale = 111320 * Math.cos(candidates[0].latitude * Math.PI / 180);
  while (ranges.length) {
    const [first, last] = ranges.pop()!;
    const before = candidates[first], after = candidates[last];
    const dx = (after.longitude - before.longitude) * xScale, dy = (after.latitude - before.latitude) * 111320;
    let farthest = -1, maxDistance = .5;
    for (let index = first + 1; index < last; index++) {
      const x = (candidates[index].longitude - before.longitude) * xScale, y = (candidates[index].latitude - before.latitude) * 111320;
      const fraction = dx * dx + dy * dy > 0 ? Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy))) : 0;
      const distance = Math.hypot(x - dx * fraction, y - dy * fraction);
      if (distance > maxDistance) { maxDistance = distance; farthest = index; }
    }
    if (farthest >= 0) { keep.add(farthest); ranges.push([first, farthest], [farthest, last]); }
  }
  const selected = [...keep].sort((a, b) => a - b).slice(0, 80).map(index => candidates[index]);
  return { startAlong, endAlong: selected[selected.length - 1].along,
    points: selected.map(({ latitude, longitude }) => ({ latitude, longitude })) };
}

export function roadFeatureWarningDistance(feature: Pick<RoadFeature, 'kind'>): number {
  return feature.kind === 'speed_camera' ? 500 : feature.kind === 'speed_limit' || feature.kind === 'speed_limit_60' ? 250 : 150;
}

export function featureSpeedLimit(feature: Pick<RoadFeature, 'kind' | 'speedLimit'>): number | null {
  const limit = feature.speedLimit ?? (feature.kind === 'speed_limit_60' ? 60 : null);
  return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 && limit <= 200 ? Math.round(limit) : null;
}

export function currentRoadSpeedLimit(features: RoadFeature[], along: number): number | null {
  // A point sign cannot establish where its restriction ends. Persistent HUD
  // limits come only from mapped road sections; point signs remain warnings.
  const current = features.filter(feature => (feature.kind === 'speed_limit' || feature.kind === 'speed_limit_60')
    && Number.isFinite(feature.along) && feature.along <= along && feature.endAlong != null
    && Number.isFinite(feature.endAlong) && featureSpeedLimit(feature) != null)
    .sort((a, b) => b.along - a.along)[0];
  return current && along < current.endAlong! ? featureSpeedLimit(current) : null;
}

/** Replace the refreshed route window while keeping continuous section IDs. */
export function mergeRoadFeatureWindow(previous: RoadFeature[], incoming: RoadFeature[], window: Pick<RoadFeatureWindow, 'startAlong' | 'endAlong'>): RoadFeature[] {
  const section = (feature: RoadFeature) => (feature.kind === 'speed_limit' || feature.kind === 'speed_limit_60')
    && feature.endAlong != null && Number.isFinite(feature.endAlong) && featureSpeedLimit(feature) != null;
  const retained = previous.filter(feature => feature.along > window.endAlong);
  const preceding = previous.filter(feature => section(feature) && feature.along < window.startAlong)
    .sort((a, b) => b.along - a.along)[0];
  // The refreshed window is authoritative, including an unknown road section.
  // Its absence of a limit must end an older section at the window boundary.
  if (preceding) retained.push({ ...preceding, endAlong: Math.min(preceding.endAlong!, window.startAlong) });
  const byId = new Map(retained.map(feature => [feature.id, feature]));
  const continuedSections = new Set<string>();
  for (const feature of incoming) {
    if (!feature || typeof feature.id !== 'string' || !Number.isFinite(feature.along)) continue;
    const sameSection = section(feature) && previous.find(item => section(item)
      && !continuedSections.has(item.id)
      && featureSpeedLimit(item) === featureSpeedLimit(feature)
      && item.along < feature.endAlong! && item.endAlong! > feature.along
      && (Math.abs(item.along - feature.along) <= 12
        || feature.along <= window.startAlong + 10 && item.along < window.startAlong));
    // Server sampling can move a section start by a few metres at refresh.
    // Reuse its ID so an already announced upcoming limit is not spoken twice.
    const merged = sameSection ? { ...feature, id: sameSection.id, along: Math.min(sameSection.along, feature.along) } : feature;
    if (sameSection) continuedSections.add(sameSection.id);
    byId.set(merged.id, merged);
  }
  return [...byId.values()];
}

export function visibleRoadFeatures(features: RoadFeature[], along: number): RoadFeature[] {
  const relevant = features.filter(feature => Number.isFinite(feature.along)
    && feature.along - along >= -10 && feature.along - along <= roadFeatureWarningDistance(feature));
  relevant.sort((a, b) => Math.abs(a.along - along) - Math.abs(b.along - along));
  const kinds = new Set<RoadFeatureKind>();
  return relevant.filter(feature => {
    if (kinds.has(feature.kind)) return false;
    kinds.add(feature.kind);
    return true;
  }).slice(0, 3);
}

const russianNames: Record<RoadFeatureKind, string> = {
  stop: 'знак Стоп', give_way: 'знак Уступи дорогу', speed_limit: 'ограничение скорости', speed_limit_60: 'ограничение скорости шестьдесят',
  pedestrian_crossing: 'пешеходный переход', speed_camera: 'камера контроля скорости', traffic_light: 'светофор',
};
const kyrgyzNames: Record<RoadFeatureKind, string> = {
  stop: 'Стоп белгиси', give_way: 'Жол бериңиз белгиси', speed_limit: 'ылдамдык чектөөсү', speed_limit_60: 'ылдамдык чектөөсү алтымыш',
  pedestrian_crossing: 'жөө жүргүнчүлөр өтмөгү', speed_camera: 'ылдамдык камерасы', traffic_light: 'светофор',
};
function russianNumber(value: number) {
  const ones = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const tens = ['', 'десять', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const pieces = [hundreds[Math.floor(value / 100)], value % 100 >= 10 && value % 100 < 20 ? teens[value % 10]
    : [tens[Math.floor(value % 100 / 10)], ones[value % 10]].filter(Boolean).join(' ')];
  return pieces.filter(Boolean).join(' ');
}
export function roadFeatureAnnouncement(features: RoadFeature[], along: number, language: Language): string {
  const englishNames: Record<RoadFeatureKind, string> = {
    stop: 'stop sign', give_way: 'yield sign', speed_limit: 'speed limit', speed_limit_60: 'speed limit sixty',
    pedestrian_crossing: 'pedestrian crossing', speed_camera: 'speed camera', traffic_light: 'traffic light',
  };
  const groups = new Map<number, RoadFeature[]>();
  for (const feature of features) {
    const distance = Math.max(10, Math.round((feature.along - along) / 10) * 10);
    const grouped = groups.get(distance) ?? [];
    if (!grouped.some(item => item.kind === feature.kind && featureSpeedLimit(item) === featureSpeedLimit(feature))) grouped.push(feature);
    groups.set(distance, grouped);
  }
  return [...groups].map(([distance, grouped]) => {
    const names = grouped.map(feature => {
      const name = language === 'ky' ? kyrgyzNames[feature.kind] : language === 'en' ? englishNames[feature.kind] : russianNames[feature.kind];
      return feature.kind === 'speed_limit' ? `${name} ${language === 'ru' ? russianNumber(featureSpeedLimit(feature) ?? 0) : featureSpeedLimit(feature) ?? ''}` : name;
    });
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
