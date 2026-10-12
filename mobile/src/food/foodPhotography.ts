import type { ImageSourcePropType } from 'react-native';

type Photograph = { source: ImageSourcePropType; width: number; height: number; crop?: [number, number, number, number]; fit?: 'contain' };
export type FoodPhotoRegion = { source: ImageSourcePropType; atlasWidth: number; atlasHeight: number; x: number; y: number; width: number; height: number; fit?: 'contain' };

// Individual camera photographs downloaded from the sources recorded in assets/food/photography/SOURCES.md.
// Keep original pixels; any framing below is presentation-only and preserves the image aspect ratio.
const photos: Record<string, Photograph> = {
  'philadelphia': { source: require('../../assets/food/photography/real/philadelphia.jpg'), width: 1400, height: 933 },
  'tempura': { source: require('../../assets/food/photography/real/tempura.jpg'), width: 1400, height: 2099 },
  'salmon': { source: require('../../assets/food/photography/real/salmon.jpg'), width: 1400, height: 933 },
  'salmon-nigiri': { source: require('../../assets/food/photography/real/salmon-nigiri.jpg'), width: 1280, height: 853, fit: 'contain' },
  'shrimp-nigiri': { source: require('../../assets/food/photography/real/shrimp-nigiri.png'), width: 1280, height: 539, fit: 'contain' },
  'sushi-set': { source: require('../../assets/food/photography/real/sushi-set.jpg'), width: 1400, height: 933 },
  'sushi-roll': { source: require('../../assets/food/photography/real/sushi-roll.jpg'), width: 1400, height: 933 },
  'chicken-burger': { source: require('../../assets/food/photography/real/chicken-burger.jpg'), width: 1400, height: 2062 },
  'chicken-bucket': { source: require('../../assets/food/photography/real/chicken-bucket.jpg'), width: 1400, height: 933 },
  'chicken-wings': { source: require('../../assets/food/photography/real/chicken-wings.jpg'), width: 1400, height: 2100 },
  'chicken-strips': { source: require('../../assets/food/photography/real/chicken-strips.jpg'), width: 1400, height: 1867 },
  'chicken-wrap': { source: require('../../assets/food/photography/real/chicken-wrap.jpg'), width: 1400, height: 2126, crop: [0, 550, 1400, 1500] },
  'fries': { source: require('../../assets/food/photography/real/fries.jpg'), width: 1400, height: 933 },
  'coleslaw': { source: require('../../assets/food/photography/real/coleslaw.jpg'), width: 1400, height: 934 },
  'burger': { source: require('../../assets/food/photography/real/burger.jpg'), width: 1400, height: 2100 },
  'burger-combo': { source: require('../../assets/food/photography/real/burger-combo.jpg'), width: 1400, height: 1280 },
  'onion-rings': { source: require('../../assets/food/photography/real/onion-rings.jpg'), width: 1400, height: 933 },
  'double-cheeseburger': { source: require('../../assets/food/photography/real/double-cheeseburger.jpg'), width: 1400, height: 2100 },
  'bbq-burger': { source: require('../../assets/food/photography/real/bbq-burger.jpg'), width: 1400, height: 2100 },
  'mushroom-burger': { source: require('../../assets/food/photography/real/mushroom-burger.jpg'), width: 1400, height: 2100 },
  'caesar-salad': { source: require('../../assets/food/photography/real/caesar-salad.jpg'), width: 1400, height: 933 },
  'chicken-combo': { source: require('../../assets/food/photography/real/chicken-combo.jpg'), width: 1400, height: 933 },
  'lemonade': { source: require('../../assets/food/photography/real/lemonade.jpg'), width: 1400, height: 933 },
  'tea': { source: require('../../assets/food/photography/real/tea.jpg'), width: 1400, height: 1867 },
  'kfc': { source: require('../../assets/food/photography/real/kfc.jpg'), width: 1400, height: 933 },
  'ali-burger': { source: require('../../assets/food/photography/real/ali-burger.jpg'), width: 1400, height: 933 },
  'plov': { source: require('../../assets/food/photography/real/plov.jpg'), width: 1000, height: 563 },
  'samsa': { source: require('../../assets/food/photography/real/samsa.jpg'), width: 1000, height: 752 },
  'manti': { source: require('../../assets/food/photography/real/manti.jpg'), width: 1280, height: 853 },
  'lagman': { source: require('../../assets/food/photography/real/lagman.jpg'), width: 1000, height: 752 },
  'beshbarmak': { source: require('../../assets/food/photography/real/beshbarmak.jpg'), width: 1280, height: 791 },
  'shorpo': { source: require('../../assets/food/photography/real/shorpo.jpg'), width: 1000, height: 752 },
  'kuurdak': { source: require('../../assets/food/photography/real/kuurdak.jpg'), width: 1000, height: 752 },
  'oromo': { source: require('../../assets/food/photography/real/oromo.jpg'), width: 1280, height: 1707, crop: [40, 140, 1200, 1100] },
  'achichuk': { source: require('../../assets/food/photography/real/achichuk.jpg'), width: 1280, height: 1302 },
  'flatbread': { source: require('../../assets/food/photography/real/flatbread.jpg'), width: 1000, height: 800 },
  'baursak': { source: require('../../assets/food/photography/real/baursak.jpg'), width: 1000, height: 800 },
  'edamame': { source: require('../../assets/food/photography/real/edamame.jpg'), width: 1280, height: 960 },
  'chicken-nuggets': { source: require('../../assets/food/photography/real/chicken-nuggets.jpg'), width: 1280, height: 934 },
  'potato-wedges': { source: require('../../assets/food/photography/real/potato-wedges.jpg'), width: 1280, height: 960 },
  'veggie-burger': { source: require('../../assets/food/photography/real/veggie-burger.jpg'), width: 1280, height: 1280 },
  'california': { source: require('../../assets/food/photography/real/california.jpg'), width: 1400, height: 933 },
  'dragon-roll': { source: require('../../assets/food/photography/real/dragon-roll.jpg'), width: 1280, height: 853 },
  'baked-salmon-roll': { source: require('../../assets/food/photography/real/baked-salmon-roll.jpg'), width: 1400, height: 2100 },
  'cola': { source: require('../../assets/food/photography/real/cola.jpg'), width: 1400, height: 2100 },
  'shrimp-tempura': { source: require('../../assets/food/photography/real/shrimp-tempura.jpg'), width: 1400, height: 2100 },
  'miso-soup': { source: require('../../assets/food/photography/real/miso-soup.jpg'), width: 1280, height: 1238 },
  'halva': { source: require('../../assets/food/photography/real/halva.jpg'), width: 1000, height: 563 },
};
const aliases: Record<string, string> = {
  "philadelphia-hero": "philadelphia",
  "philadelphia-cart": "philadelphia",
  "california-cart": "california",
  "sushi-hero": "sushi-roll",
  "restaurant-sushi": "sushi-roll",
  "restaurant-order": "sushi-roll",
  "restaurant-kfc": "kfc",
  "restaurant-halva": "halva",
  "restaurant-burger": "ali-burger",
  "fried-chicken": "chicken-bucket",
  "samosa": "samsa",
  "ali-cheeseburger": "burger",
  "ali-combo": "burger-combo"
};

export function foodPhotoRegion(key?: string | null, fallbackKey?: string | null): FoodPhotoRegion | undefined {
  const photo = photos[aliases[key ?? ''] ?? key ?? ''] ?? photos[aliases[fallbackKey ?? ''] ?? fallbackKey ?? ''];
  if (!photo) return undefined;
  const [x, y, width, height] = photo.crop ?? [0, 0, photo.width, photo.height];
  return { source: photo.source, atlasWidth: photo.width, atlasHeight: photo.height, x, y, width, height, fit: photo.fit };
}
