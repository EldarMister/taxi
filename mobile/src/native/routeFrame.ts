import type { MapPoint } from './mapkit';

export function isMapPoint(point: MapPoint): boolean {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

// Include the complete road geometry, including bends outside the endpoints.
// Native padding keeps the road below the header and above map controls.
export function routeFrame(points: MapPoint[], width: number, height: number, topInset: number, bottomInset = 0) {
  const valid = points.filter(isMapPoint);
  if (!valid.length) return null;
  const latitude = valid.map(point => point.latitude), longitude = valid.map(point => point.longitude);
  const south = Math.min(...latitude), north = Math.max(...latitude);
  const west = Math.min(...longitude), east = Math.max(...longitude);
  const latMargin = north === south ? 0.0003 : 0;
  const lonMargin = east === west ? 0.0003 : 0;
  const top = Math.min(Math.max(0, topInset) + 68, Math.max(0, height) * .44);
  const bottom = Math.min(Math.max(0, bottomInset) + 48, Math.max(0, height - top - 100));
  return {
    ne: [Math.min(180, east + lonMargin), Math.max(-85, Math.min(85, north + latMargin))],
    sw: [Math.max(-180, west - lonMargin), Math.max(-85, Math.min(85, south - latMargin))],
    padding: [top, Math.min(96, Math.max(0, width) * .24), bottom, Math.min(96, Math.max(0, width) * .24)],
  };
}

// GPS accuracy is a radius in metres, not pixels. A geodesic circle stays tied
// to the actual fix while the camera zooms or turns.
export function accuracyCircle(point: MapPoint & { accuracy?: number }): GeoJSON.Polygon | null {
  if (!isMapPoint(point) || !Number.isFinite(point.accuracy) || !point.accuracy || point.accuracy <= 0) return null;
  const radius = point.accuracy / 6371000;
  const latitude = point.latitude * Math.PI / 180, longitude = point.longitude * Math.PI / 180;
  const ring: number[][] = [];
  for (let index = 0; index <= 48; index++) {
    const bearing = index * 2 * Math.PI / 48;
    const lat = Math.asin(Math.sin(latitude) * Math.cos(radius) + Math.cos(latitude) * Math.sin(radius) * Math.cos(bearing));
    const lon = longitude + Math.atan2(Math.sin(bearing) * Math.sin(radius) * Math.cos(latitude), Math.cos(radius) - Math.sin(latitude) * Math.sin(lat));
    ring.push([((lon * 180 / Math.PI + 540) % 360) - 180, lat * 180 / Math.PI]);
  }
  ring[ring.length - 1] = [...ring[0]];
  return { type: 'Polygon', coordinates: [ring] };
}

