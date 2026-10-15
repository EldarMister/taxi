import type { MapBounds, OsmNode, RoadPoint } from './road-features';

type Element = { type: string; id: number; lat?: number; lon?: number; tags?: Record<string, string>;
  nodes?: number[]; geometry?: { lat: number; lon: number }[] };
export type RoadOverlay = { bounds: MapBounds; nodes: OsmNode[]; sourceUpdatedAt: string; fetchedAt: number };
const roadClasses = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
  'unclassified', 'living_street', 'service', 'road', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
export const containsBounds = (outer: MapBounds, inner: MapBounds) => inner.south >= outer.south
  && inner.north <= outer.north && inner.west >= outer.west && inner.east <= outer.east;
export const containsPoint = (bounds: MapBounds, point: RoadPoint) => point.latitude >= bounds.south
  && point.latitude <= bounds.north && point.longitude >= bounds.west && point.longitude <= bounds.east;

function roadProjection(point: RoadPoint, geometry: { lat: number; lon: number }[]) {
  let best: NonNullable<OsmNode['roads']>[number] | undefined;
  const scale = 111320 * Math.cos(point.latitude * Math.PI / 180);
  for (let i = 1; i < geometry.length; i++) {
    const a = geometry[i - 1], b = geometry[i];
    const dx = (b.lon - a.lon) * scale, dy = (b.lat - a.lat) * 111320, length2 = dx * dx + dy * dy;
    if (!Number.isFinite(length2) || length2 < .25) continue;
    const ax = (point.longitude - a.lon) * scale, ay = (point.latitude - a.lat) * 111320;
    const fraction = Math.max(0, Math.min(1, (ax * dx + ay * dy) / length2));
    const distance = Math.hypot(ax - dx * fraction, ay - dy * fraction);
    if (distance <= 15 && (!best || distance < best.distance)) best = { latitude: a.lat + (b.lat - a.lat) * fraction,
      longitude: a.lon + (b.lon - a.lon) * fraction, distance, bearing: (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360 };
  }
  return best;
}

/** Read only a complete Overpass response; a timeout/remark must never erase a saved map. */
export function parseRoadOverlay(data: unknown, bounds: MapBounds, now: number): RoadOverlay {
  const value = data as { elements?: Element[]; remark?: string; osm3s?: { timestamp_osm_base?: string } };
  if (!value || value.remark || !Array.isArray(value.elements) || value.elements.length > 30000
    || !Number.isFinite(Date.parse(value.osm3s?.timestamp_osm_base ?? ''))) throw Error('Incomplete OSM feature response');
  const roads = value.elements.filter(e => e.type === 'way' && roadClasses.has(e.tags?.highway ?? '') && e.geometry?.length);
  const nodes: OsmNode[] = [];
  for (const item of value.elements) {
    const tags = item.tags ?? {}, highways = (tags.highway ?? '').split(';');
    if (item.type === 'way' && tags.footway !== 'crossing' && !['footway', 'path', 'pedestrian'].includes(tags.highway)) continue;
    const crossing = highways.includes('crossing') || tags.footway === 'crossing'
      || tags.railway !== 'level_crossing' && !!tags.crossing && tags.crossing !== 'no';
    if (!crossing && !highways.includes('traffic_signals')) continue;
    let node: OsmNode | undefined;
    if (item.type === 'node' && Number.isFinite(item.lat) && Number.isFinite(item.lon))
      node = { id: item.id, latitude: item.lat!, longitude: item.lon!, tags, roads: [] };
    else if (item.type === 'way' && crossing && item.geometry && item.geometry.length >= 2) {
      const lengths = item.geometry.slice(1).map((b, i) => Math.hypot((b.lon - item.geometry![i].lon)
        * Math.cos(b.lat * Math.PI / 180), b.lat - item.geometry![i].lat));
      let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
      for (let i = 0; i < lengths.length; i++) {
        const length = lengths[i];
        if (remaining > length && i < lengths.length - 1) { remaining -= length; continue; }
        const a = item.geometry[i], b = item.geometry[i + 1], fraction = length ? remaining / length : 0;
        const latitude = a.lat + (b.lat - a.lat) * fraction;
        node = { id: `way/${item.id}`, latitude, longitude: a.lon + (b.lon - a.lon) * fraction,
          tags: { ...tags, highway: 'crossing' }, bearing: (Math.atan2((b.lon - a.lon)
            * Math.cos(latitude * Math.PI / 180), b.lat - a.lat) * 180 / Math.PI + 450) % 360, roads: [] };
        break;
      }
    }
    if (!node || !containsPoint(bounds, node)) continue;
    for (const road of roads) {
      // Prefer the actual road membership over a nearby parallel road.
      if (item.type === 'node' && !road.nodes?.includes(item.id)) continue;
      const projection = roadProjection(node, road.geometry!);
      if (!projection) continue;
      const width = Number.parseFloat(road.tags?.width ?? '');
      node.roads!.push({ ...projection, roadClass: road.tags!.highway,
        widthMeters: Number.isFinite(width) ? Math.max(5, Math.min(18, width))
          : ['trunk', 'primary', 'secondary'].includes(road.tags!.highway) ? 10 : 7 });
    }
    node.roads!.sort((a, b) => a.distance - b.distance);
    node.roads = node.roads!.slice(0, 4); nodes.push(node);
  }
  return { bounds, nodes, sourceUpdatedAt: value.osm3s!.timestamp_osm_base!, fetchedAt: now };
}

/** Bounded, shared hourly cache. No scheduled requests or external dependency on the GPS path. */
export class RoadFeatureUpdates {
  private cache: RoadOverlay[] = [];
  private pending?: { bounds: MapBounds; result: Promise<RoadOverlay | null> };
  private retryAt = 0;
  constructor(private readonly fetcher: typeof fetch = fetch, private readonly clock = Date.now) {}
  async get(bounds: MapBounds): Promise<RoadOverlay | null> {
    if (process.env.ROAD_FEATURES_LIVE === 'false' || bounds.south < 39 || bounds.north > 44
      || bounds.west < 69 || bounds.east > 81) return null;
    const now = this.clock(), saved = this.cache.find(item => containsBounds(item.bounds, bounds));
    if (saved && now - saved.fetchedAt < 3600000) return saved;
    if (this.pending) return containsBounds(this.pending.bounds, bounds) ? this.pending.result : saved ?? null;
    if (now < this.retryAt) return saved ?? null;
    const padded = { south: Math.floor((bounds.south - .002) * 100) / 100, north: Math.ceil((bounds.north + .002) * 100) / 100,
      west: Math.floor((bounds.west - .002) * 100) / 100, east: Math.ceil((bounds.east + .002) * 100) / 100 };
    const result = this.load(padded).then(overlay => {
      this.cache = [overlay, ...this.cache.filter(item => !containsBounds(overlay.bounds, item.bounds))].slice(0, 32);
      return overlay;
    }).catch(() => { this.retryAt = this.clock() + 60000; return saved ?? null; })
      .finally(() => { this.pending = undefined; });
    this.pending = { bounds: padded, result }; return result;
  }
  private async load(bounds: MapBounds) {
    const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
    const query = `[out:json][timeout:8];(node["highway"~"(^|;)(crossing|traffic_signals)(;|$)"](${box});`
      + `node["crossing"]["railway"!="level_crossing"](${box});node["footway"="crossing"](${box});`
      + `way["footway"="crossing"](${box});way["highway"~"^(footway|path|pedestrian)$"]["crossing"](${box});)->.features;`
      + `(.features;way(bn.features)["highway"];);out body geom;`;
    const response = await this.fetcher(process.env.ROAD_FEATURES_OVERPASS_URL || 'https://overpass-api.de/api/interpreter', {
      method: 'POST', headers: { 'User-Agent': 'Atlas-road-features/1.0', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) throw Error('OSM feature update unavailable');
    if (Number(response.headers.get('content-length')) > 12_000_000) throw Error('OSM feature response too large');
    const body = await response.text();
    if (body.length > 12_000_000) throw Error('OSM feature response too large');
    return parseRoadOverlay(JSON.parse(body), bounds, this.clock());
  }
}
