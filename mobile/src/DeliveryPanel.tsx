import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Image, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel, panelStyle } from './BottomPanel';
import { useTheme } from './design/theme';
import type { Point, Quote, Tariff } from './types';
import { colors, Icon, PickupIcon, km, mins, money, shortAddress, ToggleSwitch } from './ui';

export type DeliveryDetails = {
  goodsDescription: string;
  comment: string;
  doorToDoor: boolean;
  bodyType: 'VAN' | 'OPEN' | 'BOX';
  loaders: 0 | 1 | 2;
  scheduled: boolean;
};
export const emptyDeliveryDetails: DeliveryDetails = { goodsDescription: '', comment: '', doorToDoor: false, bodyType: 'VAN', loaders: 0, scheduled: false };

type Props = {
  pickup: Point | null; dropoff: Point | null; tariffs: Tariff[]; selectedKind: 'DELIVERY_CAR' | 'DELIVERY_TRUCK';
  quote: Quote | null; quotes: Record<string, Quote>; calculating: boolean; error?: string; busy: boolean;
  details: DeliveryDetails; onDetails: (value: DeliveryDetails) => void; onKind: (kind: 'DELIVERY_CAR' | 'DELIVERY_TRUCK') => void;
  onAddress: (field: 'pickup' | 'dropoff') => void; onBook: () => void; onRefresh: () => void; onHeight: (height: number) => void; hidden?: boolean;
};

