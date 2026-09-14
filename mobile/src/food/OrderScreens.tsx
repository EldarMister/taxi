import React from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../ui';
import { Reveal } from '../design/motion';
import { palette, radii } from '../design/tokens';
import { fonts } from '../design/typography';
import { FoodButton, FoodHeader, foodColors as c, money } from './components';
import { useFoodColors, useFoodStyles } from './foodTheme';
import { useTheme } from '../design/theme';
import { foodImage } from './assets';
import type { FoodOrder } from './types';

const stages = ['PLACED', 'CONFIRMED', 'PREPARING', 'DELIVERING', 'COMPLETED'];
export function foodOrderTitle(order: FoodOrder) {
  switch (order.status) {
    case 'PLACED': return 'Ожидаем подтверждения';
    case 'CONFIRMED': return 'Заказ подтверждён';
    case 'PREPARING': return 'Ваш заказ готовится';
    case 'READY': return order.fulfillment === 'PICKUP' ? 'Можно забирать' : 'Заказ готов';
    case 'DELIVERING': return 'Курьер уже в пути';
    case 'COMPLETED': return order.fulfillment === 'PICKUP' ? 'Заказ получен' : 'Заказ доставлен';
    case 'CANCELLED': return 'Заказ отменён';
  }
}
const time = (value: string) => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function FoodOrderScreen({ order, onBack, error, onRetry }: { order: FoodOrder; onBack: () => void; error: string; onRetry: () => void }) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const step = order.status === 'READY' ? 2 : stages.indexOf(order.status);
  const cancelled = order.status === 'CANCELLED';
  const activeStep = Math.max(0, step);
  const labels = ['Принят', 'Подтверждён', 'Готовится', 'В пути', 'Доставлен'];
  const subtitle = order.status === 'PLACED' ? 'Ресторан принимает ваш заказ' : order.status === 'READY' ? 'Передаём заказ курьеру' : order.status === 'DELIVERING' ? 'Курьер скоро будет у вас' : order.status === 'COMPLETED' ? 'Спасибо за заказ!' : cancelled ? 'Ресторан отменил заказ' : 'Ресторан уже готовит блюда';
  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <FoodHeader title={`Заказ #${order.id.slice(-4).toUpperCase()}`} onBack={onBack} />
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 10, paddingBottom: Math.max(20, insets.bottom + 12), flexGrow: 1 }}>
      <Reveal delay={20} style={[s.statusCard, cancelled && s.statusCardCancelled]}>
        <View style={s.statusTop}>
          <View style={[s.statusIcon, cancelled && { backgroundColor: '#E95757' }]}><Icon name={cancelled ? 'close' : order.status === 'DELIVERING' ? 'bicycle' : order.status === 'COMPLETED' ? 'checkmark' : 'restaurant-outline'} color={theme.isDark && !cancelled ? theme.palette.accentText : 'white'} size={23} /></View>
          <View style={{ flex: 1 }}><Text style={s.title}>{foodOrderTitle(order)}</Text><Text style={s.subtitle}>{subtitle}</Text></View>
          <View style={s.timePill}><Text style={s.timePillText}>{time(order.createdAt)}</Text></View>
        </View>
        {!cancelled && <View style={s.progress}>
          {labels.map((label, index) => {
            const reached = index <= activeStep;
            return <View key={label} style={s.progressStage}>
              <View style={s.progressTrack}>{index > 0 && <View style={[s.progressLine, reached && s.progressLineActive]} />}<View style={[s.progressDot, reached && s.progressDotActive, index === activeStep && s.progressDotCurrent]} /></View>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[s.progressLabel, reached && s.progressLabelActive]}>{label}</Text>
            </View>;
          })}
        </View>}
      </Reveal>

      <Reveal delay={65} style={s.sectionCard}>
        <View style={s.sectionHeading}><Text style={s.sectionTitle}>Ваш заказ</Text><Text style={s.itemCount}>{order.items.reduce((sum, item) => sum + item.quantity, 0)} поз.</Text></View>
        {order.items.map((item, index) => <View key={`${item.dishId}:${index}`} style={[s.orderItem, index > 0 && s.orderItemBorder]}>
          <Image source={foodImage(item.dishId, item.imageUrl, item.imageKey)} style={s.itemImage} />
          <View style={{ flex: 1, gap: 3 }}><Text style={s.itemName}>{item.name}</Text><Text style={s.muted}>{item.quantity} × {money(item.unitPrice)}</Text>{item.options.length > 0 && <Text numberOfLines={1} style={s.itemOptions}>{item.options.map(option => option.name).join(', ')}</Text>}</View>
          <Text style={s.itemTotal}>{money(item.lineTotal)}</Text>
        </View>)}
      </Reveal>

      <Reveal delay={95} style={s.sectionCard}>
        <View style={s.addressRow}><View style={s.addressIcon}><Icon name="location" color={c.blue} size={22} /></View><View style={{ flex: 1 }}><Text style={s.cardEyebrow}>АДРЕС ДОСТАВКИ</Text><Text style={s.addressText}>{order.address || 'Адрес не указан'}</Text></View></View>
        {!!order.comment && <View style={s.commentRow}><Icon name="chatbubble-ellipses-outline" color={c.muted} size={19} /><Text style={[s.muted, { flex: 1 }]}>{order.comment}</Text></View>}
      </Reveal>

      <Reveal delay={120} style={s.sectionCard}>
        <View style={s.totalRow}><Text style={s.muted}>Блюда</Text><Text style={s.totalMeta}>{money(order.subtotal)}</Text></View>
        <View style={s.totalRow}><Text style={s.muted}>Доставка</Text><Text style={s.totalMeta}>{order.deliveryFee ? money(order.deliveryFee) : 'Бесплатно'}</Text></View>
        <View style={[s.totalRow, s.grandTotalRow]}><Text style={s.grandTotalLabel}>Итого</Text><Text style={s.grandTotal}>{money(order.total)}</Text></View>
      </Reveal>

      <Reveal delay={145} style={s.restaurant}>
        <Image source={foodImage(order.restaurant.id === 'sushi-roll' ? 'restaurant-order' : order.restaurant.imageKey, order.restaurant.imageUrl)} style={s.restaurantImage} />
        <View style={{ flex: 1, gap: 3 }}><Text style={s.restaurantName}>{order.restaurant.name}</Text><Text style={s.muted}>Доставка {order.restaurant.etaMin}–{order.restaurant.etaMax} мин</Text></View><Icon name="chevron-forward" color={c.muted} size={18} />
      </Reveal>
      <FoodButton secondary label="Связаться с рестораном" onPress={() => {
        const phone = order.restaurant.phone;
        if (!phone) { Alert.alert('Контакт ресторана', 'Ресторан пока не указал номер телефона.'); return; }
        void Linking.openURL(`tel:${phone}`).catch(() => Alert.alert('Не удалось позвонить', phone));
      }} />
      {!!error && <Pressable accessibilityRole="button" onPress={onRetry} style={s.notice}><Text style={{ color: theme.isDark ? '#FF8A8A' : '#B74747', fontFamily: fonts.regular, fontSize: 13, textAlign: 'center' }}>{error}{'\n'}Нажмите, чтобы обновить статус</Text></Pressable>}
      {order.isDemo && <Text style={s.demo}>Тестовый заказ · ресторан из макетов</Text>}
    </ScrollView>
  </SafeAreaView>;
}

