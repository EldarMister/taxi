import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { SpringPressable } from '../design/motion';
import { palette, radii } from '../design/tokens';
import { fonts } from '../design/typography';
import { useFoodStyles } from './foodTheme';
import { FoodHeader, money } from './components';
import { foodImage } from './assets';
import type { FoodDish, FoodRestaurant } from './types';
import { useFoodT } from './i18n';

export type FavoriteDish = { restaurant: FoodRestaurant; dish: FoodDish };

export function FavoritesScreen({ restaurants, dishes, onBack, onRestaurant, onDish }: {
  restaurants: FoodRestaurant[];
  dishes: FavoriteDish[];
  onBack: () => void;
  onRestaurant: (restaurant: FoodRestaurant) => void;
  onDish: (restaurant: FoodRestaurant, dish: FoodDish) => void;
}) {
  const t = useFoodT();
  const s = useFoodStyles(styles);
  const insets = useSafeAreaInsets();
  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <FoodHeader title={t('Избранное')} onBack={onBack} />
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom, 24) }]}>
      {!restaurants.length && !dishes.length ? <View style={s.empty}>
        <View style={s.emptyIcon}><Ionicons name="heart-outline" size={46} color={palette.blue} /></View>
        <Text style={s.emptyTitle}>{t('Пока ничего не сохранено')}</Text>
        <Text style={s.emptyText}>{t('Нажмите на сердечко у ресторана или блюда, чтобы найти его здесь.')}</Text>
      </View> : <>
        {restaurants.length > 0 && <View style={s.section}>
          <Text style={s.sectionTitle}>{t('Рестораны')}</Text>
          {restaurants.map(restaurant => <SpringPressable key={restaurant.id} accessibilityRole="button" accessibilityLabel={`Открыть ресторан ${restaurant.name}`} onPress={() => onRestaurant(restaurant)} pressScale={.98} style={s.row}>
            <Image source={foodImage(restaurant.imageKey, restaurant.imageUrl)} style={s.image} resizeMode="cover" />
            <View style={s.copy}><Text style={s.name} numberOfLines={1}>{restaurant.name}</Text><Text style={s.meta} numberOfLines={1}>{t(restaurant.cuisine)} · {restaurant.etaMin}–{restaurant.etaMax} {t('мин')}</Text><Text style={s.delivery} numberOfLines={1}>{restaurant.deliveryFee ? `${t('Доставка')} ${money(restaurant.deliveryFee)}` : t('Бесплатная доставка')}</Text></View>
            <Ionicons name="chevron-forward" size={20} color={palette.muted} />
          </SpringPressable>)}
        </View>}
        {dishes.length > 0 && <View style={s.section}>
          <Text style={s.sectionTitle}>{t('Блюда')}</Text>
          {dishes.map(({ restaurant, dish }) => <SpringPressable key={`${restaurant.id}:${dish.id}`} accessibilityRole="button" accessibilityLabel={`Открыть блюдо ${dish.name} из ${restaurant.name}`} onPress={() => onDish(restaurant, dish)} pressScale={.98} style={s.row}>
            <Image source={foodImage(dish.id, dish.imageUrl, dish.imageKey)} style={s.image} resizeMode="cover" />
            <View style={s.copy}><Text style={s.name} numberOfLines={1}>{dish.name}</Text><Text style={s.meta} numberOfLines={1}>{restaurant.name} · {dish.portion}</Text><Text style={s.delivery}>{money(dish.price)}</Text></View>
            <Ionicons name="chevron-forward" size={20} color={palette.muted} />
          </SpringPressable>)}
        </View>}
      </>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  content: { paddingHorizontal: 16, paddingTop: 10, gap: 26 },
  section: { gap: 10 },
  sectionTitle: { color: palette.ink, fontFamily: fonts.bold, fontSize: 22, lineHeight: 28, marginBottom: 3 },
  row: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 9, borderRadius: radii.large, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.line },
  image: { width: 74, height: 74, borderRadius: 15, backgroundColor: palette.line },
  copy: { flex: 1, gap: 3 },
  name: { color: palette.ink, fontFamily: fonts.bold, fontSize: 16, lineHeight: 20 },
  meta: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  delivery: { color: palette.blue, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  empty: { minHeight: 450, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  emptyIcon: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blueSoft, marginBottom: 6 },
  emptyTitle: { color: palette.ink, fontFamily: fonts.bold, fontSize: 21, textAlign: 'center' },
  emptyText: { color: palette.muted, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, textAlign: 'center' },
});
