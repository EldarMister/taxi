/** Stable display categories shared by both geocoders. Unknown places use a map pin. */
export type PlaceCategory = 'building' | 'supermarket' | 'shop' | 'office' | 'school' | 'kindergarten' | 'hospital' | 'stadium' | 'home' | 'pharmacy' | 'hotel' | 'restaurant' | 'cafe' | 'bank' | 'park' | 'transport';

export function placeCategory(key: unknown, value: unknown): PlaceCategory | undefined {
  if (typeof key !== 'string' || typeof value !== 'string') return undefined;
  const group = key.toLowerCase(), kind = value.toLowerCase();
  if (group === 'shop') return kind === 'supermarket' ? 'supermarket' : kind === 'chemist' ? 'pharmacy' : 'shop';
  if (group === 'office') return 'office';
  if (group === 'amenity' || group === 'building') {
    if (['school', 'college', 'university'].includes(kind)) return 'school';
    if (kind === 'kindergarten') return 'kindergarten';
    if (['hospital', 'clinic', 'doctors', 'dentist'].includes(kind)) return 'hospital';
    if (kind === 'pharmacy') return 'pharmacy';
    if (['restaurant', 'fast_food', 'food_court'].includes(kind)) return 'restaurant';
    if (['cafe', 'bar', 'pub'].includes(kind)) return 'cafe';
    if (['bank', 'atm'].includes(kind)) return 'bank';
    if (['bus_station', 'ferry_terminal'].includes(kind)) return 'transport';
  }
  if (group === 'building') {
    if (['house', 'detached', 'semidetached_house', 'terrace', 'apartments', 'residential', 'dormitory'].includes(kind)) return 'home';
    if (kind === 'office') return 'office';
    if (['hotel', 'motel'].includes(kind)) return 'hotel';
    if (kind === 'supermarket') return 'supermarket';
    if (kind === 'stadium') return 'stadium';
    return 'building';
  }
  if (group === 'tourism' && ['hotel', 'motel', 'hostel', 'guest_house'].includes(kind)) return 'hotel';
  if (group === 'leisure') {
    if (['stadium', 'sports_centre', 'pitch'].includes(kind)) return 'stadium';
    if (['park', 'garden', 'playground'].includes(kind)) return 'park';
  }
  if (group === 'railway' && ['station', 'halt', 'tram_stop', 'subway_entrance'].includes(kind)
    || group === 'aeroway' && ['aerodrome', 'terminal'].includes(kind)
    || group === 'highway' && kind === 'bus_stop'
    || group === 'public_transport' && ['station', 'platform', 'stop_position'].includes(kind)) return 'transport';
  return undefined;
}
