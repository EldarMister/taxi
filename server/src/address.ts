const country = /^(?:кыргызстан|кыргызская\s+республика|кыргыз\s+республикасы|кыргызстан\s+республикасы|киргизия|киргизская\s+республика|республика\s+кыргызстан|kyrgyzstan|kyrgyz\s+republic)$/iu;
const region = /^(?:(?:область|обл\.?)\s+.+|.+\s+(?:область|обл\.?|облусу|region|state))$/iu;
const district = /^(?:(?:район|р-?н\.?)\s+.+|.+\s+(?:район|р-?н\.?|району|district))$/iu;
const postcode = /^(?:(?:почтовый\s+индекс|индекс|postcode|postal\s+code)\s*[:№-]?\s*)?\d{5,6}$/iu;
const street = /(?:^|\s)(?:улица|ул\.?|проспект|пр-т|переулок|пер\.?|бульвар|бул\.?|шоссе|дорога|набережная|площадь|микрорайон|мкр\.?|көчөсү|көчө)(?:\s|$)/iu;
const city = /^(?:(?:город(?:\s+республиканского\s+значения)?|г\.?|село|пос[её]лок|пгт|айыл)\s+.+|бишкек|ош)$/iu;
const house = /^(?:\d{1,4}[а-яa-z]?(?:\s*[/\-]\s*\d{1,4}[а-яa-z]?)?|(?:дом|д\.|корпус|строение|кв\.?|квартира)\s*\S+)$/iu;
const clean = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
export const cleanCity = (value: unknown) => clean(value).replace(/^(?:город(?:\s+республиканского\s+значения)?|г\.|село|пос[её]лок|пгт|айыл)\s+/iu, '');

export function formatAddress(parts: Array<unknown>): string {
  const seen = new Set<string>();
  return parts.map(clean).filter(part => {
    const key = part.toLocaleLowerCase('ru');
    if (!part || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ').slice(0, 250);
}

/** Keep the provider's POI name alongside its routable address, without adding API fields. */
export function formatPlaceAddress(name: unknown, road: unknown, number: unknown, unit: unknown, locality: unknown, named = true): string {
  const title = clean(name), streetName = clean(road), cityName = cleanCity(locality);
  const address = formatAddress([streetName || title, number, unit, cityName]);
  const key = (value: string) => value.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]/gu, '');
  const distinct = title && streetName && ![streetName, cityName, clean(number)].some(value => key(value) === key(title));
  return named && distinct && !house.test(title) ? `${title} · ${address}`.slice(0, 250) : address;
}

/** Handles Nominatim results without structured address fields. */
export function compactAddress(value: string): string {
  const parts = value.split(',').map(clean).filter(part => part && !country.test(part) && !region.test(part) && !district.test(part) && !postcode.test(part));
  if (!parts.length) return '';
  const streetIndex = parts.findIndex(part => street.test(part));
  const explicitCity = parts.findIndex(part => city.test(part) && !street.test(part));
  const inferredCity = streetIndex >= 0
    ? parts.findIndex((part, index) => index !== streetIndex && !house.test(part) && !street.test(part) && !part.includes(' · '))
    : parts.length > 1 ? parts.length - 1 : -1;
  const cityIndex = explicitCity >= 0 ? explicitCity : inferredCity;
  const useful = parts.filter((_, index) => index !== cityIndex);
  if (useful.length > 1 && house.test(useful[0]) && street.test(useful[1])) useful.splice(0, 2, useful[1], useful[0]);
  return formatAddress([...useful, cityIndex >= 0 ? cleanCity(parts[cityIndex]) : '']);
}
