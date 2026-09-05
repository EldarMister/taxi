import type { MapPoint, MapAddress } from './mapkit';
import { api } from '../api';

// Preview uses the protected server Yandex adapter; installed apps use MapKit.
export async function searchAddresses(query: string, _center?: MapPoint): Promise<MapAddress[]> {
  return api.request(`/places/search?q=${encodeURIComponent(query)}`);
}
export async function reverseGeocode(point: MapPoint): Promise<MapAddress> {
  return api.request(`/places/reverse?latitude=${point.latitude}&longitude=${point.longitude}`);
}
