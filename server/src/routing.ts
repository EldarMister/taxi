import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfig } from './config';
import { haversine, Point } from './domain';

export type RouteCoordinate = { latitude: number; longitude: number };
export type RouteStep = {
  distanceMeters: number;
  durationSeconds: number;
  name: string;
  maneuver: {
    type: string;
    modifier?: string;
    location: RouteCoordinate;
    bearingBefore: number;
    bearingAfter: number;
    exit?: number;
  };
  geometry: RouteCoordinate[];
};
export type DrivingRoute = {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RouteCoordinate[];
  provider: 'osrm';
  steps: RouteStep[];
};
export type MatchFix = RouteCoordinate & { accuracy: number; heading?: number; speed?: number };
export type MatchedTrace = RouteCoordinate & { bearing: number | null; confidence: number; distanceM: number };
type RouteLanguage = 'ru' | 'ky';
const ROAD_NAME_BUDGET_MS = 2500;
const MAX_ROAD_NAME_LOOKUPS = 12;

function roadNameProbe(step: RouteStep): RouteCoordinate | null {
  if (step.maneuver.type === 'arrive' || step.geometry.length < 2) return null;
  const segments = step.geometry.slice(1).map((end, index) => haversine(step.geometry[index], end));
  const total = segments.reduce((sum, length) => sum + length, 0);
  // At a junction, reverse geocoding may return the road being left. Probe
  // inside the road segment being entered, and omit tiny ambiguous segments.
  if (total < 25) return null;
  let remaining = Math.min(40, total * 0.6);
  for (let index = 0; index < segments.length; index++) {
    const length = segments[index];
    if (remaining <= length || index === segments.length - 1) {
      const fraction = length ? Math.min(1, remaining / length) : 0;
      return {
        latitude: step.geometry[index].latitude + (step.geometry[index + 1].latitude - step.geometry[index].latitude) * fraction,
        longitude: step.geometry[index].longitude + (step.geometry[index + 1].longitude - step.geometry[index].longitude) * fraction,
      };
    }
    remaining -= length;
  }
  return null;
}

function comparableRoadName(name: string): string {
  return name.toLocaleLowerCase().normalize('NFC').replace(/[.,\s]+/gu, ' ').trim();
}
/** A language tag may replace the OSRM segment name only for that same road. */
export function localizedRoadName(value: unknown, language: RouteLanguage, routeName?: string): string {
  if (!routeName) return '';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const place = value as Record<string, unknown>;
  if ((place.category ?? place.class) !== 'highway' || !place.namedetails || typeof place.namedetails !== 'object' || Array.isArray(place.namedetails)) return '';
  const names = place.namedetails as Record<string, unknown>;
  if (!Object.entries(names).some(([key, name]) => /^name(?::(?:ru|ky))?$/.test(key)
    && typeof name === 'string' && comparableRoadName(name) === comparableRoadName(routeName))) return '';
  const name = names[`name:${language}`];
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid routing object');
  return value as Record<string, unknown>;
}
function nonnegative(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid routing number');
  return value;
}
function bearing(value: unknown): number {
  const result = nonnegative(value);
  if (result >= 360) throw new Error('Invalid bearing');
  return result;
}
function coordinate(value: unknown): RouteCoordinate {
  if (!Array.isArray(value) || value.length < 2) throw new Error('Invalid coordinate');
  const [longitude, latitude] = value;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || typeof longitude !== 'number' || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('Invalid coordinate');
  return {latitude, longitude};
}
function geometry(value: unknown, minimum: number): RouteCoordinate[] {
  const geo = record(value);
  if (geo.type !== 'LineString' || !Array.isArray(geo.coordinates) || geo.coordinates.length < minimum || geo.coordinates.length > 100000) throw new Error('Invalid route geometry');
  return geo.coordinates.map(coordinate);
}

