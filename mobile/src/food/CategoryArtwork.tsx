import React, { memo } from 'react';
import { Image, type ImageSourcePropType } from 'react-native';
import { FoodPhoto } from './FoodPhoto';

// Individual images retain their own pixels when Android decodes them. Rendering
// and clipping a whole screenshot per tile caused unnecessary downsampling.
const artwork: Record<string, ImageSourcePropType> = {
  'Бургеры': require('../../assets/food/categories/burger.png'),
  'Суши': require('../../assets/food/categories/sushi.png'),
  'Пицца': require('../../assets/food/categories/pizza.png'),
  'Шаурма': require('../../assets/food/categories/shawarma.png'),
  'Плов': require('../../assets/food/categories/plov.png'),
  'Курица': require('../../assets/food/categories/chicken.png'),
  'Шашлык': require('../../assets/food/categories/kebab.png'),
  'Вок': require('../../assets/food/categories/wok.png'),
  'Паста': require('../../assets/food/categories/pasta.png'),
  'Стейки': require('../../assets/food/categories/steak.png'),
  'Выпечка': require('../../assets/food/categories/bakery.png'),
  'Сэндвичи': require('../../assets/food/categories/sandwich.png'),
  'Десерты': require('../../assets/food/categories/dessert.png'),
  'Кофе': require('../../assets/food/categories/coffee.png'),
  'Фастфуд': require('../../assets/food/categories/fast-food.png'),
  'Завтраки': require('../../assets/food/categories/breakfast.png'),
  'Детское': require('../../assets/food/categories/kids.png'),
  'Здоровая': require('../../assets/food/categories/healthy.png'),
  'Местная': require('../../assets/food/categories/local.png'),
  'Европа': require('../../assets/food/categories/european.png'),
  'Япония': require('../../assets/food/categories/japanese.png'),
  'Италия': require('../../assets/food/categories/italian.png'),
  'Грузинская': require('../../assets/food/categories/georgian.png'),
  'Восток': require('../../assets/food/categories/eastern.png'),
};
const dishes = [
  'Бургеры', 'Суши', 'Пицца', 'Шаурма',
  'Плов', 'Курица', 'Шашлык', 'Вок',
  'Паста', 'Стейки', 'Выпечка', 'Сэндвичи',
  'Десерты', 'Кофе', 'Фастфуд',
  'Завтраки', 'Детское', 'Здоровая',
];
const cuisines = ['Местная', 'Европа', 'Япония', 'Италия', 'Грузинская', 'Восток'];
const aliases: Record<string, string> = { 'Роллы': 'Суши', 'Национальная кухня': 'Местная', 'Восточная': 'Восток' };
export const CategoryArtwork = memo(function CategoryArtwork({ name, size = 72, imageKey, imageUrl }: { name: string; size?: number; imageKey?: string; imageUrl?: string | null }) {
  const label = aliases[name] ?? name;
  const source = artwork[label];
  if (!source) return <FoodPhoto imageKey={imageKey} imageUrl={imageUrl} resizeMode="cover" style={{ width: size, height: size, borderRadius: 18 }} />;
  return <Image accessible={false} source={source} fadeDuration={0} resizeMode="contain" resizeMethod="scale"
    style={{ width: size, height: size * .86 }} />;
});

export const filterDishCategories = dishes;
export const filterCuisines = cuisines;
