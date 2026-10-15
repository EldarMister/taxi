import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { haversine } from './domain';
import { containsPoint, RoadFeatureUpdates, type RoadOverlay } from './road-feature-updates';

export type RoadFeatureKind = 'stop' | 'give_way' | 'speed_limit' | 'speed_limit_60' | 'pedestrian_crossing' | 'speed_camera' | 'traffic_light';
export type RoadFeature = { id: string; kind: RoadFeatureKind; latitude: number; longitude: number; along: number; endAlong?: number; speedLimit?: number };
export type RoadPoint = { latitude: number; longitude: number };
export type MapRoadFeature = { id: string; kind: 'traffic_light' | 'pedestrian_crossing'; latitude: number; longitude: number; bearing?: number; widthMeters?: number; roadClass?: string };
export type MapBounds = { south: number; west: number; north: number; east: number };
export type OsmNode = { id: number | string; latitude: number; longitude: number; tags: Record<string, string>; bearing?: number;
  roads?: { latitude: number; longitude: number; bearing: number; distance: number; widthMeters?: number; roadClass?: string }[] };
export type SpeedWay = { id: number; geometry: RoadPoint[]; tags: Record<string, string> };

export function legacyRoadFeatures(features: RoadFeature[]): RoadFeature[] {
  return features.flatMap(feature => feature.kind !== 'speed_limit' ? [feature]
    : feature.speedLimit === 60 && feature.endAlong == null ? [{ ...feature, kind: 'speed_limit_60' as const }] : []);
}
type SpeedSegment = { id: number; index: number; before: RoadPoint; after: RoadPoint; tags: Record<string, string> };

/** Numeric OSM limits are km/h unless an explicit unit is given. Never guess a road default. */
export function parseSpeedLimit(value?: string): number | undefined {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(km\/?h|kph|mph)?$/i);
  if (!match) return undefined;
  const speed = Math.round(Number(match[1]) * (match[2]?.toLowerCase() === 'mph' ? 1.609344 : 1));
  return speed > 0 && speed <= 200 ? speed : undefined;
}
function nodeSpeedLimit(tags: Record<string, string>) {
  const encoded = (tags.traffic_sign || '').match(/(?:^|[;,])\s*(?:[a-z]{2}:)?3\.24\[(\d+)\]/i);
  return parseSpeedLimit(encoded?.[1] ?? tags.maxspeed);
}

function kinds(tags: Record<string, string>): RoadFeatureKind[] {
  const sign = (tags.traffic_sign || '').toLowerCase();
  const tokens = sign.split(/[;,]/).map(value => value.trim());
  const has = (value: string) => tokens.includes(value);
  const highways = (tags.highway || '').split(';').map(value => value.trim());
  const crossings = (tags.crossing || '').split(';').map(value => value.trim());
  const result: RoadFeatureKind[] = [];
  if (highways.includes('traffic_signals') || crossings.includes('traffic_signals') || crossings.includes('pedestrian_signals') || tags['crossing:signals'] === 'yes') result.push('traffic_light');
  if (tags.highway === 'stop' || has('stop')) result.push('stop');
  if (tags.highway === 'give_way' || has('give_way') || has('yield')) result.push('give_way');
  if ((highways.includes('crossing') && tags.crossing !== 'no') || tags.footway === 'crossing'
    || (tags.railway !== 'level_crossing' && tags.crossing && tags.crossing !== 'no') || has('pedestrian_crossing')
    || tokens.some(value => /^(?:[a-z]{2}:)?5\.19\.[12]$/i.test(value))) result.push('pedestrian_crossing');
  if (highways.includes('speed_camera') || (tags.enforcement || '').split(/[;,]/).some(value => ['maxspeed', 'average_speed'].includes(value.trim())) || has('speed_camera')) result.push('speed_camera');
  // A camera/crossing's maxspeed describes that feature, rather than a separate sign.
  if (nodeSpeedLimit(tags) && (has('maxspeed') || tokens.some(value => /^(?:[a-z]{2}:)?3\.24\[\d+\]$/i.test(value))
    || !tags.highway && !result.includes('speed_camera') && !!tags.maxspeed)) result.push('speed_limit');
  return result;
}

