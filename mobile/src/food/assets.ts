import type { ImageSourcePropType } from 'react-native';
import { api } from '../api';

const images: Record<string, ImageSourcePropType> = {
  'homepage-car': require('../../assets/food/homepage-car.png'),
  'homepage-burger': require('../../assets/food/homepage-burger.png'),
  'home-promo': require('../../assets/food/home-promo.png'),
  'sushi-roll': require('../../assets/food/web/sushi-platter.jpg'),
  'restaurant-sushi': require('../../assets/food/web/sushi-platter.jpg'),
  kfc: require('../../assets/food/web/fried-chicken.jpg'),
  'restaurant-kfc': require('../../assets/food/web/fried-chicken.jpg'),
  halva: require('../../assets/food/web/plov-market.jpg'),
  'restaurant-halva': require('../../assets/food/web/plov-market.jpg'),
  'ali-burger': require('../../assets/food/web/burger.jpg'),
  'restaurant-burger': require('../../assets/food/web/burger.jpg'),
  'sushi-hero': require('../../assets/food/web/sushi-platter.jpg'),
  philadelphia: require('../../assets/food/web/sushi-roll.png'),
  'philadelphia-hero': require('../../assets/food/web/sushi-roll.png'),
  california: require('../../assets/food/web/california-roll.jpg'),
  tempura: require('../../assets/food/web/tempura-roll.jpg'),
  salmon: require('../../assets/food/web/salmon-sushi.jpg'),
  burger: require('../../assets/food/web/burger.jpg'),
  'chicken-burger': require('../../assets/food/web/burger.jpg'),
  'ali-cheeseburger': require('../../assets/food/web/burger.jpg'),
  'ali-combo': require('../../assets/food/web/burger.jpg'),
  'fried-chicken': require('../../assets/food/web/fried-chicken.jpg'),
  'chicken-bucket': require('../../assets/food/web/fried-chicken.jpg'),
  plov: require('../../assets/food/web/plov-market.jpg'),
  samosa: require('../../assets/food/web/samosa.jpg'),
  samsa: require('../../assets/food/web/samosa.jpg'),
  soy: require('../../assets/food/soy.png'),
  ginger: require('../../assets/food/ginger.png'),
  wasabi: require('../../assets/food/web/wasabi.jpg'),
  'philadelphia-cart': require('../../assets/food/web/sushi-roll.png'),
  'california-cart': require('../../assets/food/web/california-roll.jpg'),
  'restaurant-order': require('../../assets/food/web/sushi-platter.jpg'),
};

export function foodImage(key?: string | null, imageUrl?: string | null, fallbackKey?: string | null): ImageSourcePropType {
  const url = imageUrl?.trim();
  if (url?.startsWith('/api/content/media/')) return { uri: `${api.socketUrl}${url}` };
  if (url && /^https?:\/\//i.test(url)) return { uri: url };
  return images[key ?? ''] ?? images[fallbackKey ?? ''] ?? images['restaurant-sushi'];
}