export function DeliveryPanel({ pickup, dropoff, tariffs, selectedKind, quote, quotes, calculating, error, busy, details, onDetails, onKind, onAddress, onBook, onRefresh, onHeight, hidden }: Props) {
  const { isDark, palette } = useTheme();
  const insets = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false);
  const selected = tariffs.find(item => item.kind === selectedKind);
  const ready = !!pickup && !!dropoff;
  const descriptionReady = details.goodsDescription.trim().length >= 3;
  const open = () => setExpanded(true);
  const pull = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => gesture.dy < -7 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderRelease: (_event, gesture) => { if (gesture.dy < -24 || gesture.vy < -.3) open(); },
  }), []);
  const footer = (inside = false) => <View style={d.footer}>
    <View style={d.cash}><Icon name="cash-outline" color="#2DBE4E" size={28}/></View>
    <Pressable accessibilityRole="button" disabled={busy || calculating} onPress={!ready ? () => onAddress(dropoff ? 'pickup' : 'dropoff') : !descriptionReady ? open : quote ? onBook : onRefresh} style={({ pressed }) => [d.primary, { backgroundColor: isDark ? palette.ink : '#FFE100' }, (pressed || busy || calculating) && { opacity: .6 }]}>{(busy || calculating) && <ActivityIndicator size="small" color={isDark ? palette.background : '#202020'}/>}<Text style={[d.primaryText, { color: isDark ? palette.background : '#202020' }]}>{!ready ? 'Указать адреса' : !descriptionReady ? 'Уточнить детали' : calculating ? 'Считаем…' : quote ? 'Заказать доставку' : 'Обновить расчёт'}</Text></Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={inside ? 'Свернуть параметры' : 'Параметры доставки'} onPress={inside ? () => setExpanded(false) : open} style={d.parameters}><Icon name={inside ? 'chevron-down' : 'options-outline'} color={palette.ink} size={26}/></Pressable>
  </View>;
  if (hidden) return null;
  return <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 20 }]}>
    <View accessibilityElementsHidden={expanded} importantForAccessibility={expanded ? 'no-hide-descendants' : 'auto'} onLayout={event => onHeight(event.nativeEvent.layout.height)} {...pull.panHandlers} style={[panelStyle.surface, d.panel, isDark && { backgroundColor: palette.surface, shadowColor: palette.background }, { paddingBottom: Math.max(insets.bottom, 11) }]}>
      <View style={d.handle}/>
      <View style={d.titleRow}><View style={d.deliveryMark}><Icon name="cube" color="#FFFFFF" size={22}/></View><Text style={[d.title, { color: palette.ink }]}>Доставка</Text></View>
      <AddressRow label="Адрес отправки" value={pickup?.address || 'Определяем местоположение'} pickup onPress={() => onAddress('pickup')} color={palette.ink}/>
      <AddressRow label="Куда доставить" value={dropoff?.address || 'Куда доставить'} onPress={() => onAddress('dropoff')} color={palette.ink}/>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={d.services}>
        <View style={[d.service, { opacity: .45 }]}><Icon name="bicycle-outline" color={palette.muted} size={36}/><Text style={[d.serviceTime, { color: palette.muted }]}>Скоро</Text><Text style={[d.serviceName, { color: palette.muted }]}>Курьер</Text></View>
        <DeliveryService title="Доставка" subtitle="Мелкий чистый груз" source={require('../assets/home/taxi-yellow.png')} selected={selectedKind === 'DELIVERY_CAR'} price={tariffs.find(item => item.kind === 'DELIVERY_CAR') ? quotes[tariffs.find(item => item.kind === 'DELIVERY_CAR')!.id]?.price : undefined} onPress={() => onKind('DELIVERY_CAR')} palette={palette}/>
        <DeliveryService title="Грузовой" subtitle="Крупный груз" source={require('../assets/home/truck-white.png')} selected={selectedKind === 'DELIVERY_TRUCK'} price={tariffs.find(item => item.kind === 'DELIVERY_TRUCK') ? quotes[tariffs.find(item => item.kind === 'DELIVERY_TRUCK')!.id]?.price : undefined} onPress={() => onKind('DELIVERY_TRUCK')} palette={palette}/>
      </ScrollView>
      {quote && <Text style={[d.routeMeta, { color: palette.muted }]}>{km(quote.distanceMeters)} · около {mins(quote.durationSeconds, 'ru')} · {money(quote.price)}</Text>}
      {!!error && <Text accessibilityRole="alert" style={d.error}>{error}</Text>}
      {footer()}
    </View>
    {expanded && <BottomPanel expanded onClose={() => setExpanded(false)} label="Закрыть параметры доставки">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={[d.details, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={d.detailsHeading}><View><Text style={[d.detailsTitle, { color: palette.ink }]}>Параметры доставки</Text><Text style={[d.hint, { color: palette.muted }]}>{selected?.description || (selectedKind === 'DELIVERY_TRUCK' ? 'Для крупных грузов' : 'Для небольших чистых грузов')}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setExpanded(false)} style={d.close}><Icon name="close" color={palette.ink}/></Pressable></View>
        <View style={[d.deliveryHero, { backgroundColor: isDark ? palette.elevated : '#F4F6F8' }]}><Image source={selectedKind === 'DELIVERY_TRUCK' ? require('../assets/home/truck-white.png') : require('../assets/home/taxi-yellow.png')} resizeMode="contain" style={d.heroImage}/><View style={{ flex: 1 }}><Text style={[d.heroTitle, { color: palette.ink }]}>{selectedKind === 'DELIVERY_TRUCK' ? 'Грузовой' : 'Доставка'}</Text><Text style={[d.hint, { color: palette.muted }]}>{quote ? `${money(quote.price)} · ${mins(quote.durationSeconds, 'ru')}` : selected ? `от ${money(selected.minimumPrice)}` : 'Стоимость после маршрута'}</Text></View></View>
        <Text style={[d.label, { color: palette.ink }]}>Что нужно доставить?</Text>
        <TextInput value={details.goodsDescription} onChangeText={goodsDescription => onDetails({ ...details, goodsDescription })} maxLength={500} multiline placeholder={selectedKind === 'DELIVERY_TRUCK' ? 'Например: диван и 5 коробок' : 'Например: документы или небольшая коробка'} placeholderTextColor={palette.muted} style={[d.input, { color: palette.ink, borderColor: palette.line, backgroundColor: isDark ? palette.elevated : '#F7F8FA' }]}/>
        <OptionSwitch icon="walk-outline" title="От двери до двери" caption="Водитель заберёт и передаст груз у двери" value={details.doorToDoor} onValueChange={doorToDoor => onDetails({ ...details, doorToDoor })}/>
        {selectedKind === 'DELIVERY_TRUCK' && <>
          <Text style={[d.label, { color: palette.ink }]}>Тип кузова</Text><View style={d.choices}>{([['VAN','Фургон'],['BOX','Будка'],['OPEN','Открытый']] as const).map(([value,label]) => <Choice key={value} label={label} selected={details.bodyType === value} onPress={() => onDetails({ ...details, bodyType: value })}/>)}</View>
          <Text style={[d.label, { color: palette.ink }]}>Грузчики</Text><View style={d.choices}>{([0,1,2] as const).map(value => <Choice key={value} label={value === 0 ? 'Без грузчиков' : `${value} ${value === 1 ? 'грузчик' : 'грузчика'}`} selected={details.loaders === value} onPress={() => onDetails({ ...details, loaders: value })}/>)}</View>
          <OptionSwitch icon="time-outline" title="Запланировать" caption="Подача через 30 минут" value={details.scheduled} onValueChange={scheduled => onDetails({ ...details, scheduled })}/>
        </>}
        <Text style={[d.label, { color: palette.ink }]}>Комментарий водителю</Text><TextInput value={details.comment} onChangeText={comment => onDetails({ ...details, comment })} maxLength={500} multiline placeholder="Укажите важные детали" placeholderTextColor={palette.muted} style={[d.input, { minHeight: 70, color: palette.ink, borderColor: palette.line, backgroundColor: isDark ? palette.elevated : '#F7F8FA' }]}/>
        {!!error && <Text accessibilityRole="alert" style={d.error}>{error}</Text>}
        {footer(true)}
      </ScrollView>
    </BottomPanel>}
  </View>;
}

