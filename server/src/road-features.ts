import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { haversine } from './domain';

export type RoadFeatureKind = 'stop' | 'give_way' | 'speed_limit_60' | 'pedestrian_crossing' | 'speed_camera' | 'traffic_light';
export type RoadFeature = { id: string; kind: RoadFeatureKind; latitude: number; longitude: number; along: number };
export type RoadPoint = { latitude: number; longitude: number };
type OsmNode = { id: number; latitude: number; longitude: number; tags: Record<string, string> };

function kinds(tags: Record<string, string>): RoadFeatureKind[] {
  const sign = (tags.traffic_sign || '').toLowerCase();
  const tokens = sign.split(/[;,]/).map(value => value.trim());
  const has = (value: string) => tokens.includes(value);
  const result: RoadFeatureKind[] = [];
  if (tags.highway === 'traffic_signals' || tags.crossing === 'traffic_signals' || tags['crossing:signals'] === 'yes') result.push('traffic_light');
  if (tags.highway === 'stop' || has('stop')) result.push('stop');
  if (tags.highway === 'give_way' || has('give_way') || has('yield')) result.push('give_way');
  if ((tags.highway === 'crossing' && !result.includes('traffic_light')) || has('pedestrian_crossing')) result.push('pedestrian_crossing');
  if (tags.highway === 'speed_camera' || has('speed_camera')) result.push('speed_camera');
  if ((has('maxspeed') && tags.maxspeed === '60') || tokens.some(value => /^(?:[a-z]{2}:)?3\.24\[60\]$/i.test(value))) result.push('speed_limit_60');
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
      if (projected.distance > (roadside ? 28 : 14)) continue;
      const direction = numericDirection(node.tags['traffic_sign:direction'] || node.tags['traffic_signals:direction']);
      if (direction != null && kind !== 'speed_camera' && angleDifference(direction, projected.heading) > 70) continue;
      result.push({ id: `${node.id}:${kind}`, kind, latitude: node.latitude, longitude: node.longitude,
        along: Math.round(startAlong + projected.along) });
    }
  }
  result.sort((a, b) => a.along - b.along || a.id.localeCompare(b.id));
  // One junction may contain several mapped signal heads or crossing nodes.
  return result.filter((item, index) => !result.slice(0, index).some(previous => previous.kind === item.kind
    && Math.abs(previous.along - item.along) <= 25)).slice(0, 80);
}

@Injectable()
export class RoadFeaturesService {
  private readonly cells = new Map<string, OsmNode[]>();
  readonly generatedAt: string;
  constructor() {
    const snapshot = JSON.parse(readFileSync(resolve(process.cwd(), 'data/road-features-kg.json'), 'utf8')) as {
      generatedAt: string; elements: OsmNode[] };
    this.generatedAt = snapshot.generatedAt;
    for (const node of snapshot.elements) {
      const key = this.cellKey(node.latitude, node.longitude);
      const cell = this.cells.get(key) || [];
      cell.push(node); this.cells.set(key, cell);
    }
  }
  private cellKey(latitude: number, longitude: number) { return `${Math.floor(latitude * 100)}:${Math.floor(longitude * 100)}`; }
  along(points: RoadPoint[], startAlong: number): RoadFeature[] {
    const lats = points.map(point => point.latitude), lons = points.map(point => point.longitude);
    const south = Math.floor((Math.min(...lats) - .0004) * 100), north = Math.floor((Math.max(...lats) + .0004) * 100);
    const west = Math.floor((Math.min(...lons) - .0005) * 100), east = Math.floor((Math.max(...lons) + .0005) * 100);
    const nodes: OsmNode[] = [];
    for (let lat = south; lat <= north; lat++) for (let lon = west; lon <= east; lon++)
      nodes.push(...(this.cells.get(`${lat}:${lon}`) || []));
    return selectRoadFeatures(nodes, points, startAlong);
  }
}