export function FoodHistoryScreen({ orders, loading, error, onBack, onOrder, onRetry }: { orders: FoodOrder[]; loading: boolean; error: string; onBack: () => void; onOrder: (order: FoodOrder) => void; onRetry: () => void }) {
  const s = useFoodStyles(baseStyles);
  const c = useFoodColors();
  const insets = useSafeAreaInsets();
  return <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
    <FoodHeader title="Мои заказы еды" onBack={onBack} />
    <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: Math.max(insets.bottom, 20), flexGrow: 1 }}>
      {loading && !orders.length && <ActivityIndicator size="large" color={c.blue} style={{ marginTop: 40 }} />}
      {!!error && <View style={s.notice}><Text style={[s.muted, { textAlign: 'center', marginBottom: 12 }]}>{error}</Text><FoodButton label="Повторить" onPress={onRetry} secondary /></View>}
      {!loading && !error && !orders.length && <View style={s.empty}><Icon name="receipt-outline" color={c.blue} size={64} /><Text style={{ color: c.ink, fontFamily: fonts.bold, fontSize: 23 }}>Заказов пока нет</Text><Text style={[s.muted, { textAlign: 'center' }]}>Здесь появятся ваши заказы из ресторанов.</Text></View>}
      <Reveal delay={45}>{orders.map(order => <Pressable accessibilityRole="button" key={order.id} onPress={() => onOrder(order)} style={s.historyRow}><Image source={foodImage(order.restaurant.imageKey, order.restaurant.imageUrl)} style={s.restaurantImage} /><View style={{ flex: 1, gap: 5 }}><Text style={s.historyName}>{order.restaurant.name}</Text><Text style={s.historyStatus}>{foodOrderTitle(order)}</Text><Text style={s.muted}>{new Date(order.createdAt).toLocaleDateString('ru-RU')} · {money(order.total)}</Text></View><Icon name="chevron-forward" color={c.muted} /></Pressable>)}</Reveal>
    </ScrollView>
  </SafeAreaView>;
}

const baseStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.canvas },
  statusCard: { marginBottom: 12, padding: 16, borderRadius: radii.hero, backgroundColor: '#EAF4FF', borderWidth: 1, borderColor: '#CFE4FF' },
  statusCardCancelled: { backgroundColor: '#FFF2F2', borderColor: '#FFD7D7' },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  statusIcon: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: c.blue },
  title: { color: '#070D16', fontFamily: fonts.bold, fontSize: 19, lineHeight: 24, letterSpacing: -.45 },
  subtitle: { marginTop: 2, color: c.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  timePill: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: 'rgba(255,255,255,.76)' },
  timePillText: { color: c.ink, fontFamily: fonts.semibold, fontSize: 12 },
  progress: { flexDirection: 'row', marginTop: 18 },
  progressStage: { flex: 1, alignItems: 'center' },
  progressTrack: { width: '100%', height: 15, alignItems: 'center', justifyContent: 'center' },
  progressLine: { position: 'absolute', right: '50%', width: '100%', height: 3, backgroundColor: '#C5D1DE' },
  progressLineActive: { backgroundColor: c.blue },
  progressDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#C5D1DE', zIndex: 1 },
  progressDotActive: { backgroundColor: c.blue },
  progressDotCurrent: { width: 13, height: 13, borderRadius: 7, borderWidth: 3, borderColor: '#B9D9FF' },
  progressLabel: { width: '100%', marginTop: 4, paddingHorizontal: 1, color: c.muted, fontFamily: fonts.medium, fontSize: 9, textAlign: 'center' },
  progressLabelActive: { color: c.ink },
  muted: { color: c.muted, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  sectionCard: { marginBottom: 12, padding: 15, borderRadius: radii.large, backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  sectionTitle: { color: c.ink, fontFamily: fonts.bold, fontSize: 18, letterSpacing: -.35 },
  itemCount: { color: c.muted, fontFamily: fonts.medium, fontSize: 13 },
  orderItem: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  orderItemBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  itemImage: { width: 57, height: 57, borderRadius: 15, backgroundColor: palette.surface },
  itemName: { color: c.ink, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  itemOptions: { color: c.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  itemTotal: { color: c.ink, fontFamily: fonts.bold, fontSize: 15 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addressIcon: { width: 42, height: 42, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blueSoft },
  cardEyebrow: { marginBottom: 2, color: c.blue, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1 },
  addressText: { color: c.ink, fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  commentRow: { marginTop: 12, paddingTop: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  totalRow: { minHeight: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalMeta: { color: c.ink, fontFamily: fonts.medium, fontSize: 14 },
  grandTotalRow: { marginTop: 8, paddingTop: 12, borderTopWidth: 1, borderTopColor: palette.line },
  grandTotalLabel: { color: c.ink, fontFamily: fonts.bold, fontSize: 19 },
  grandTotal: { color: c.ink, fontFamily: fonts.extraBold, fontSize: 21 },
  restaurant: { marginBottom: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radii.large, backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  restaurantImage: { width: 58, height: 58, borderRadius: radii.medium, backgroundColor: palette.surface },
  restaurantName: { color: c.ink, fontFamily: fonts.bold, fontSize: 17, letterSpacing: -.35 },
  notice: { borderRadius: radii.small, backgroundColor: '#FFF4F3', padding: 12, marginTop: 14 },
  demo: { marginTop: 14, color: c.muted, fontFamily: fonts.regular, fontSize: 11, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 20 },
  historyRow: { marginBottom: 10, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 13, borderRadius: radii.large, backgroundColor: c.white, borderWidth: 1, borderColor: palette.line },
  historyName: { color: c.ink, fontFamily: fonts.semibold, fontSize: 17 },
  historyStatus: { color: c.blue, fontFamily: fonts.medium, fontSize: 13 },
});