function projection(point: RoadPoint, points: RoadPoint[], cumulative: number[]) {
  let best = { along: 0, distance: Infinity, heading: 0 };
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1], after = points[index];
    const xScale = 111320 * Math.cos(point.latitude * Math.PI / 180);
    const ax = (before.longitude - point.longitude) * xScale;
    const ay = (before.latitude - point.latitude) * 111320;
    const dx = (after.longitude - before.longitude) * xScale;
    const dy = (after.latitude - before.latitude) * 111320;
    const length2 = dx * dx + dy * dy;
    if (length2 < 1) continue;
    const fraction = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
    const distance = Math.hypot(ax + dx * fraction, ay + dy * fraction);
    if (distance < best.distance) best = { distance,
      along: cumulative[index - 1] + (cumulative[index] - cumulative[index - 1]) * fraction,
      heading: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
  }
  return best;
}

function angleDifference(a: number, b: number) { return Math.abs(((a - b + 540) % 360) - 180); }
function numericDirection(value?: string): number | null {
  if (!value) return null;
  const direction = Number(value.replace(/°$/, ''));
  return Number.isFinite(direction) && direction >= 0 && direction < 360 ? direction : null;
}

export function selectRoadFeatures(nodes: OsmNode[], points: RoadPoint[], startAlong: number): RoadFeature[] {
  if (points.length < 2) return [];
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) cumulative.push(cumulative[index - 1] + haversine(points[index - 1], points[index]));
  const result: RoadFeature[] = [];
  for (const node of nodes) {
    const projected = projection(node, points, cumulative);
    for (const kind of kinds(node.tags)) {
      const roadside = node.tags.traffic_sign || kind === 'speed_camera';
      if (projected.distance > (kind === 'speed_camera' ? 55 : roadside ? 28 : 18)) continue;
      // The warning's own road must coincide with this route at the feature.
      // Mere proximity to a junction includes signs on crossing side streets.
      if (node.roads?.length && !node.roads.some(road => {
        const routeAtRoad = projection(road, points, cumulative);
        const roadAngle = angleDifference(road.bearing, routeAtRoad.heading);
        return routeAtRoad.distance <= 8 && Math.min(roadAngle, 180 - roadAngle) <= 40
          && Math.abs(routeAtRoad.along - projected.along) <= 40;
      })) continue;
      const direction = numericDirection(node.tags['traffic_sign:direction'] || node.tags['traffic_signals:direction']);
      if (direction != null && kind !== 'speed_camera' && angleDifference(direction, projected.heading) > 70) continue;
      const speedLimit = kind === 'speed_limit' || kind === 'speed_camera' ? nodeSpeedLimit(node.tags) : undefined;
      result.push({ id: `${node.id}:${kind}`, kind, latitude: node.latitude, longitude: node.longitude,
        along: Math.round(startAlong + projected.along), ...(speedLimit ? { speedLimit } : {}) });
    }
  }
  return deduplicateWarnings(result);
}

