import { carMetresBetween, type CarFix, type CarPoint } from './carRouteAnimation';

export type RoadMatch = CarPoint & { along: number; distance: number; heading: number; segmentIndex: number; progress: number };
const radians = Math.PI / 180;
const distancesByRoute = new WeakMap<CarPoint[], number[]>();

function cumulative(route: CarPoint[]) {
  const cached = distancesByRoute.get(route);
  if (cached) return cached;
  const values = [0];
  for (let i = 1; i < route.length; i++) values.push(values[i - 1] + carMetresBetween(route[i - 1], route[i]));
  distancesByRoute.set(route, values);
  return values;
}
function lowerBound(values: number[], target: number): number {
  let low = 0, high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function pointAlongRoad(route: CarPoint[], along: number): CarPoint | null {
  if (route.length < 2) return null;
  const distances = cumulative(route);
  const target = Math.max(0, Math.min(along, distances[distances.length - 1]));
  const i = Math.max(1, Math.min(distances.length - 1, lowerBound(distances, target)));
  const length = distances[i] - distances[i - 1];
  const fraction = length > 0 ? (target - distances[i - 1]) / length : 0;
  return { latitude: route[i - 1].latitude + (route[i].latitude - route[i - 1].latitude) * fraction,
    longitude: route[i - 1].longitude + (route[i].longitude - route[i - 1].longitude) * fraction };
}

/** Bearing of the visible car at its current position, softened across a bend. */
export function roadHeadingAt(route: CarPoint[], along: number): number | null {
  const behind = pointAlongRoad(route, along - 2);
  const ahead = pointAlongRoad(route, along + 2);
  if (!behind || !ahead || carMetresBetween(behind, ahead) < .1) return null;
  const east = (ahead.longitude - behind.longitude) * Math.cos(behind.latitude * radians);
  const north = ahead.latitude - behind.latitude;
  return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
}

export function remainingRoad(route: CarPoint[], along: number): CarPoint[] {
  if (route.length < 2 || along <= 0) return route;
  const distances = cumulative(route);
  if (along >= distances[distances.length - 1] - 3) return [];
  const start = pointAlongRoad(route, along)!;
  const index = Math.min(distances.length - 1, lowerBound(distances, along + .000001));
  return [start, ...route.slice(index)];
}

/** A bounded, unsimplified road section for replaying the same turn on the client. */
export function trackingRoadWindow(route: CarPoint[], along: number): CarPoint[] | undefined {
  if (route.length < 2 || !Number.isFinite(along)) return undefined;
  const distances = cumulative(route);
  const start = Math.max(0, along - 400);
  const end = Math.min(distances[distances.length - 1], along + 80);
  if (end <= start) return undefined;
  const points = [pointAlongRoad(route, start)!];
  for (let i = lowerBound(distances, start + .001); i < route.length && distances[i] < end; i++) {
    points.push({ latitude: route[i].latitude, longitude: route[i].longitude });
    // Never simplify away a corner to fit a network packet.
    if (points.length >= 128) return undefined;
  }
  points.push(pointAlongRoad(route, end)!);
  return points;
}

/** Match a usable GPS fix to its active driving route without choosing a distant road. */
export function snapCarToRoad(fix: CarFix & { heading?: number; speed?: number }, route: CarPoint[], previousAlong?: number,
  forwardWindow = 180): RoadMatch | null {
  const accuracy = fix.accuracyM ?? fix.accuracy;
  if (!Number.isFinite(accuracy) || accuracy! < 0 || accuracy! > (previousAlong == null ? 45 : 80)
    || route.length < 2 || route.length > 20000) return null;
  const distances = cumulative(route);
  const xScale = 111320 * Math.cos(fix.latitude * radians);
  const matches: RoadMatch[] = [];
  // Search locally after the first fix. At a crossing, a nearby segment on a
  // different leg must not steal the position from the current leg.
  const searchBehind = previousAlong == null ? 0 : Math.max(0, previousAlong - 20);
  const searchAhead = previousAlong == null ? Infinity : previousAlong + Math.max(100, Math.min(1000, forwardWindow));
  const first = previousAlong == null ? 1 : Math.max(1, lowerBound(distances, searchBehind));
  const last = previousAlong == null ? route.length - 1 : Math.min(route.length - 1, lowerBound(distances, searchAhead) + 1);
  for (let i = first; i <= last; i++) {
    const a = route[i - 1], b = route[i];
    const ax = (a.longitude - fix.longitude) * xScale, ay = (a.latitude - fix.latitude) * 111320;
    const dx = (b.longitude - a.longitude) * xScale, dy = (b.latitude - a.latitude) * 111320;
    const length2 = dx * dx + dy * dy;
    if (length2 < 1) continue;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
    const along = distances[i - 1] + fraction * (distances[i] - distances[i - 1]);
    if (previousAlong != null && along < previousAlong - 12) continue;
    matches.push({ latitude: a.latitude + (b.latitude - a.latitude) * fraction,
      longitude: a.longitude + (b.longitude - a.longitude) * fraction,
      along, distance: Math.hypot(ax + fraction * dx, ay + fraction * dy),
      heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360,
      segmentIndex: i - 1, progress: distances[distances.length - 1] > 0 ? along / distances[distances.length - 1] : 0 });
  }
  const maxDistance = Math.max(10, Math.min(35, accuracy! * 1.4));
  const nearby = matches.filter(match => match.distance <= maxDistance);
  const course = fix.heading != null && Number.isFinite(fix.heading) && (fix.speed == null || fix.speed >= 1.5)
    ? fix.heading : null;
  const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  const score = (match: RoadMatch) => match.distance
    + (course == null ? 0 : angle(match.heading, course) > 100 ? 50 : angle(match.heading, course) > 55 ? 14 : 0)
    + (previousAlong == null ? 0 : Math.abs(match.along - previousAlong) * .15);
  nearby.sort((a, b) => score(a) - score(b));
  const best = nearby[0];
  if (!best) return null;
  const competing = nearby.filter(match => Math.abs(match.along - best.along) > 30
    && Math.abs(score(match) - score(best)) < Math.max(4, accuracy! * .5));
  if (competing.length && previousAlong == null) return null;
  const chosen = best;
  // At driving speed a perpendicular course means the car has taken another
  // street; holding it on the old route would freeze navigation at that turn.
  if (course != null && angle(chosen.heading, course) > (fix.speed != null && fix.speed >= 3 ? 75 : 110)) return null;
  if (previousAlong != null && chosen.along < previousAlong) {
    const held = pointAlongRoad(route, previousAlong);
    const heldSegment = Math.max(0, Math.min(route.length - 2, lowerBound(distances, previousAlong) - 1));
    if (held) return { ...chosen, ...held, along: previousAlong,
      segmentIndex: heldSegment,
      heading: roadHeadingAt(route, previousAlong) ?? chosen.heading,
      progress: distances[distances.length - 1] > 0 ? previousAlong / distances[distances.length - 1] : 0 };
  }
  return chosen;
}