function AddressRow({ value, label, pickup, onPress, color }: { value: string; label: string; pickup?: boolean; onPress: () => void; color: string }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={d.address}>{pickup ? <PickupIcon size={21}/> : <Icon name="flag" size={21}/>}<View style={{ flex: 1 }}><Text style={d.addressLabel}>{label}</Text><Text numberOfLines={1} style={[d.addressValue, { color }]}>{shortAddress(value)}</Text></View><Icon name="chevron-forward" color={colors.muted} size={18}/></Pressable>;
}
function DeliveryService({ title, subtitle, source, selected, price, onPress, palette }: { title: string; subtitle: string; source: number; selected: boolean; price?: number; onPress: () => void; palette: ReturnType<typeof useTheme>['palette'] }) {
  return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[d.service, { borderColor: selected ? palette.accent : 'transparent', backgroundColor: selected ? palette.elevated : 'transparent' }]}><Image source={source} resizeMode="contain" style={d.serviceImage}/><Text style={[d.serviceTime, { color: palette.muted }]}>{price ? money(price) : '≈ 5 мин'}</Text><Text style={[d.serviceName, { color: palette.ink }]}>{title}</Text><Text numberOfLines={2} style={[d.serviceSubtitle, { color: palette.muted }]}>{subtitle}</Text></Pressable>;
}
function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) { const { palette } = useTheme(); return <Pressable accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress} style={[d.choice, { borderColor: selected ? palette.accent : palette.line, backgroundColor: selected ? palette.elevated : palette.surface }]}><Text style={{ color: palette.ink, fontSize: 12, fontWeight: selected ? '700' : '500' }}>{label}</Text></Pressable>; }
function OptionSwitch({ icon, title, caption, value, onValueChange }: { icon: React.ComponentProps<typeof Icon>['name']; title: string; caption: string; value: boolean; onValueChange: (value: boolean) => void }) { const { palette } = useTheme(); return <View style={d.option}><Icon name={icon} color={palette.ink} size={22}/><View style={{ flex: 1 }}><Text style={[d.optionTitle, { color: palette.ink }]}>{title}</Text><Text style={[d.hint, { color: palette.muted }]}>{caption}</Text></View><ToggleSwitch label={title} value={value} onValueChange={onValueChange}/></View>; }

const d = StyleSheet.create({
  panel: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 17, paddingTop: 7, gap: 3, borderTopLeftRadius: 28, borderTopRightRadius: 28 }, handle: { width: 44, height: 4, borderRadius: 2, backgroundColor: '#B8BDC3', alignSelf: 'center', marginBottom: 5 }, titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 3 }, deliveryMark: { width: 39, height: 39, borderRadius: 12, backgroundColor: '#EA3C32', alignItems: 'center', justifyContent: 'center' }, title: { fontSize: 26, fontWeight: '800', letterSpacing: -.6 },
  address: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E1E4E8' }, addressLabel: { color: colors.muted, fontSize: 10, marginBottom: 2 }, addressValue: { fontSize: 15, fontWeight: '500' }, services: { gap: 5, paddingTop: 7, paddingBottom: 4 }, service: { width: 104, minHeight: 108, borderRadius: 18, borderWidth: 1.5, padding: 7 }, serviceImage: { width: '100%', height: 45 }, serviceTime: { fontSize: 10 }, serviceName: { fontSize: 15, fontWeight: '700', marginTop: 1 }, serviceSubtitle: { fontSize: 9, lineHeight: 12, marginTop: 2 }, routeMeta: { fontSize: 11, textAlign: 'center', paddingTop: 2 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 6 }, cash: { width: 42, alignItems: 'center' }, primary: { minHeight: 52, borderRadius: 17, flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }, primaryText: { fontSize: 15, fontWeight: '700' }, parameters: { width: 43, height: 48, alignItems: 'center', justifyContent: 'center' }, error: { color: colors.danger, fontSize: 12, lineHeight: 16 },
  details: { paddingHorizontal: 17, paddingTop: 8, gap: 14 }, detailsHeading: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }, detailsTitle: { fontSize: 25, fontWeight: '800' }, close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, hint: { fontSize: 11, lineHeight: 16 }, deliveryHero: { minHeight: 106, flexDirection: 'row', alignItems: 'center', borderRadius: 20, padding: 12, gap: 12 }, heroImage: { width: 130, height: 84 }, heroTitle: { fontSize: 22, fontWeight: '800' }, label: { fontSize: 14, fontWeight: '700' }, input: { minHeight: 88, borderRadius: 16, borderWidth: 1, padding: 13, fontSize: 14, textAlignVertical: 'top' }, option: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E2E5E9' }, optionTitle: { fontSize: 14, fontWeight: '600' }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, choice: { minHeight: 39, borderWidth: 1.5, borderRadius: 13, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
});
