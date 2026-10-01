import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomPanel } from '../BottomPanel';
import { useTheme } from '../design/theme';
import { fonts } from '../design/typography';
import { FoodButton, money } from './components';
import { cartSummary } from './cart';
import { useFoodT } from './i18n';
import { NumberTicker } from './NumberTicker';
import { shortAddress } from '../address';
import type { CartLine, FoodRestaurant } from './types';

type Props = {
  restaurant?: FoodRestaurant;
  lines: CartLine[];
  deliveryAddress: string;
  onClose: () => void;
};

function validPositiveAmount(value: number | undefined): value is number {
  return value !== undefined && Number.isSafeInteger(value) && value > 0;
}

function Fact({ label, value, color, muted }: { label: string; value: React.ReactNode; color: string; muted: string }) {
  return <View style={styles.factRow}>
    <Text style={[styles.factLabel, { color: muted }]}>{label}</Text>
    <View style={styles.factValueWrap}>{typeof value === 'string'
      ? <Text style={[styles.factValue, { color }]}>{value}</Text>
      : value}</View>
  </View>;
}

/** Uses the live restaurant catalog and cart totals; the old app's hours and order maximum are not in this API. */
export function DeliveryInfoSheet({ restaurant, lines, deliveryAddress, onClose }: Props) {
  const t = useFoodT();
  const [closing, setClosing] = useState(false);
  const { height } = useWindowDimensions();
  const { palette } = useTheme();
  const summary = cartSummary(restaurant, lines, 'DELIVERY');
  const threshold = validPositiveAmount(restaurant?.freeDeliveryThreshold) ? restaurant.freeDeliveryThreshold : 0;
  const baseFee = validPositiveAmount(restaurant?.deliveryFee) ? restaurant.deliveryFee : 0;
  const fee = summary.count ? summary.deliveryFee : baseFee;
  const remaining = threshold && baseFee ? Math.max(0, threshold - summary.subtotal) : 0;
  const address = shortAddress(deliveryAddress);
  const etaMin = restaurant?.etaMin;
  const etaMax = restaurant?.etaMax;
  const hasEta = validPositiveAmount(etaMin) && validPositiveAmount(etaMax) && etaMax >= etaMin;
  const eta = hasEta ? `~${etaMin === etaMax ? etaMax : `${etaMin}–${etaMax}`} ${t('мин')}` : t('Уточняется');

  return <BottomPanel onClose={onClose} closeRequested={closing} label={t('Закрыть информацию о доставке')}>
    <View style={[styles.sheet, { backgroundColor: palette.surface }]}>
      <ScrollView style={{ maxHeight: Math.max(280, height * .67) }} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={[styles.iconCircle, { backgroundColor: palette.elevated, borderColor: palette.line }]}>
            <MaterialCommunityIcons name="truck-delivery-outline" size={24} color={palette.accent} />
          </View>
          <View style={styles.headerCopy}>
            {restaurant ? fee > 0
              ? <View style={styles.headerLine}><Text style={[styles.headerTitle, { color: palette.ink }]}>{t('Доставка')} </Text><NumberTicker value={fee} format={money} style={[styles.headerTitle, { color: palette.ink }]} /></View>
              : <Text style={[styles.headerTitle, { color: palette.ink }]}>{t('Доставка бесплатно')}</Text>
              : <Text style={[styles.headerTitle, { color: palette.ink }]}>{t('Информация о доставке')}</Text>}
            {remaining > 0 && <View style={styles.remainingLine}>
              <Text style={[styles.remainingText, { color: palette.muted }]}>{t('До бесплатной доставки')} </Text>
              <NumberTicker value={remaining} format={money} style={[styles.remainingText, { color: palette.muted }]} />
            </View>}
          </View>
        </View>

        <Text style={[styles.addressLabel, { color: palette.muted }]}>{t('Адрес доставки')}</Text>
        <Text style={[styles.address, { color: palette.ink }]}>{address || t('Укажите адрес при оформлении')}</Text>

        {restaurant && <>
          <View style={styles.facts}>
            <Fact label={t('Время доставки')} value={eta} color={palette.ink} muted={palette.muted} />
            <Fact label={t('Минимальный заказ')} value={validPositiveAmount(restaurant.minimumOrder) ? money(restaurant.minimumOrder) : t('Без минимальной суммы заказа')} color={palette.ink} muted={palette.muted} />
          </View>

          <View style={[styles.priceSection, { borderTopColor: palette.line }]}>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>{t('Стоимость доставки')}</Text>
            {threshold > 0 && baseFee > 0 ? <>
              <Fact label={`${t('При заказе до')} ${money(threshold)}`} value={money(baseFee)} color={palette.ink} muted={palette.muted} />
              <Fact label={`${t('При заказе от')} ${money(threshold)}`} value={money(0)} color={palette.ink} muted={palette.muted} />
            </> : <Fact label={t('Доставка')} value={baseFee ? money(baseFee) : t('Бесплатно')} color={palette.ink} muted={palette.muted} />}
          </View>
        </>}
      </ScrollView>
      <View style={[styles.footer, { borderTopColor: palette.line }]}>
        <FoodButton label={t('Понятно')} onPress={() => setClosing(true)} secondary style={{ backgroundColor: palette.elevated }} />
      </View>
    </View>
  </BottomPanel>;
}

const styles = StyleSheet.create({
  sheet: { overflow: 'hidden' },
  content: { paddingHorizontal: 24, paddingTop: 21, paddingBottom: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  iconCircle: { width: 50, height: 50, borderWidth: 1, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  headerTitle: { fontFamily: fonts.semibold, fontSize: 18, lineHeight: 25 },
  remainingLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 2 },
  remainingText: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  addressLabel: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 28, marginBottom: 6 },
  address: { fontFamily: fonts.bold, fontSize: 23, lineHeight: 30, letterSpacing: -.5 },
  facts: { marginTop: 28, gap: 17 },
  factRow: { minHeight: 23, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 },
  factLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  factValueWrap: { flexShrink: 0, maxWidth: '50%', alignItems: 'flex-end' },
  factValue: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 21, textAlign: 'right' },
  priceSection: { marginTop: 24, paddingTop: 22, borderTopWidth: StyleSheet.hairlineWidth, gap: 15 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, marginBottom: 3 },
  footer: { paddingHorizontal: 20, paddingTop: 13, paddingBottom: 4, borderTopWidth: StyleSheet.hairlineWidth },
});
