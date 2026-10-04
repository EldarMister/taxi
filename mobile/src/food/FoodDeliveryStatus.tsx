import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../design/typography';
import { palette as brand } from '../design/tokens';
import { money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { useFoodT } from './i18n';
import type { FoodRestaurant } from './types';
import { foodDeliveryTerms } from './promotions';

/** The progress is the food subtotal towards the restaurant's free-delivery minimum. */
export function FoodDeliveryStatus({ restaurant, subtotal, subtotalBeforeDiscount = subtotal, onPress }: {
  restaurant: FoodRestaurant; subtotal: number; subtotalBeforeDiscount?: number; onPress?: () => void;
}) {
  const s = useFoodStyles(styles);
  const c = useFoodColors();
  const t = useFoodT();
  const { threshold, amount, free, fee } = foodDeliveryTerms(restaurant, subtotal, subtotalBeforeDiscount);
  const progress = !free && threshold > 0;
  if (restaurant.isOpen === false) return <View testID="restaurant-closed-status" style={s.closedStatus}><View style={s.closedPill}><Ionicons name="moon" size={16} color={c.muted}/><Text style={s.closedText}>{t('Сейчас закрыто')}</Text></View></View>;
  return <Pressable testID="food-delivery-status" accessibilityRole="button" accessibilityLabel={t('Подробные условия доставки')} accessibilityState={{ disabled: !onPress }} disabled={!onPress} onPress={onPress} style={s.status}>
    {progress ? <View testID="food-free-delivery-progress" style={s.track}>
      <View style={[s.icon, { backgroundColor: brand.blue }]}><Ionicons name="walk" size={19} color="#FFFFFF"/></View>
      <Text style={[s.amount, { color: brand.blue }]}>{money(amount)}</Text>
      <View style={s.line}><View style={[s.fill, { backgroundColor: brand.blue, width: `${Math.min(100, amount / threshold * 100)}%` }]}/></View>
      <View style={[s.target, { borderColor: brand.blue }]}><Text style={[s.targetText, { color: brand.blue }]}>{money(threshold)}</Text></View>
    </View> : <View testID={free ? 'food-free-delivery-pill' : 'food-paid-delivery-pill'} style={[s.pill, { backgroundColor: brand.blue }]}>
      <Ionicons name="walk" size={18} color="#FFFFFF"/>
      <Text style={s.pillText}>{free ? t('Бесплатная доставка') : `${t('Доставка')} · ${money(fee)}`}</Text>
    </View>}
    <Text style={s.caption}>{progress ? `${t('До бесплатной доставки осталось')} ${money(threshold - amount)}` : `${restaurant.etaMin}–${restaurant.etaMax} ${t('мин')}`}</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  closedStatus: { alignSelf: 'stretch', paddingBottom: 9, paddingTop: 2 },
  closedPill: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 30, borderRadius: 17, backgroundColor: '#F1F1EF' },
  closedText: { color: '#8A9099', fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  status: { alignSelf: 'stretch', paddingBottom: 9, gap: 6 },
  pill: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, height: 30, borderRadius: 17, backgroundColor: '#169B62' },
  pillText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  track: { height: 34, paddingHorizontal: 5, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 20, backgroundColor: '#EAF3FF' },
  icon: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#169B62' },
  amount: { color: '#169B62', fontFamily: fonts.bold, fontSize: 15, lineHeight: 22 },
  line: { flex: 1, height: 4, borderRadius: 3, overflow: 'hidden', backgroundColor: '#BED9FA' },
  fill: { height: 4, backgroundColor: '#169B62' },
  target: { borderRadius: 14, paddingHorizontal: 7, paddingVertical: 2, borderWidth: 1, borderStyle: 'dashed', borderColor: '#169B62' },
  targetText: { color: '#169B62', fontFamily: fonts.semibold, fontSize: 13 },
  caption: { color: '#8A9099', fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: 'center' },
});