// OSRM returns GeoJSON and maneuver locations in [longitude, latitude] order.
export function parseOsrmRoute(payload: unknown, pickup: RouteCoordinate, dropoff: RouteCoordinate): DrivingRoute {
  const data = record(payload);
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes.length) throw new Error('No driving route');
  const route = record(data.routes[0]);
  const line = geometry(route.geometry, 2);
  if (haversine(pickup, line[0]) > 1000 || haversine(dropoff, line[line.length - 1]) > 1000) throw new Error('Route endpoints too far');
  if (!Array.isArray(route.legs) || route.legs.length !== 1) throw new Error('Invalid route legs');
  const rawSteps = record(route.legs[0]).steps;
  if (!Array.isArray(rawSteps) || rawSteps.length < 2 || rawSteps.length > 10000) throw new Error('Missing maneuvers');
  const steps = rawSteps.map((value): RouteStep => {
    const step = record(value);
    const maneuver = record(step.maneuver);
    if (typeof maneuver.type !== 'string' || !maneuver.type || maneuver.type.length > 80 || typeof step.name !== 'string' || step.name.length > 1000) throw new Error('Invalid maneuver');
    if (maneuver.modifier !== undefined && (typeof maneuver.modifier !== 'string' || maneuver.modifier.length > 80)) throw new Error('Invalid modifier');
    if (maneuver.exit !== undefined && (typeof maneuver.exit !== 'number' || !Number.isInteger(maneuver.exit) || maneuver.exit < 1)) throw new Error('Invalid exit');
    return {
      distanceMeters: nonnegative(step.distance),
      durationSeconds: nonnegative(step.duration),
      name: step.name,
      geometry: geometry(step.geometry, 1),
      maneuver: {
        type: maneuver.type,
        ...(maneuver.modifier === undefined ? {} : {modifier: maneuver.modifier as string}),
        location: coordinate(maneuver.location),
        bearingBefore: bearing(maneuver.bearing_before),
        bearingAfter: bearing(maneuver.bearing_after),
        ...(maneuver.exit === undefined ? {} : {exit: maneuver.exit as number}),
      },
    };
  });
  if (steps[0].maneuver.type !== 'depart' || steps[steps.length - 1].maneuver.type !== 'arrive') throw new Error('Incomplete maneuvers');
  return {distanceMeters: Math.round(nonnegative(route.distance)), durationSeconds: Math.ceil(nonnegative(route.duration)), geometry: line, provider: 'osrm', steps};
}

export function parseOsrmMatch(payload: unknown, fixes: MatchFix[]): MatchedTrace | null {
  const data = record(payload);
  if (data.code !== 'Ok' || !Array.isArray(data.tracepoints) || data.tracepoints.length !== fixes.length
    || !Array.isArray(data.matchings)) return null;
  const last = data.tracepoints.at(-1);
  if (!last || typeof last !== 'object') return null;
  const point = record(last);
  const index = point.matchings_index;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= data.matchings.length) return null;
  const matching = record(data.matchings[index]);
  const confidence = matching.confidence;
  if (typeof confidence !== 'number' || confidence < .55 || confidence > 1) return null;
  const snapped = coordinate(point.location);
  const distanceM = haversine(snapped, fixes[fixes.length - 1]);
  if (distanceM > Math.max(25, fixes[fixes.length - 1].accuracy * 1.5)) return null;
  let bearing: number | null = null;
  for (let i = data.tracepoints.length - 2; i >= 0; i--) {
    const candidate = data.tracepoints[i];
    if (!candidate || typeof candidate !== 'object' || candidate.matchings_index !== index) continue;
    const before = coordinate(candidate.location);
    if (haversine(before, snapped) < 3) continue;
    const east = (snapped.longitude - before.longitude) * Math.cos(snapped.latitude * Math.PI / 180);
    const north = snapped.latitude - before.latitude;
    bearing = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
    break;
  }
  return { ...snapped, bearing, confidence, distanceM };
}

