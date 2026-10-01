const COUNTRY_PART = /^(?:кыргызстан|кыргызская\s+республика|кыргыз\s+республикасы|кыргызстан\s+республикасы|киргизия|киргизская\s+республика|республика\s+кыргызстан|kyrgyzstan|kyrgyz\s+republic)$/iu;
const REGION_PART = /^(?:(?:область|обл\.?)\s+.+|.+\s+(?:область|обл\.?|облусу|region))$/iu;
const DISTRICT_PART = /^(?:(?:район|р-?н\.?)\s+.+|.+\s+(?:район|р-?н\.?|району|district))$/iu;
const POSTCODE_PART = /^(?:(?:почтовый\s+индекс|индекс|postcode|postal\s+code)\s*[:№-]?\s*)?\d{5,6}$/iu;
const STREET_PART = /(?:^|\s)(?:улица|ул\.?|проспект|пр-т|переулок|пер\.?|бульвар|бул\.?|шоссе|дорога|набережная|площадь|микрорайон|мкр\.?|көчөсү|көчө)(?:\s|$)/iu;
const CITY_PART = /^(?:(?:город(?:\s+республиканского\s+значения)?|г\.?|село|пос[её]лок|пгт|айыл)\s+.+|бишкек|ош)$/iu;
const HOUSE_PART = /^(?:\d{1,4}[а-яa-z]?(?:\s*[/\-]\s*\d{1,4}[а-яa-z]?)?|(?:дом|д\.|корпус|строение|кв\.?|квартира)\s*\S+)$/iu;

const normalizePart = (part: string) => part.trim().replace(/\s+/g, ' ');
const normalizeCity = (part: string) => part.replace(/^(?:город(?:\s+республиканского\s+значения)?|г\.|село|пос[её]лок|пгт|айыл)\s+/iu, '');
const isAdministrativePart = (part: string) => COUNTRY_PART.test(part) || REGION_PART.test(part) || DISTRICT_PART.test(part) || POSTCODE_PART.test(part);

/**
 * Produces a compact address for UI only. The original address stored in a
 * Point/Order is deliberately never changed or sent back to the API.
 */
export function shortAddress(address?: string): string {
  const original = address?.trim();
  if (!original) return '';

  if (/^GPS:\s*-?\d/i.test(original)) return original;
  const parts = original.split(',').map(normalizePart).filter(part => part && !isAdministrativePart(part));
  if (!parts.length) return '';
  const streetIndex = parts.findIndex(part => STREET_PART.test(part));
  const explicitCity = parts.findIndex(part => CITY_PART.test(part) && !STREET_PART.test(part));
  const inferredCity = streetIndex >= 0
    ? parts.findIndex((part, index) => index !== streetIndex && !HOUSE_PART.test(part) && !STREET_PART.test(part) && !part.includes(' · '))
    : parts.length > 1 ? parts.length - 1 : -1;
  const cityIndex = explicitCity >= 0 ? explicitCity : inferredCity;
  const city = cityIndex >= 0 ? normalizeCity(parts[cityIndex]) : '';
  const useful = parts.filter((_, index) => index !== cityIndex);
  if (useful.length > 1 && HOUSE_PART.test(useful[0]) && STREET_PART.test(useful[1])) useful.splice(0, 2, useful[1], useful[0]);
  return [...useful, city].filter(Boolean).join(', ');
}
