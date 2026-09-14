const COUNTRY_PART = /^(?:кыргызстан|кыргызская\s+республика|кыргыз\s+республикасы|кыргызстан\s+республикасы|киргизия|киргизская\s+республика|республика\s+кыргызстан|kyrgyzstan|kyrgyz\s+republic)$/iu;
const REGION_PART = /^(?:(?:область|обл\.?)\s+.+|.+\s+(?:область|обл\.?|облусу|region))$/iu;
const DISTRICT_PART = /^(?:(?:район|р-?н\.?)\s+.+|.+\s+(?:район|р-?н\.?|району|district))$/iu;
const BISHKEK_PART = /^(?:(?:город(?:\s+республиканского\s+значения)?|г\.?)\s+)?бишкек$/iu;

const normalizePart = (part: string) => part.trim().replace(/\s+/g, ' ');
const isAdministrativePart = (part: string) => COUNTRY_PART.test(part) || REGION_PART.test(part) || DISTRICT_PART.test(part);

/**
 * Produces a compact address for UI only. The original address stored in a
 * Point/Order is deliberately never changed or sent back to the API.
 */
export function shortAddress(address?: string): string {
  const original = address?.trim();
  if (!original) return '';

  // A search result can start with a named place and its category. Keep that
  // useful label instead of replacing it with administrative details.
  if (original.includes(' · ')) return normalizePart(original.split(',')[0]);

  const parts = original.split(',').map(normalizePart).filter(Boolean);
  const useful = parts.filter(part => !isAdministrativePart(part));

  // Preserve the previous Bishkek-specific compaction, but only when the city
  // is a leading administrative prefix. Other cities/localities remain useful.
  while (useful.length > 1 && BISHKEK_PART.test(useful[0])) useful.shift();

  // An address containing only administrative units is still better than an
  // empty or misleading placeholder.
  return useful.length ? useful.join(', ') : original;
}