@Injectable()
export class RoutingService {
  private readonly names = new Map<string, { name: string; expires: number }>();
  constructor(private readonly config: AppConfig) {}
  private async roadName(point: RouteCoordinate, language: RouteLanguage, routeName: string, timeoutMs: number): Promise<string> {
    if (!this.config.nominatimBaseUrl) return '';
    const key = `${language}:${routeName}:${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`;
    const cached = this.names.get(key);
    if (cached && cached.expires > Date.now()) return cached.name;
    const url = new URL(`${this.config.nominatimBaseUrl}/reverse`);
    url.search = new URLSearchParams({ format: 'jsonv2', lat: point.latitude.toFixed(6), lon: point.longitude.toFixed(6), zoom: '17', namedetails: '1', addressdetails: '0', 'accept-language': language === 'ky' ? 'ky,ru,en' : 'ru,ky,en' }).toString();
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { 'User-Agent': this.config.nominatimUserAgent, Accept: 'application/json' } });
      if (!response.ok) return '';
      const name = localizedRoadName(await response.json(), language, routeName);
      if (this.names.size >= 1000) this.names.delete(this.names.keys().next().value!);
      this.names.set(key, { name, expires: Date.now() + (name ? 10 * 60_000 : 30_000) });
      return name;
    } catch { return ''; }
  }
  private async localize(route: DrivingRoute, language: RouteLanguage): Promise<DrivingRoute> {
    // The extract's default name may be old or in another language. It cannot
    // be spoken as a localized street name without a matching language tag.
    const steps = route.steps.map(step => ({ ...step, name: '' }));
    const jobs = route.steps.slice(0, MAX_ROAD_NAME_LOOKUPS).map((step, index) => ({ index, name: step.name.trim(), point: roadNameProbe(step) }))
      .filter((job): job is { index: number; name: string; point: RouteCoordinate } => !!job.name && !!job.point);
    const deadline = Date.now() + ROAD_NAME_BUDGET_MS;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (cursor < jobs.length && Date.now() < deadline) {
        const job = jobs[cursor++];
        const translated = await this.roadName(job.point, language, job.name, Math.min(1200, Math.max(1, deadline - Date.now())));
        if (translated) steps[job.index].name = translated;
      }
    }));
    return { ...route, steps };
  }
  async matchTrace(fixes: MatchFix[], timeoutMs = 2500): Promise<MatchedTrace | null> {
    if (!Array.isArray(fixes) || fixes.length < 3 || fixes.length > 10) throw new BadRequestException('Некорректный GPS трек.');
    for (const fix of fixes) if (!Number.isFinite(fix.latitude) || Math.abs(fix.latitude) > 90
      || !Number.isFinite(fix.longitude) || Math.abs(fix.longitude) > 180
      || !Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 80)
      throw new BadRequestException('Некорректная GPS точка.');
    try {
      const coordinates = fixes.map(fix => `${fix.longitude},${fix.latitude}`).join(';');
      const url = new URL(`${this.config.osrmBaseUrl}/match/v1/driving/${coordinates}`);
      url.search = new URLSearchParams({ geometries: 'geojson', overview: 'false', steps: 'false',
        radiuses: fixes.map(fix => Math.max(5, Math.min(30, Math.ceil(fix.accuracy * 1.5)))).join(';'),
        bearings: fixes.map(fix => fix.heading != null && (fix.speed ?? 0) >= 3 && fix.accuracy <= 15
          ? `${Math.round(fix.heading) % 360},50` : '').join(';') }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      return parseOsrmMatch(await response.json(), fixes);
    } catch { return null; }
  }
  async route(pickup: Point, dropoff: Point, timeoutMs = 12000, language?: RouteLanguage,
    options: { bearing?: number; fast?: boolean } = {}): Promise<DrivingRoute> {
    for (const point of [pickup, dropoff]) {
      if (!point || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) throw new BadRequestException('Некорректные координаты маршрута.');
    }
    if (options.bearing != null && (!Number.isFinite(options.bearing) || options.bearing < 0 || options.bearing >= 360))
      throw new BadRequestException('Некорректное направление движения.');
    try {
      const coordinates = `${pickup.longitude},${pickup.latitude};${dropoff.longitude},${dropoff.latitude}`;
      const url = new URL(`${this.config.osrmBaseUrl}/route/v1/driving/${coordinates}`);
      url.search = new URLSearchParams({steps:'true', geometries:'geojson', overview:'full', alternatives:'false',
        ...(options.bearing == null ? {} : { bearings: `${Math.round(options.bearing) % 360},45;` }) }).toString();
      const fetchRoute = async () => {
        const response = await fetch(url, {signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers:{Accept:'application/json'}});
        if (!response.ok) throw new Error('Routing unavailable');
        return parseOsrmRoute(await response.json(), pickup, dropoff);
      };
      let route: DrivingRoute;
      try { route = await fetchRoute(); }
      catch (error) {
        if (options.bearing == null || !(error instanceof Error) || error.message !== 'No driving route') throw error;
        url.searchParams.delete('bearings');
        route = await fetchRoute();
      }
      return options.fast ? { ...route, steps: route.steps.map(step => ({ ...step, name: '' })) }
        : language ? await this.localize(route, language) : route;
    } catch {
      throw new ServiceUnavailableException('Не удалось построить автомобильный маршрут. Уточните точки и попробуйте снова.');
    }
  }
}
