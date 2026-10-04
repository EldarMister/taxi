import React, { memo, useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SpringPressable } from '../design/motion';
import { palette } from '../design/tokens';
import { fonts } from '../design/typography';
import { FoodPhoto } from './FoodPhoto';
import { money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { MAX_FOOD_QUANTITY } from './cart';
import { NumberTicker } from './NumberTicker';
import type { FoodDish } from './types';

export function dishCardSize(width: number, format: 'grid' | 'horizontal') {
  return { width, height: Math.ceil(width * (format === 'horizontal' ? 1.14 : 1) + 111) };
}

export function dishDiscount(dish: FoodDish) {
  return dish.originalPrice && dish.originalPrice > dish.price
    ? Math.round((1 - dish.price / dish.originalPrice) * 100) : 0;
}

/** Controls sit over the photo as siblings of the link, keeping taps independent. */
export const DishCard = memo(function DishCard({ dish, width = 164, format = 'horizontal', quantity = 0, orderingDisabled = false, onOpen, onIncrease, onDecrease }: {
  dish: FoodDish; width?: number; format?: 'grid' | 'horizontal'; quantity?: number;
  onOpen: () => void; onIncrease: () => void; onDecrease: () => void;
  orderingDisabled?: boolean;
}) {
  const s = useFoodStyles(styles);
  const c = useFoodColors();
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [dish.id, dish.imageUrl, dish.imageKey]);
  const onPhotoLoad = useCallback(() => setLoaded(true), []);
  const onPhotoError = useCallback(() => setLoaded(false), []);
  const size = dishCardSize(width, format);
  const photoHeight = width * (format === 'horizontal' ? 1.14 : 1);
  const disabled = orderingDisabled || !dish.available || quantity >= MAX_FOOD_QUANTITY;
  const discount = dishDiscount(dish);
  const compact = width < 140;
  return <View testID={`dish-card-${dish.id}`} style={[s.dishCard, format === 'grid' ? { width } : size, !dish.available && { opacity: .5 }]}>
    <SpringPressable accessibilityRole="button" accessibilityLabel={`Открыть ${dish.name}`} onPress={onOpen} pressScale={.99}>
      <View testID="dish-photo-frame" style={[s.photoFrame, { height: photoHeight, borderRadius: compact ? 20 : 24 }]}>
        {!loaded && <View pointerEvents="none" testID="dish-photo-placeholder" style={s.placeholder}>
          <Ionicons name="restaurant-outline" size={28} color={c.muted}/>
        </View>}
        <FoodPhoto imageKey={dish.id} imageUrl={dish.imageUrl} fallbackKey={dish.imageKey} resizeMode="cover"
          onLoad={onPhotoLoad} onError={onPhotoError} style={s.photo}/>
        {!!discount && <View style={[s.discount, compact && s.discountCompact]}><Text style={s.discountText}>−{discount}%</Text></View>}
      </View>
      <View style={s.copy}>
        <View style={[s.prices, compact && s.compactPrices]}>
          <Text style={[s.price, compact && s.compactPrice, !!discount && s.salePrice]}>{money(dish.price)}</Text>
          {!!discount && <Text style={s.oldPrice} numberOfLines={1}>{money(dish.originalPrice!)}</Text>}
        </View>
        <Text style={[s.name, compact && s.compactName]} numberOfLines={2} maxFontSizeMultiplier={1.1}>{dish.name}</Text>
        <Text style={[s.portion, compact && s.compactPortion]} numberOfLines={1} maxFontSizeMultiplier={1.1}>{dish.portion}{dish.calories != null ? ` · ${dish.calories} ккал` : ''}</Text>
        {!!dish.reviewCount && dish.ratingPercent != null ? <View style={s.rating}><Ionicons name="thumbs-up" size={12} color={c.ink}/><Text style={s.ratingText}>{dish.ratingPercent}% ({dish.reviewCount})</Text></View>
          : !!dish.badge && <Text style={[s.badge, dish.badge.toLowerCase().includes('запеч') && s.bakedBadge]} numberOfLines={1}>{dish.badge}</Text>}
      </View>
    </SpringPressable>
    <View testID="dish-card-footer" pointerEvents="box-none" style={[s.footer, { top: photoHeight - 46 }]}>
      {quantity > 0 ? <View style={s.stepper}>
        <SpringPressable accessibilityRole="button" accessibilityLabel={`Уменьшить ${dish.name}`} hitSlop={3}
          onPress={onDecrease} pressScale={.9} style={s.stepButton}><Ionicons name="remove" color={c.ink} size={22}/></SpringPressable>
        <NumberTicker value={quantity} style={s.count} height={22} accessibilityLabel={`${quantity} порций`}/>
        <SpringPressable accessibilityRole="button" accessibilityLabel={`Увеличить ${dish.name}`} disabled={disabled}
          accessibilityState={{ disabled }} hitSlop={3} onPress={onIncrease} pressScale={.9}
          style={s.stepButton}><Ionicons name="add" color={disabled ? c.muted : c.ink} size={22}/></SpringPressable>
      </View> : <SpringPressable accessibilityRole="button" accessibilityLabel={`Добавить ${dish.name} в корзину`} disabled={disabled}
        accessibilityState={{ disabled }} hitSlop={5} onPress={onIncrease} pressScale={.9}
        style={s.add}><Ionicons name="add" color={c.ink} size={25}/></SpringPressable>}
    </View>
  </View>;
});

const styles = StyleSheet.create({
  dishCard: { backgroundColor: 'transparent' },
  photoFrame: { width: '100%', overflow: 'hidden', backgroundColor: palette.surface },
  photo: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  copy: { paddingHorizontal: 5, paddingTop: 8 },
  prices: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 4, minHeight: 22 },
  compactPrices: { flexDirection: 'column', alignItems: 'flex-start', gap: 0 },
  price: { color: palette.ink, fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 },
  compactPrice: { fontSize: 14 },
  salePrice: { color: '#258B5F' },
  oldPrice: { color: '#999999', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, textDecorationLine: 'line-through' },
  name: { marginTop: 1, color: palette.ink, fontFamily: fonts.regular, fontSize: 13, lineHeight: 17 },
  compactName: { fontSize: 12, lineHeight: 15 },
  portion: { marginTop: 1, color: '#999999', fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  compactPortion: { fontSize: 11, lineHeight: 15 },
  footer: { position: 'absolute', left: 8, right: 8, height: 38, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  add: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: palette.white },
  stepper: { flex: 1, height: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 19, backgroundColor: palette.white },
  stepButton: { width: 32, height: 38, alignItems: 'center', justifyContent: 'center' },
  count: { flex: 1, color: palette.ink, fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  discount: { position: 'absolute', top: 12, left: 12, borderRadius: 7, paddingHorizontal: 7, paddingVertical: 4, backgroundColor: '#009B59' },
  discountCompact: { top: 9, left: 9, paddingHorizontal: 6, paddingVertical: 3 },
  discountText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  badge: { marginTop: 2, color: palette.ink, fontFamily: fonts.semibold, fontSize: 11, lineHeight: 15 },
  bakedBadge: { color: '#E19336' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  ratingText: { color: palette.ink, fontFamily: fonts.semibold, fontSize: 10, lineHeight: 15 },
});
