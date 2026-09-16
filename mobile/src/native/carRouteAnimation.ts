export type CarPoint = { latitude: number; longitude: number };
export type CarFix = CarPoint & { accuracy?: number; accuracyM?: number | null; measuredAtMs?: number };
export type CarRoutePath = { points: CarPoint[]; cumulativeMeters: number[]; totalMeters: number };

const radians = Math.PI / 180;
function valid(point: CarPoint): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}
export function carMetresBetween(a: CarPoint, b: CarPoint): number {
  return Math.hypot((b.latitude - a.latitude) * 111320,
    (b.longitude - a.longitude) * 111320 * Math.cos((a.latitude + b.latitude) * radians / 2));
}
function accuracyOf(point: CarFix): number {
  return point.accuracyM ?? point.accuracy ?? Infinity;
}
type Projection = { along: number; distance: number };
function uniqueProjection(point: CarPoint, route: CarPoint[], cumulative: number[], accuracy: number): Projection | null {
  const xScale = 111320 * Math.cos(point.latitude * radians);
  const candidates: Projection[] = [];
  for (let index = 1; index < route.length; index++) {
    const a = route[index - 1], b = route[index];
    const ax = (a.longitude - point.longitude) * xScale, ay = (a.latitude - point.latitude) * 111320;
    const dx = (b.longitude - a.longitude) * xScale, dy = (b.latitude - a.latitude) * 111320;
    const squared = dx * dx + dy * dy;
    if (squared < .01) continue;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / squared));
    candidates.push({ along: cumulative[index - 1] + fraction * (cumulative[index] - cumulative[index - 1]),
      distance: Math.hypot(ax + fraction * dx, ay + fraction * dy) });
  }
  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];
  if (!best || best.distance > Math.max(3, Math.min(5, accuracy * .75))) return null;
  // A route can double back or cross itself. If another non-adjacent location
  // is within GPS uncertainty, neither endpoint identifies a safe road piece.
  if (candidates.some(candidate => Math.abs(candidate.along - best.along) > 15
    && candidate.distance <= best.distance + Math.max(8, accuracy * 2))) return null;
  return best;
}

/** A route bends only the visual frame; the final point is always the verified GPS fix. */
export function trustedCarRoutePath(previous: CarFix, current: CarFix, rendered: CarPoint,
  route: CarPoint[], intervalMs: number): CarRoutePath | null {
  if (!valid(previous) || !valid(current) || !valid(rendered) || route.length < 2 || route.length > 20_000
    || !route.every(valid) || intervalMs < 200 || intervalMs > 3000) return null;
  const fromAccuracy = accuracyOf(previous), toAccuracy = accuracyOf(current);
  if (!Number.isFinite(fromAccuracy) || !Number.isFinite(toAccuracy)
    || fromAccuracy < 0 || toAccuracy < 0 || fromAccuracy > 8 || toAccuracy > 8) return null;
  if (previous.measuredAtMs != null && current.measuredAtMs != null && current.measuredAtMs <= previous.measuredAtMs) return null;
  const direct = carMetresBetween(previous, current);
  if (direct < 1.5 || direct > 35 || carMetresBetween(rendered, previous) > 6) return null;
  const cumulative = [0];
  for (let index = 1; index < route.length; index++) cumulative.push(cumulative[index - 1] + carMetresBetween(route[index - 1], route[index]));
  const start = uniqueProjection(previous, route, cumulative, fromAccuracy);
  const end = uniqueProjection(current, route, cumulative, toAccuracy);
  const visibleStart = uniqueProjection(rendered, route, cumulative, fromAccuracy);
  if (!start || !end || !visibleStart || end.along <= start.along + 1
    || visibleStart.along < start.along - 8 || visibleStart.along > start.along + 3
    || end.along <= visibleStart.along + 1) return null;
  const points: CarPoint[] = [rendered];
  for (let index = 1; index < route.length - 1; index++) {
    if (cumulative[index] > visibleStart.along + .1 && cumulative[index] < end.along - .1) points.push(route[index]);
  }
  points.push(current);
  const pathCumulative = [0];
  for (let index = 1; index < points.length; index++) pathCumulative.push(pathCumulative[index - 1] + carMetresBetween(points[index - 1], points[index]));
  const totalMeters = pathCumulative[pathCumulative.length - 1];
  if (totalMeters > Math.min(60, Math.max(35, intervalMs / 1000 * 35)) || totalMeters > Math.max(8, direct * 1.8)) return null;
  return { points, cumulativeMeters: pathCumulative, totalMeters };
}

/** Short interpolation between two reliable fixes when no road segment can be matched. */
export function trustedCarDirectPath(previous: CarFix, current: CarFix, rendered: CarPoint,
  intervalMs: number): CarRoutePath | null {
  if (!valid(previous) || !valid(current) || !valid(rendered) || intervalMs < 200 || intervalMs > 6000) return null;
  const fromAccuracy = accuracyOf(previous), toAccuracy = accuracyOf(current);
  if (!Number.isFinite(fromAccuracy) || !Number.isFinite(toAccuracy) || fromAccuracy < 0 || toAccuracy < 0
    || fromAccuracy > 20 || toAccuracy > 20) return null;
  if (previous.measuredAtMs != null && current.measuredAtMs != null && current.measuredAtMs <= previous.measuredAtMs) return null;
  const distance = carMetresBetween(previous, current);
  if (distance < 1.5 || distance > Math.min(60, intervalMs / 1000 * 30 + 8)
    || carMetresBetween(rendered, previous) > Math.max(8, fromAccuracy + 3)) return null;
  const points = [rendered, current];
  const totalMeters = carMetresBetween(rendered, current);
  return { points, cumulativeMeters: [0, totalMeters], totalMeters };
}

export function sampleCarRoutePath(path: CarRoutePath, fraction: number): CarPoint {
  const distance = Math.max(0, Math.min(1, fraction)) * path.totalMeters;
  let index = 1;
  while (index < path.cumulativeMeters.length - 1 && path.cumulativeMeters[index] < distance) index++;
  const length = path.cumulativeMeters[index] - path.cumulativeMeters[index - 1];
  const local = length > 0 ? (distance - path.cumulativeMeters[index - 1]) / length : 0;
  const a = path.points[index - 1], b = path.points[index];
  return { latitude: a.latitude + (b.latitude - a.latitude) * local,
    longitude: a.longitude + (b.longitude - a.longitude) * local };
}