function deduplicateWarnings(result: RoadFeature[]) {
  result.sort((a, b) => a.along - b.along || a.id.localeCompare(b.id));
  return result.filter((item, index) => item.endAlong != null || !result.slice(0, index).some(previous => previous.kind === item.kind
    && previous.endAlong == null && previous.speedLimit === item.speedLimit && Math.abs(previous.along - item.along) <= 25)).slice(0, 160);
}
function speedSegments(ways: SpeedWay[]): SpeedSegment[] {
  return ways.flatMap(way => way.geometry.slice(1).map((after, index) => ({ id: way.id, index, before: way.geometry[index], after, tags: way.tags })));
}
function speedFeatures(candidates: SpeedSegment[], points: RoadPoint[], startAlong: number): RoadFeature[] {
  if (points.length < 2) return [];
  const result: RoadFeature[] = [];
  let along = startAlong, active: RoadFeature | undefined;
  // Sampling also supports a caller that sends a sparse route polyline.
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1], after = points[index], length = haversine(before, after);
    const count = Math.max(1, Math.ceil(length / 10));
    const heading = projection(before, [before, after], [0, length]).heading;
    for (let sample = 0; sample < count; sample++) {
      const fraction = (sample + .5) / count;
      const point = { latitude: before.latitude + (after.latitude - before.latitude) * fraction,
        longitude: before.longitude + (after.longitude - before.longitude) * fraction };
      let best: { segment: SpeedSegment; speed?: number; score: number } | undefined;
      for (const segment of candidates) {
        const road = projection(point, [segment.before, segment.after], [0, haversine(segment.before, segment.after)]);
        const difference = angleDifference(heading, road.heading), angle = Math.min(difference, 180 - difference);
        if (road.distance > 10 || angle > 35) continue;
        const forward = difference <= 90, oneway = segment.tags.oneway;
        if ((!forward && ['yes', '1', 'true'].includes(oneway)) || forward && oneway === '-1') continue;
        const speed = parseSpeedLimit(segment.tags[forward ? 'maxspeed:forward' : 'maxspeed:backward'] ?? segment.tags.maxspeed);
        const score = road.distance + angle * .08;
        if (!best || score < best.score) best = { segment, speed, score };
      }
      const sampleAlong = Math.round(along + length * sample / count);
      // An untagged frontage road can be closer than a parallel tagged road.
      // Match the actual road first; its missing limit must not borrow a neighbour's.
      if (!best?.speed) { active = undefined; continue; }
      if (!active || active.speedLimit !== best.speed) {
        active = { id: `way/${best.segment.id}:speed_limit:${sampleAlong}`, kind: 'speed_limit', ...point,
          along: sampleAlong, endAlong: sampleAlong, speedLimit: best.speed };
        result.push(active);
      }
      active.endAlong = Math.round(along + length * (sample + 1) / count);
    }
    along += length;
  }
  return result;
}
export function selectSpeedLimits(ways: SpeedWay[], points: RoadPoint[], startAlong: number) {
  return speedFeatures(speedSegments(ways), points, startAlong);
}
function inside(point: RoadPoint, bounds: MapBounds) {
  return point.latitude >= bounds.south && point.latitude <= bounds.north && point.longitude >= bounds.west && point.longitude <= bounds.east;
}
export function selectMapFeatures(nodes: OsmNode[], bounds: MapBounds): MapRoadFeature[] {
  const result: MapRoadFeature[] = [];
  for (const node of nodes) {
    if (!inside(node, bounds)) continue;
    for (const kind of kinds(node.tags)) {
      if (kind !== 'pedestrian_crossing' && kind !== 'traffic_light') continue;
      // A signal-controlled crossing is one crossing, not an extra traffic light.
      // Only independently mapped highway signals get their own map icon.
      if (kind === 'traffic_light' && !(node.tags.highway || '').split(';').map(value => value.trim()).includes('traffic_signals')) continue;
      const feature: MapRoadFeature = { id: `${node.id}:${kind}`, kind, latitude: node.latitude, longitude: node.longitude };
      if (kind === 'pedestrian_crossing') {
        const road = node.roads?.find(item => Number.isFinite(item.bearing) && item.distance <= 45);
        const bearing = road?.bearing ?? node.bearing;
        if (bearing != null && Number.isFinite(bearing)) feature.bearing = (bearing + 360) % 360;
        feature.widthMeters = Math.max(5, Math.min(18, road?.widthMeters ?? 7));
        if (road?.roadClass) feature.roadClass = road.roadClass;
      }
      result.push(feature);
    }
  }
  return result;
}

