export type MapRoadFeature = {
  id: string;
  kind: 'traffic_light' | 'pedestrian_crossing';
  latitude: number;
  longitude: number;
  bearing?: number;
  widthMeters?: number;
  roadClass?: string;
};

export function validMapRoadFeature(feature: MapRoadFeature): boolean {
  return !!feature && typeof feature.id === 'string'
    && Number.isFinite(feature.latitude) && Math.abs(feature.latitude) <= 85
    && Number.isFinite(feature.longitude) && Math.abs(feature.longitude) <= 180
    && ['traffic_light', 'pedestrian_crossing'].includes(feature.kind);
}

/** Avoid regenerating every crossing polygon when MapLibre returns the same roads again. */
export function sameRenderedRoadGeometry(before: GeoJSON.FeatureCollection, after: GeoJSON.FeatureCollection): boolean {
  if (before === after) return true;
  if (before.features.length !== after.features.length) return false;
  for (let index = 0; index < before.features.length; index++) {
    const left = before.features[index], right = after.features[index];
    if (left.properties?.kind !== right.properties?.kind || left.geometry?.type !== right.geometry?.type) return false;
    const leftLines = left.geometry?.type === 'LineString' ? [left.geometry.coordinates]
      : left.geometry?.type === 'MultiLineString' ? left.geometry.coordinates : [];
    const rightLines = right.geometry?.type === 'LineString' ? [right.geometry.coordinates]
      : right.geometry?.type === 'MultiLineString' ? right.geometry.coordinates : [];
    if (leftLines.length !== rightLines.length) return false;
    for (let line = 0; line < leftLines.length; line++) {
      if (leftLines[line].length !== rightLines[line].length) return false;
      for (let point = 0; point < leftLines[line].length; point++) {
        const a = leftLines[line][point], b = rightLines[line][point];
        if (a.length !== b.length || a.some((coordinate, axis) => coordinate !== b[axis])) return false;
      }
    }
  }
  return true;
}

/** Fit markings to the road geometry actually drawn by the current tiles. */
export function alignCrossingsToRoads(features: MapRoadFeature[], roads: GeoJSON.FeatureCollection): MapRoadFeature[] {
  type Segment = { before: GeoJSON.Position; after: GeoJSON.Position; roadClass?: string };
  const grid = new Map<string, Segment[]>();
  for (const road of roads.features) {
    const lines = road.geometry?.type === 'LineString' ? [road.geometry.coordinates]
      : road.geometry?.type === 'MultiLineString' ? road.geometry.coordinates : [];
    for (const line of lines) for (let index = 1; index < line.length; index++) {
      const before = line[index - 1], after = line[index];
      if (![before[0], before[1], after[0], after[1]].every(Number.isFinite)) continue;
      const segment = { before, after, roadClass: road.properties?.kind as string | undefined };
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(after[0] - before[0]), Math.abs(after[1] - before[1])) * 2000));
      if (steps > 2000) continue;
      const cells = new Set<string>();
      for (let step = 0; step <= steps; step++) {
        const key = `${Math.floor((before[1] + (after[1] - before[1]) * step / steps) * 2000)}:${Math.floor((before[0] + (after[0] - before[0]) * step / steps) * 2000)}`;
        if (cells.has(key)) continue;
        cells.add(key);
        const bucket = grid.get(key) ?? [];
        bucket.push(segment); grid.set(key, bucket);
      }
    }
  }
  return features.map(feature => {
    if (feature.kind !== 'pedestrian_crossing' || !validMapRoadFeature(feature)) return feature;
    const latitude = Math.floor(feature.latitude * 2000), longitude = Math.floor(feature.longitude * 2000);
    const xScale = 111320 * Math.cos(feature.latitude * Math.PI / 180);
    let best: { score: number; latitude: number; longitude: number; bearing: number; roadClass?: string } | undefined;
    for (let lat = latitude - 1; lat <= latitude + 1; lat++) for (let lon = longitude - 1; lon <= longitude + 1; lon++) {
      for (const segment of grid.get(`${lat}:${lon}`) ?? []) {
        const [before, after] = [segment.before, segment.after];
        const dx = (after[0] - before[0]) * xScale, dy = (after[1] - before[1]) * 111320;
        const length2 = dx * dx + dy * dy;
        if (length2 < .25) continue;
        const ax = (feature.longitude - before[0]) * xScale, ay = (feature.latitude - before[1]) * 111320;
        const fraction = Math.max(0, Math.min(1, (ax * dx + ay * dy) / length2));
        const distance = Math.hypot(ax - dx * fraction, ay - dy * fraction);
        const knownBearing = Number.isFinite(feature.bearing);
        if (distance > (knownBearing ? 10 : 4)) continue;
        const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
        const difference = knownBearing ? Math.abs(((bearing - feature.bearing! + 540) % 360) - 180) : 0;
        const angle = Math.min(difference, 180 - difference);
        // Do not jump onto the perpendicular street at a junction.
        if (angle > 40) continue;
        const score = distance + angle * .04;
        if (!best || score < best.score) best = { score, bearing, roadClass: segment.roadClass,
          latitude: before[1] + (after[1] - before[1]) * fraction,
          longitude: before[0] + (after[0] - before[0]) * fraction };
      }
    }
    return best ? { ...feature, latitude: best.latitude, longitude: best.longitude, bearing: best.bearing,
      roadClass: best.roadClass ?? feature.roadClass } : feature;
  });
}

