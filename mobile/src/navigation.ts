import type { Coordinate, Language, Order, Point } from './types';

export type NavigationFix = Coordinate & { timestamp: number; accuracy: number; heading?: number; speed?: number };
export type RouteStep = {
  distanceMeters: number; durationSeconds: number; name: string;
  maneuver: { type: string; modifier?: string; location: Coordinate; bearingBefore: number; bearingAfter: number; exit?: number };
  geometry: Coordinate[];
};
export type DrivingRoute = { provider: 'osrm'; distanceMeters: number; durationSeconds: number; geometry: Coordinate[]; steps: RouteStep[] };
export type PreparedRoute = { route: DrivingRoute; cumulative: number[]; total: number; offsets: number[] };
export type NavigationProgress = {
  along: number; offRouteMeters: number; remainingMeters: number; remainingSeconds: number;
  stepIndex: number; maneuverDistance: number; instruction: string; arrived: boolean;
  maneuverPassed: boolean; speedMps?: number; pendingStepIndex?: number; pendingStepCount?: number;
};
export const navigationConfig = {
  offRouteMeters: 45,
  rerouteFixes: 3,
  turnConfirmationMeters: 35,
  turnConfirmationFixes: 2,
} as const;
export type NormalizedManeuver = {
  kind: 'depart' | 'arrive' | 'roundabout' | 'exit-roundabout' | 'merge' | 'fork' | 'off-ramp' | 'uturn' | 'turn' | 'continue';
  side: 'left' | 'right' | 'straight' | 'uturn';
  intensity: 'slight' | 'normal' | 'sharp';
  exit?: number;
};
export function bearingDelta(before: number, after: number): number {
  return ((after - before + 540) % 360) - 180;
}
/** OSRM's maneuver is the sole source for the arrow, visible text and speech. */
export function normalizeManeuver(step: RouteStep): NormalizedManeuver {
  const { type, modifier, bearingBefore, bearingAfter, exit } = step.maneuver;
  const kind: NormalizedManeuver['kind'] = type === 'arrive' || type === 'depart' ? type
    : ['roundabout', 'rotary', 'roundabout turn'].includes(type) ? 'roundabout'
    : ['exit roundabout', 'exit rotary'].includes(type) ? 'exit-roundabout'
    : type === 'merge' ? 'merge' : type === 'fork' ? 'fork' : type === 'off ramp' ? 'off-ramp'
    : modifier === 'uturn' || type === 'uturn' ? 'uturn'
    : ['turn', 'end of road', 'on ramp'].includes(type) ? 'turn' : 'continue';
  const delta = bearingDelta(bearingBefore, bearingAfter);
  const side: NormalizedManeuver['side'] = kind === 'uturn' ? 'uturn'
    : modifier?.includes('left') ? 'left' : modifier?.includes('right') ? 'right'
    : kind === 'turn' && Math.abs(delta) > .01 ? delta < 0 ? 'left' : 'right' : 'straight';
  const intensity: NormalizedManeuver['intensity'] = modifier?.startsWith('slight') ? 'slight' : modifier?.startsWith('sharp') ? 'sharp'
    : !modifier && Math.abs(delta) < 40 ? 'slight' : !modifier && Math.abs(delta) > 135 ? 'sharp' : 'normal';
  return { kind, side, intensity, ...(exit == null ? {} : { exit }) };
}
const rad = Math.PI / 180;
export function distanceBetween(a: Coordinate, b: Coordinate) {
  const dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function navigationDestination(order?: Order | null): Point | null {
  return order?.status === 'ASSIGNED' ? order.pickup : order?.status === 'IN_PROGRESS' ? order.dropoff : null;
}
export function usableNavigationFix(fix: NavigationFix | null, now = Date.now()): fix is NavigationFix {
  return !!fix && Number.isFinite(fix.latitude) && Math.abs(fix.latitude) <= 90
    && Number.isFinite(fix.longitude) && Math.abs(fix.longitude) <= 180
    && Number.isFinite(fix.accuracy) && fix.accuracy >= 0 && fix.accuracy <= 80
    && now - fix.timestamp <= 30000 && now >= fix.timestamp - 5000;
}
// Keep the last reliable position through a brief weak signal or a single
// implausible jump. After a GPS gap the new fix becomes the starting point.
export function stableNavigationFix(previous: NavigationFix | null, candidate: NavigationFix, now = Date.now(), pendingJump: NavigationFix | null = null): NavigationFix {
  if (!previous || candidate.timestamp <= previous.timestamp) return previous && candidate.timestamp <= previous.timestamp ? previous : candidate;
  if (!usableNavigationFix(previous, now) || !usableNavigationFix(candidate, now)) {
    return usableNavigationFix(previous, now) ? previous : candidate;
  }
  const seconds = (candidate.timestamp - previous.timestamp) / 1000;
  const distance = distanceBetween(previous, candidate);
  const maximumTravel = Math.max(35, seconds * 45 + Math.max(previous.accuracy, candidate.accuracy));
  if (distance > maximumTravel) {
    // A second nearby accurate reading confirms that GPS really reacquired a
    // different position. Do not freeze the driver at the old street for 30 s.
    if (pendingJump && usableNavigationFix(pendingJump, now)
      && pendingJump.timestamp > previous.timestamp && candidate.timestamp > pendingJump.timestamp
      && candidate.timestamp - pendingJump.timestamp <= 10_000
      && distanceBetween(pendingJump, candidate) <= Math.max(15, Math.min(40, Math.max(pendingJump.accuracy, candidate.accuracy)))) return candidate;
    return previous;
  }
  // When the phone reports that it is stationary, a few metres of GPS noise
  // must not make the marker drift across nearby streets.
  const speed = candidate.speed ?? previous.speed;
  const noise = Math.max(5, Math.min(18, Math.max(previous.accuracy, candidate.accuracy) * .35));
  if (speed != null && speed < 1.5 && distance < noise) {
    return { ...candidate, latitude: previous.latitude, longitude: previous.longitude, heading: previous.heading };
  }
  return candidate;
}
export function bestRussianVoice(voices: { identifier: string; language: string; quality?: string }[]): string | undefined {
  const russian = voices.filter(voice => /^ru(?:$|[-_])/i.test(voice.language));
  russian.sort((a, b) => {
    const score = (voice: typeof a) => (voice.quality === 'Enhanced' ? 4 : 0)
      + (/network|cloud|online/i.test(voice.identifier) ? -6 : 0)
      + (/^ru[-_]RU$/i.test(voice.language) ? 1 : 0);
    return score(b) - score(a);
  });
  return russian[0]?.identifier;
}
export function bestVoiceForLanguage(voices: { identifier: string; language: string; quality?: string }[], language: Language): string | undefined {
  if (language === 'ru') return bestRussianVoice(voices);
  return voices.filter(voice => /^ky(?:$|[-_])/i.test(voice.language)).sort((a, b) =>
    (b.quality === 'Enhanced' ? 1 : 0) - (a.quality === 'Enhanced' ? 1 : 0))[0]?.identifier;
}
function project(point: Coordinate, line: Coordinate[], cumulative: number[], min = 0, max = Infinity) {
  let best = { along: min, distance: Infinity };
  const xScale = 111195 * Math.cos(point.latitude * rad), yScale = 111195;
  for (let i = 1; i < line.length; i++) {
    if (cumulative[i] < min || cumulative[i - 1] > max) continue;
    const ax = (line[i - 1].longitude - point.longitude) * xScale, ay = (line[i - 1].latitude - point.latitude) * yScale;
    const bx = (line[i].longitude - point.longitude) * xScale, by = (line[i].latitude - point.latitude) * yScale;
    const dx = bx - ax, dy = by - ay, squared = dx * dx + dy * dy;
    const length = cumulative[i] - cumulative[i - 1];
    const low = length ? Math.max(0, (min - cumulative[i - 1]) / length) : 0;
    const high = length ? Math.min(1, (max - cumulative[i - 1]) / length) : 1;
    const t = Math.max(low, Math.min(high, squared ? -(ax * dx + ay * dy) / squared : 0));
    const distance = Math.hypot(ax + t * dx, ay + t * dy);
    // Prefer the earliest point at intersections instead of skipping a loop.
    if (distance < best.distance - .01) best = { along: cumulative[i - 1] + t * length, distance };
  }
  return best;
}
function pointAlong(line: Coordinate[], cumulative: number[], along: number): Coordinate {
  const distance = Math.max(0, Math.min(cumulative[cumulative.length - 1], along));
  let index = 1;
  while (index < cumulative.length - 1 && cumulative[index] < distance) index++;
  const length = cumulative[index] - cumulative[index - 1];
  const fraction = length ? (distance - cumulative[index - 1]) / length : 0;
  return {
    latitude: line[index - 1].latitude + (line[index].latitude - line[index - 1].latitude) * fraction,
    longitude: line[index - 1].longitude + (line[index].longitude - line[index - 1].longitude) * fraction,
  };
}
function course(from: Coordinate, to: Coordinate): number {
  const east = (to.longitude - from.longitude) * Math.cos((from.latitude + to.latitude) * rad / 2);
  const north = to.latitude - from.latitude;
  return Math.atan2(east, north) / rad;
}
function routeTurnContradiction(step: RouteStep, along: number, line: Coordinate[], cumulative: number[], total: number): boolean {
  const modifier = step.maneuver.modifier;
  if (!['turn', 'end of road'].includes(step.maneuver.type) || !modifier || !/\b(?:left|right)\b/.test(modifier)) return false;
  if (along < 12 || total - along < 12) return false;
  const before = pointAlong(line, cumulative, along - 18);
  const at = pointAlong(line, cumulative, along);
  const after = pointAlong(line, cumulative, along + 18);
  if (distanceBetween(before, at) < 8 || distanceBetween(at, after) < 8) return false;
  const lineDelta = (course(at, after) - course(before, at) + 540) % 360 - 180;
  const turnDelta = bearingDelta(step.maneuver.bearingBefore, step.maneuver.bearingAfter);
  if (Math.abs(lineDelta) < 40 || Math.abs(lineDelta) > 150 || Math.abs(turnDelta) < 40 || Math.abs(turnDelta) > 150) return false;
  const claimed = modifier.includes('right') ? 1 : -1;
  // A map camera bearing is never involved. Reject an internally conflicting
  // provider step only when its bearings AND route line agree against modifier;
  // never silently swap a spoken left/right command based on a rendered line.
  return Math.sign(lineDelta) === Math.sign(turnDelta) && Math.sign(lineDelta) !== claimed;
}
export function prepareRoute(route: DrivingRoute): PreparedRoute {
  if (route.provider !== 'osrm' || route.geometry.length < 2 || !route.steps.length) throw new Error('Маршрут не содержит данных навигации.');
  const cumulative = [0];
  for (let i = 1; i < route.geometry.length; i++) cumulative.push(cumulative[i - 1] + distanceBetween(route.geometry[i - 1], route.geometry[i]));
  const total = cumulative[cumulative.length - 1];
  let minimum = 0, traversed = 0;
  const offsets = route.steps.map(step => {
    // Full OSRM step geometries preserve distance around loops, even if the
    // arrival coordinate equals an earlier intersection or the departure.
    const expected = Math.min(total, traversed);
    const match = project(step.maneuver.location, route.geometry, cumulative, Math.max(minimum, expected - 10), Math.min(total, expected + 25));
    minimum = match.along;
    for (let i = 1; i < step.geometry.length; i++) traversed += distanceBetween(step.geometry[i - 1], step.geometry[i]);
    return match.along;
  });
  for (let index = 0; index < route.steps.length; index++) {
    if (routeTurnContradiction(route.steps[index], offsets[index], route.geometry, cumulative, total)) {
      throw new Error('Маршрут содержит противоречивый поворот. Попробуйте перестроить маршрут.');
    }
  }
  return { route, cumulative, total, offsets };
}
function maneuverAction(step: RouteStep, language: Language): string {
  const { kind, side, intensity, exit } = normalizeManeuver(step);
  if (language === 'ky') {
    if (kind === 'arrive') return 'Бара турган жериңиз алдыда';
    if (kind === 'depart') return 'Маршрут боюнча жүрө баштаңыз';
    if (kind === 'roundabout') return exit ? `Айланма жолдон ${exit}-чыгууну тандаңыз` : 'Айланма жолго кириңиз';
    if (kind === 'exit-roundabout') return 'Айланма жолдон чыгыңыз';
    if (kind === 'uturn') return 'Артка бурулуңуз';
    if (kind === 'merge') return side === 'left' ? 'Сол тилкеге өтүңүз' : side === 'right' ? 'Оң тилкеге өтүңүз' : 'Жол агымына кошулуңуз';
    if (kind === 'fork') return side === 'left' ? 'Сол жакты кармаңыз' : side === 'right' ? 'Оң жакты кармаңыз' : 'Түз жүрүңүз';
    if (kind === 'off-ramp') return side === 'left' ? 'Сол жактагы чыгууга түшүңүз' : side === 'right' ? 'Оң жактагы чыгууга түшүңүз' : 'Чыгууга түшүңүз';
    if (kind !== 'turn' || side === 'straight') return 'Түз жүрүңүз';
    return intensity === 'slight' ? `Акырын ${side === 'left' ? 'солго' : 'оңго'} бурулуңуз`
      : intensity === 'sharp' ? `Кескин ${side === 'left' ? 'солго' : 'оңго'} бурулуңуз`
      : side === 'left' ? 'Солго бурулуңуз' : 'Оңго бурулуңуз';
  }
  if (kind === 'arrive') return 'Пункт назначения впереди';
  if (kind === 'depart') return 'Начните движение по маршруту';
  if (kind === 'roundabout') return exit ? `На круговом движении выберите съезд ${exit}` : 'Въезжайте на круговое движение';
  if (kind === 'exit-roundabout') return 'Съезжайте с кругового движения';
  if (kind === 'uturn') return 'Развернитесь';
  if (kind === 'merge') return side === 'left' ? 'Перестройтесь левее' : side === 'right' ? 'Перестройтесь правее' : 'Вливайтесь в поток';
  if (kind === 'fork') return side === 'left' ? 'Держитесь левее' : side === 'right' ? 'Держитесь правее' : 'Двигайтесь прямо';
  if (kind === 'off-ramp') return side === 'left' ? 'Съезжайте налево' : side === 'right' ? 'Съезжайте направо' : 'Следуйте на съезд';
  if (kind !== 'turn' || side === 'straight') return 'Двигайтесь прямо';
  const ending = side === 'left' ? 'налево' : 'направо';
  return intensity === 'slight' ? `Плавно поверните ${ending}` : intensity === 'sharp' ? `Резко поверните ${ending}` : `Поверните ${ending}`;
}
export function maneuverText(step: RouteStep, language: Language = 'ru'): string {
  const action = maneuverAction(step, language);
  const name = step.name?.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!name || step.maneuver.type === 'arrive') return action;
  // Older servers can still return OSRM's unlocalized default `name`. Never
  // pronounce an obviously Kyrgyz road label with the Russian voice (or vice
  // versa). The route still gives a correct turn without an uncertain name.
  if (language === 'ru' && /(?:^|\s)(?:көч(?:ө|өсү)?|жолу|көч\.|аянты)(?:\s|$)/iu.test(name)) return action;
  if (language === 'ky' && /^(?:ул(?:ица)?\.?|проспект|пр-т|переулок|бульвар|шоссе)\s/iu.test(name)) return action;
  if (language === 'ky') return `${action}: ${name}`;
  const along = ['depart', 'continue', 'new name', 'notification'].includes(step.maneuver.type);
  const types: { pattern: RegExp; along: string; onto: string }[] = [
    { pattern: /^(?:ул(?:ица)?\.?)\s+/iu, along: 'по улице', onto: 'на улицу' },
    { pattern: /^(?:проспект|пр-т)\s+/iu, along: 'по проспекту', onto: 'на проспект' },
    { pattern: /^(?:переулок|пер\.)\s+/iu, along: 'по переулку', onto: 'в переулок' },
    { pattern: /^(?:бульвар|бул\.)\s+/iu, along: 'по бульвару', onto: 'на бульвар' },
    { pattern: /^шоссе\s+/iu, along: 'по шоссе', onto: 'на шоссе' },
    { pattern: /^проезд\s+/iu, along: 'по проезду', onto: 'на проезд' },
  ];
  const roadType = types.find(type => type.pattern.test(name));
  const street = roadType ? name.replace(roadType.pattern, '') : name;
  return `${action} ${along ? roadType?.along || 'по улице' : roadType?.onto || 'на улицу'} ${street}`;
}
export type PreviousRouteProgress = { along: number; timestamp: number; stepIndex?: number; pendingStepIndex?: number; pendingStepCount?: number };
export function routeProgress(prepared: PreparedRoute, fix: NavigationFix, previous?: PreviousRouteProgress, language: Language = 'ru'): NavigationProgress {
  const { route, cumulative, total, offsets } = prepared;
  const elapsed = previous ? Math.max(1, (fix.timestamp - previous.timestamp) / 1000) : 0;
  // Limit forward jumps across crossings/parallel streets. A long GPS gap is rerouted from the new fix.
  const max = previous ? previous.along + Math.max(100, Math.min(1000, elapsed * 55)) : 100;
  const projection = project(fix, route.geometry, cumulative, Math.max(0, (previous?.along ?? 0) - 35), max);
  const along = projection.distance <= navigationConfig.offRouteMeters ? Math.max(previous?.along ?? 0, projection.along) : previous?.along ?? 0;
  let stepIndex = offsets.findIndex((offset, index) => index > 0 && offset >= along - 8);
  if (stepIndex < 0) stepIndex = route.steps.length - 1;
  let pendingStepIndex: number | undefined, pendingStepCount: number | undefined;
  if (previous?.stepIndex != null && stepIndex > previous.stepIndex) {
    const passedBy = along - offsets[previous.stepIndex];
    const confirmations = previous.pendingStepIndex === stepIndex ? (previous.pendingStepCount ?? 0) + 1 : 1;
    if (passedBy < navigationConfig.turnConfirmationMeters && confirmations < navigationConfig.turnConfirmationFixes) {
      pendingStepIndex = stepIndex; pendingStepCount = confirmations; stepIndex = previous.stepIndex;
    } else stepIndex = Math.min(stepIndex, previous.stepIndex + 1);
  }
  const remainingGeometry = Math.max(0, total - along);
  const arrived = remainingGeometry <= 25 && distanceBetween(fix, route.geometry[route.geometry.length - 1]) <= 35 && projection.distance <= 35;
  const fraction = total > 0 ? remainingGeometry / total : 0;
  return { along, offRouteMeters: projection.distance, remainingMeters: Math.round(route.distanceMeters * fraction), remainingSeconds: Math.ceil(route.durationSeconds * fraction), stepIndex,
    maneuverDistance: Math.max(0, offsets[stepIndex] - along), maneuverPassed: along > offsets[stepIndex] + 2,
    speedMps: fix.speed,
    pendingStepIndex, pendingStepCount,
    instruction: arrived ? language === 'ky' ? 'Жеттиңиз' : 'Вы прибыли' : maneuverText(route.steps[stepIndex], language), arrived };
}
export function displayDistance(meters: number) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} км` : `${Math.max(0, Math.round(meters / 10) * 10)} м`;
}
export type GuidanceCue = { key: string; text: string; priority: number; stage: number; supersedes: string[] };
export function guidanceCue(progress: NavigationProgress, language: Language = 'ru', routeVersion = 0, legIndex = 0): GuidanceCue | null {
  const prefix = `${routeVersion}:${legIndex}:${progress.stepIndex}`;
  if (progress.arrived) return { key: `${prefix}:arrived`, text: language === 'ky' ? 'Бара турган жериңизге жеттиңиз.' : 'Вы прибыли в пункт назначения.', priority: 4, stage: 0, supersedes: [`${prefix}:500`, `${prefix}:200`, `${prefix}:0`] };
  if (progress.maneuverPassed || progress.offRouteMeters > navigationConfig.offRouteMeters) return null;
  const meters = progress.maneuverDistance;
  if (meters > 550) return null;
  const speed = Math.max(0, progress.speedMps ?? 0);
  const nearThreshold = Math.max(50, Math.min(75, speed * 3));
  const approachThreshold = Math.max(200, Math.min(280, speed * 9));
  const stage = meters <= nearThreshold ? 0 : meters <= approachThreshold ? 200 : 500;
  const distance = meters >= 100 ? Math.round(meters / 50) * 50 : Math.max(50, Math.round(meters / 10) * 10);
  const supersedes = stage === 0 ? [`${prefix}:500`, `${prefix}:200`] : stage === 200 ? [`${prefix}:500`] : [];
  return { key: `${prefix}:${stage}`, text: stage === 0 ? `${progress.instruction}.` : language === 'ky' ? `${distance} метрден кийин ${progress.instruction[0].toLowerCase() + progress.instruction.slice(1)}.` : `Через ${distance} метров ${progress.instruction[0].toLocaleLowerCase('ru') + progress.instruction.slice(1)}.`, priority: stage === 0 ? 3 : stage === 200 ? 2 : 1, stage, supersedes };
}
