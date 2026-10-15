import { distanceBetween } from './navigation';
import type { Coordinate, Language, Point } from './types';

const placeCategories = [
  'building', 'supermarket', 'shop', 'office', 'school', 'kindergarten', 'hospital', 'stadium',
  'home', 'pharmacy', 'hotel', 'restaurant', 'cafe', 'bank', 'park', 'transport',
] as const;
export type AddressPlaceCategory = typeof placeCategories[number];
export type AddressPlaceIconName = AddressPlaceCategory | 'location';
type Category = AddressPlaceCategory;

const categoryLabels: Record<Category, Record<Language, string>> = {
  building: { ru: 'Здание', ky: 'Имарат', en: 'Building' },
  supermarket: { ru: 'Супермаркет', ky: 'Супермаркет', en: 'Supermarket' },
  shop: { ru: 'Магазин', ky: 'Дүкөн', en: 'Shop' },
  office: { ru: 'Офис', ky: 'Кеңсе', en: 'Office' },
  school: { ru: 'Школа', ky: 'Мектеп', en: 'School' },
  kindergarten: { ru: 'Детский сад', ky: 'Бала бакча', en: 'Kindergarten' },
  hospital: { ru: 'Больница', ky: 'Оорукана', en: 'Hospital' },
  stadium: { ru: 'Стадион', ky: 'Стадион', en: 'Stadium' },
  home: { ru: 'Дом', ky: 'Үй', en: 'Home' },
  pharmacy: { ru: 'Аптека', ky: 'Дарыкана', en: 'Pharmacy' },
  hotel: { ru: 'Гостиница', ky: 'Мейманкана', en: 'Hotel' },
  restaurant: { ru: 'Ресторан', ky: 'Ресторан', en: 'Restaurant' },
  cafe: { ru: 'Кафе', ky: 'Кафе', en: 'Cafe' },
  bank: { ru: 'Банк', ky: 'Банк', en: 'Bank' },
  park: { ru: 'Парк', ky: 'Парк', en: 'Park' },
  transport: { ru: 'Транспорт', ky: 'Транспорт', en: 'Transport' },
};

/** Older saved places may predate category metadata. Never infer a POI from a street name. */
export function addressCategory(point: Pick<Point, 'address'> & { category?: string }): Category | undefined {
  if (point.category && placeCategories.includes(point.category as Category)) return point.category as Category;
  const name = point.address.split(' · ')[0];
  if (/(?:^|\s)(?:улица|ул\.?|проспект|пр-т|переулок|пер\.?|көчөсү|көчө|street|avenue|road)(?:\s|$)/iu.test(name)) return undefined;
  const patterns: [Category, RegExp][] = [
    ['kindergarten', /детск(?:ий|ого)\s+сад|бала\s+бакча|kindergarten|nursery/iu],
    ['supermarket', /супермаркет|supermarket|^(?:глобус|фрунзе|globus)$/iu],
    ['pharmacy', /аптек|дарыкана|pharmacy/iu],
    ['hospital', /больниц|клиник|поликлиник|медицинск|оорукана|hospital|clinic/iu],
    ['school', /(?:^|\s)(?:школа|лицей|гимназия|мектеп|school)(?:\s|$|№)/iu],
    ['stadium', /стадион|спорткомплекс|stadium|arena/iu],
    ['office', /офис|бизнес[ -]центр|business\s+cent(?:er|re)|office/iu],
    ['hotel', /гостиниц|отель|мейманкана|hotel|hostel/iu],
    ['restaurant', /ресторан|restaurant/iu],
    ['cafe', /кафе|кофейн|cafe|café|coffee/iu],
    ['shop', /магазин|дүкөн|торговый\s+центр|молл|mall|shop|store/iu],
    ['bank', /(?:^|\s)(?:банк|bank)(?:\s|$)/iu],
    ['park', /(?:^|\s)(?:парк|park)(?:\s|$)/iu],
    ['transport', /вокзал|аэропорт|автостанц|airport|station/iu],
    ['home', /жилой\s+дом|residential/iu],
    ['building', /(?:^|\s)(?:здание|building)(?:\s|$)/iu],
  ];
  return patterns.find(([, pattern]) => pattern.test(name))?.[0];
}

export function addressResultIcon(point: Pick<Point, 'address'> & { category?: string }): AddressPlaceIconName {
  return addressCategory(point) || 'location';
}

export function addressCategoryLabel(point: Pick<Point, 'address'> & { category?: string }, language: Language) {
  const category = addressCategory(point);
  return category ? categoryLabels[category][language] : '';
}

export function addressDistanceOrigin(field: 'pickup' | 'dropoff', userLocation?: Coordinate | null, pickup?: Coordinate | null, savedPlace = false) {
  return field === 'pickup' || savedPlace ? userLocation : pickup;
}

const validCoordinate = (point?: Coordinate | null): point is Coordinate => !!point
  && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
  && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;

/** Search distances are straight-line distances; route time and fare come from routing. */
export function addressResultDistance(origin: Coordinate | null | undefined, point: Coordinate, language: Language): string | undefined {
  if (!validCoordinate(origin) || !validCoordinate(point)) return undefined;
  const metres = Math.round(distanceBetween(origin, point));
  if (metres < 1000) return `${metres} ${language === 'en' ? 'm' : 'м'}`;
  const kilometres = (metres / 1000).toFixed(1).replace('.', language === 'en' ? '.' : ',');
  return `${kilometres} ${language === 'en' ? 'km' : 'км'}`;
}

export type AddressMatch = { text: string; matched: boolean };

/** Keep the original spelling and highlight only tokens actually present in the result. */
export function addressMatches(text: string, query: string): AddressMatch[] {
  const normalize = (value: string) => value.toLocaleLowerCase().replace(/ё/g, 'е');
  const tokens = [...new Set(normalize(query).match(/[\p{L}\p{N}]+/gu) || [])];
  if (!tokens.length) return [{ text, matched: false }];
  const normalized = normalize(text);
  const matched = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let index = normalized.indexOf(token);
    while (index >= 0) {
      matched.fill(true, index, index + token.length);
      index = normalized.indexOf(token, index + token.length);
    }
  }
  const parts: AddressMatch[] = [];
  for (let index = 0; index < text.length; index++) {
    const previous = parts[parts.length - 1];
    if (previous?.matched === matched[index]) previous.text += text[index];
    else parts.push({ text: text[index], matched: matched[index] });
  }
  return parts;
}