// A crossing extends a little beyond the cartographic road, as road markings
// do in navigation maps. Keep its stripe spacing readable at close zoom.
export function crossingMarkings(features: MapRoadFeature[], zoom: number): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const polygons: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
  const detail = Math.max(0, Math.min(1, (zoom - 16) / 3));
  for (const feature of features) {
    if (!validMapRoadFeature(feature) || feature.kind !== 'pedestrian_crossing' || !Number.isFinite(feature.bearing)) continue;
    const major = /^(motorway|trunk|primary|secondary|tertiary)/.test(feature.roadClass ?? '') || (feature.widthMeters ?? 7) >= 9;
    const roadPixels = major ? 8 + detail * 7 : 5.4 + detail * 4.1;
    const scale = .35 + Math.max(0, Math.min(1, (zoom - 14.5) / 4.5)) * .65;
    const width = Math.max(major ? 24 : 20, roadPixels * 2.6) * scale;
    const depth = Math.max(3.5, Math.min(10, width * .28));
    const stripeCount = Math.max(4, Math.round(width / 4));
    const period = width / stripeCount;
    const metresPerPixel = 40075016.686 * Math.cos(feature.latitude * Math.PI / 180) / (512 * 2 ** zoom);
    const angle = (feature.bearing ?? 0) * Math.PI / 180;
    const point = (across: number, along: number): GeoJSON.Position => {
      const east = (across * Math.cos(angle) + along * Math.sin(angle)) * metresPerPixel;
      const north = (-across * Math.sin(angle) + along * Math.cos(angle)) * metresPerPixel;
      return [feature.longitude + east / (111320 * Math.cos(feature.latitude * Math.PI / 180)), feature.latitude + north / 111320];
    };
    const rectangle = (left: number, right: number, role: 'surface' | 'stripe', index: number) => {
      polygons.push({ type: 'Feature', id: `${feature.id}:${role}:${index}`, properties: { role, crossingId: feature.id },
        geometry: { type: 'Polygon', coordinates: [[point(left, -depth / 2), point(right, -depth / 2),
          point(right, depth / 2), point(left, depth / 2), point(left, -depth / 2)]] } });
    };
    rectangle(-width / 2, width / 2, 'surface', 0);
    for (let index = 0; index < stripeCount; index++) {
      const left = -width / 2 + period * (index + .2);
      rectangle(left, left + period * .55, 'stripe', index);
    }
  }
  return { type: 'FeatureCollection', features: polygons };
}
