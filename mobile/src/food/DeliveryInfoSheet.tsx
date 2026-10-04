import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomPanel } from '../BottomPanel';
import { useTheme } from '../design/theme';
import { fonts } from '../design/typography';
import { money } from './components';
import { cartSummary } from './cart';
import { foodDeliveryTerms } from './promotions';
import { useFoodT } from './i18n';
import type { CartLine, FoodRestaurant } from './types';

type Props = {
  restaurant?: FoodRestaurant;
  lines: CartLine[];
  deliveryAddress: string;
  onClose: () => void;
};

/** Prices come from the selected restaurant and its own basket. */
export function DeliveryInfoSheet({ restaurant, lines, onClose }: Props) {
  const t = useFoodT();
  const { palette, isDark } = useTheme();
  const summary = cartSummary(restaurant, lines, 'DELIVERY');
  const delivery = foodDeliveryTerms(restaurant, summary.subtotal, summary.subtotalBeforeDiscount);
  const baseFee = delivery.baseFee;
  const fee = summary.count ? summary.deliveryFee : delivery.fee;
  const discounted = baseFee > fee;

  return <BottomPanel onClose={onClose} label={t('Закрыть информацию о доставке')}>
    <View testID="food-delivery-conditions" style={[styles.sheet, { backgroundColor: palette.surface }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: palette.ink }]}>{t('Текущие условия')}</Text>
      <View style={[styles.deliveryCard, { borderColor: palette.line }]}>
        <View style={styles.deliveryHeading}>
          <View style={[styles.deliveryIcon, { backgroundColor: isDark ? palette.elevated : '#454A43' }]}><Ionicons name="walk" size={23} color="#FFFFFF" /></View>
          <Text style={[styles.deliveryLabel, { color: palette.ink }]}>{t('Доставка')}</Text>
          {restaurant ? <View style={styles.prices}>
            {discounted && <Text testID="delivery-original-fee" style={[styles.originalFee, { color: palette.muted }]}>{money(baseFee)}</Text>}
            <Text testID="delivery-current-fee" style={[styles.fee, { color: '#74B943' }]}>{money(fee)}</Text>
          </View> : <Text style={[styles.pendingPrice, { color: palette.muted }]}>{t('Уточняется')}</Text>}
        </View>
        <Text style={[styles.explanation, { color: palette.muted }]}>{t('Цена доставки зависит от размера корзины, расстояния до ресторана и других факторов. Соберите заказ и мы рассчитаем финальную стоимость')}</Text>
      </View>
    </View>
  </BottomPanel>;
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingBottom: 13 },
  title: { fontFamily: fonts.semibold, fontSize: 21, lineHeight: 28, textAlign: 'center', marginTop: 5, marginBottom: 24 },
  deliveryCard: { borderWidth: 1, borderRadius: 17, paddingHorizontal: 16, paddingVertical: 15 },
  deliveryHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  deliveryIcon: { width: 33, height: 33, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  deliveryLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  prices: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  originalFee: { fontFamily: fonts.medium, fontSize: 11, lineHeight: 17, textDecorationLine: 'line-through' },
  fee: { fontFamily: fonts.semibold, fontSize: 24, lineHeight: 29 },
  pendingPrice: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  explanation: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 15, marginTop: 14 },
});