@Injectable()
export class RoadFeaturesService {
  private readonly cells = new Map<string, OsmNode[]>();
  private readonly speedCells = new Map<string, SpeedSegment[]>();
  private readonly updates = new RoadFeatureUpdates();
  readonly generatedAt: string;
  readonly sourceTimestamp?: string;
  constructor() {
    const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), 'data/road-features-kg.json'), 'utf8')) as {
      generatedAt: string; sourceTimestamp?: string; elements: OsmNode[]; speedWays?: SpeedWay[]; nearbyRoads?: SpeedWay[] };
    this.generatedAt = snapshot.generatedAt;
    this.sourceTimestamp = snapshot.sourceTimestamp;
    for (const node of snapshot.elements) {
      const key = this.cellKey(node.latitude, node.longitude);
      const cell = this.cells.get(key) || [];
      cell.push(node); this.cells.set(key, cell);
    }
    for (const segment of speedSegments([...(snapshot.speedWays ?? []), ...(snapshot.nearbyRoads ?? [])])) {
      const bounds = { south: Math.min(segment.before.latitude, segment.after.latitude), north: Math.max(segment.before.latitude, segment.after.latitude),
        west: Math.min(segment.before.longitude, segment.after.longitude), east: Math.max(segment.before.longitude, segment.after.longitude) };
      for (let lat = Math.floor(bounds.south * 100); lat <= Math.floor(bounds.north * 100); lat++)
        for (let lon = Math.floor(bounds.west * 100); lon <= Math.floor(bounds.east * 100); lon++) {
          const key = `${lat}:${lon}`, cell = this.speedCells.get(key) || [];
          cell.push(segment); this.speedCells.set(key, cell);
        }
    }
  }
  private cellKey(latitude: number, longitude: number) { return `${Math.floor(latitude * 100)}:${Math.floor(longitude * 100)}`; }
  private inCells<T>(cells: Map<string, T[]>, bounds: MapBounds): T[] {
    const result = new Set<T>();
    for (let lat = Math.floor(bounds.south * 100); lat <= Math.floor(bounds.north * 100); lat++) {
      for (let lon = Math.floor(bounds.west * 100); lon <= Math.floor(bounds.east * 100); lon++) {
        for (const item of cells.get(`${lat}:${lon}`) || []) result.add(item);
      }
    }
    return [...result];
  }
  private nodes(bounds: MapBounds, overlay?: RoadOverlay | null) {
    const saved = this.inCells(this.cells, bounds);
    if (!overlay) return saved;
    return [...saved.filter(node => !containsPoint(overlay.bounds, node)
      || !kinds(node.tags).some(kind => kind === 'pedestrian_crossing' || kind === 'traffic_light')), ...overlay.nodes];
  }
  async currentMapFeatures(bounds: MapBounds) {
    return this.mapFeatures(bounds, await this.updates.get(bounds));
  }
  mapFeatures(bounds: MapBounds, overlay?: RoadOverlay | null): MapRoadFeature[] {
    const result = selectMapFeatures(this.nodes(bounds, overlay), bounds);
    // Spatial buckets keep duplicate checks local in a dense city viewport.
    const buckets = new Map<string, MapRoadFeature[]>(), unique: MapRoadFeature[] = [];
    for (const feature of result) {
      const latitude = Math.floor(feature.latitude * 10000), longitude = Math.floor(feature.longitude * 10000);
      let duplicate = false;
      for (let lat = latitude - 2; lat <= latitude + 2 && !duplicate; lat++)
        for (let lon = longitude - 2; lon <= longitude + 2 && !duplicate; lon++)
          duplicate = (buckets.get(`${feature.kind}:${lat}:${lon}`) || [])
            .some(previous => haversine(previous, feature) < 3);
      if (duplicate) continue;
      const key = `${feature.kind}:${latitude}:${longitude}`, bucket = buckets.get(key) || [];
      bucket.push(feature); buckets.set(key, bucket); unique.push(feature);
    }
    const center = { latitude: (bounds.south + bounds.north) / 2, longitude: (bounds.west + bounds.east) / 2 };
    // Bounds are limited by the controller. Do not drop crossings or real
    // signals at the edges of a dense viewport behind an arbitrary count cap.
    return unique.sort((a, b) => haversine(a, center) - haversine(b, center));
  }
  async currentAlong(points: RoadPoint[], startAlong: number) {
    if (points.length < 2) return [];
    return this.along(points, startAlong, await this.updates.get(this.routeBounds(points)));
  }
  private routeBounds(points: RoadPoint[]) {
    const lats = points.map(point => point.latitude), lons = points.map(point => point.longitude);
    return { south: Math.min(...lats) - .0006, north: Math.max(...lats) + .0006,
      west: Math.min(...lons) - .0008, east: Math.max(...lons) + .0008 };
  }
  along(points: RoadPoint[], startAlong: number, overlay?: RoadOverlay | null): RoadFeature[] {
    if (points.length < 2) return [];
    const bounds = this.routeBounds(points);
    return deduplicateWarnings([...selectRoadFeatures(this.nodes(bounds, overlay), points, startAlong),
      ...speedFeatures(this.inCells(this.speedCells, bounds), points, startAlong)]);
  }
}
