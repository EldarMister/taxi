import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, FlatList, Modal, Pressable, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomPanel } from '../BottomPanel';
import { Icon } from '../ui';
import { fonts } from '../design/typography';
import { LocalizedText as Text, translateInterfaceText } from '../auth/LocalizedText';
import { useRegistrationDesign } from './design';
import { vehicleColors } from './vehicleData';
import { brandLogos } from './brandLogos';
import { brandLabel, brandSections, compareVehicleNames } from './vehicleBrands';
import { cargoVehicleCatalog } from './cargoCatalog';

export type VehicleCatalog = Record<string, string[]>;
let cachedCatalog: VehicleCatalog | undefined;
export async function loadVehicleCatalog(): Promise<VehicleCatalog> {
  if (cachedCatalog) return cachedCatalog;
  const source: VehicleCatalog = require('./catalog/models.json');
  if (!source || !Object.values(source).every(models => Array.isArray(models) && models.every(model => typeof model === 'string'))) throw new Error('Invalid vehicle catalog');
  cachedCatalog = source;
  return source;
}
export function VehicleSelectionSheet({ kind, brand, selected, cargo = false, onBrand, onSelect, onBack, onClose }: {
  kind: 'brand' | 'model' | 'color'; brand: string; selected: string;
  cargo?: boolean;
  onBrand: (brand: string) => void; onSelect: (value: string) => void; onBack: () => void; onClose: () => void;
}) {
  const { palette } = useRegistrationDesign(), insets = useSafeAreaInsets(), { height } = useWindowDimensions();
  const searchScope = `${kind}:${brand}`;
  const [search, setSearch] = useState({ scope: searchScope, value: '' }), [catalog, setCatalog] = useState<VehicleCatalog | null>(cachedCatalog || null);
  const query = search.scope === searchScope ? search.value : '';
  const [loading, setLoading] = useState(!cargo && !cachedCatalog), [error, setError] = useState(false), [attempt, setAttempt] = useState(0), [closing, setClosing] = useState(false);
  useEffect(() => {
    if (cargo) { setLoading(false); setError(false); return; }
    if (kind === 'color') return;
    let active = true;
    setLoading(true); setError(false);
    loadVehicleCatalog().then(value => { if (active) setCatalog(value); }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, attempt, cargo]);
  const title = kind === 'brand' ? 'Марка автомобиля' : kind === 'color' ? 'Цвет автомобиля' : `Модель ${brand}`;
  const placeholder = kind === 'brand' ? 'Поиск марки' : kind === 'color' ? 'Поиск цвета' : 'Поиск модели';
  const selectedCatalog = cargo ? cargoVehicleCatalog : catalog;
  const values = useMemo(() => kind === 'color' ? vehicleColors.map(item => item.value) : kind === 'brand' ? Object.keys(selectedCatalog || {}) : [...(selectedCatalog?.[brand] || [])].sort(compareVehicleNames), [kind, selectedCatalog, brand]);
  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase().replace(/ё/g, 'е');
    const sections = kind === 'brand' ? brandSections(values, query) : [{ title: '', values: values.filter(value => value.toLowerCase().replace(/ё/g, 'е').includes(normalized)) }];
    return sections.flatMap(section => [
      ...(section.title ? [{ key: 'header:' + section.title, heading: section.title, value: '' }] : []),
      ...section.values.map(value => ({ key: section.title + ':' + value, heading: '', value })),
    ]);
  }, [kind, values, query]);
  return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => setClosing(true)}>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BottomPanel expanded closeRequested={closing} onClose={onClose} label="Закрыть выбор автомобиля" backdropOpacity={.44} topGap={Math.max(insets.top + 12, height * .13 - 24)} bottomPadding={0}
        handleStyle={{ backgroundColor: '#D6D8DD', width: 43, height: 4 }} surfaceStyle={{ backgroundColor: palette.surface, paddingTop: 0, borderTopLeftRadius: 20, borderTopRightRadius: 20 }}>
        <View style={[s.header, { borderBottomColor: palette.line, borderBottomWidth: kind === 'color' ? StyleSheet.hairlineWidth : 0, gap: kind === 'color' ? 8 : kind === 'brand' ? 10 : 14, paddingBottom: kind === 'brand' ? 9 : kind === 'model' ? 10 : 12 }]}>
          <View style={s.heading}>{kind === 'model' && <Pressable accessibilityRole="button" accessibilityLabel="К списку марок" hitSlop={10} onPress={onBack} style={s.back}><Icon name="chevron-back" size={26} color={palette.ink}/></Pressable>}<Text accessibilityRole="header" style={[s.title, { color: palette.ink }]}>{title}</Text></View>
          <View style={[s.search, { backgroundColor: palette.elevated, borderColor: palette.line }]}><Icon name="search-outline" size={22} color={palette.ink}/><TextInput key={searchScope} accessibilityLabel={placeholder} value={query} onChangeText={value => setSearch({ scope: searchScope, value })} placeholder={translateInterfaceText(placeholder)} placeholderTextColor={palette.muted} autoCorrect={false} autoCapitalize="none" style={[s.searchText, { color: palette.ink }]}/></View>
        </View>
        {loading && kind !== 'color' ? <ActivityIndicator color={palette.accent} style={s.message}/> : error && kind !== 'color' ? <View style={s.message}><Text style={{ color: palette.muted }}>Не удалось загрузить каталог</Text><Pressable onPress={() => setAttempt(value => value + 1)}><Text style={{ color: palette.accent, fontFamily: fonts.semibold }}>Повторить</Text></Pressable></View> : <FlatList testID={`vehicle-${kind}-list`} key={kind + ':' + brand} data={rows} extraData={selected} keyExtractor={item => item.key}
          initialNumToRender={18} maxToRenderPerBatch={12} windowSize={5} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 18) }}
          ListEmptyComponent={<Text style={[s.message, { color: palette.muted }]}>Ничего не найдено</Text>}
          renderItem={({ item }) => {
            if (item.heading) return <Text accessibilityRole="header" style={[s.sectionTitle, { color: palette.ink }]}>{item.heading}</Text>;
            const value = item.value;
            return <Pressable accessibilityRole="radio" accessibilityLabel={value} accessibilityState={{ checked: value === selected }} onPress={() => kind === 'brand' ? onBrand(value) : onSelect(value)} style={({ pressed }) => [s.row, { minHeight: kind === 'brand' ? 48 : kind === 'model' ? 44 : 47.5, borderBottomColor: palette.line, opacity: pressed ? .55 : 1 }]}>
            {kind === 'brand' && <View style={s.logo}>{brandLogos[value] ? <Image source={brandLogos[value]} resizeMode="contain" style={s.logoImage} accessibilityIgnoresInvertColors/> : <Icon name="car-outline" size={23} color={palette.muted}/>}</View>}
            <Text style={[s.rowText, { color: palette.ink }]}>{kind === 'brand' ? brandLabel(value) : value}</Text>
            {kind === 'color' ? <>{selected === value && <Icon name="checkmark" size={23} color={palette.ink}/>}<View style={[s.swatch, { backgroundColor: vehicleColors.find(item => item.value === value)?.color, borderColor: value === 'Белый' ? '#B4BAC6' : 'transparent' }]}/></> : <Icon name={selected === value ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={selected === value ? palette.accent : '#A5ABB7'}/>}
          </Pressable>;
          }}/>} 
      </BottomPanel>
    </GestureHandlerRootView>
  </Modal>;
}
const s = StyleSheet.create({
  header: { paddingHorizontal: 24, paddingTop: 28, paddingBottom: 19, gap: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 20 }, back: { width: 23, minHeight: 40, justifyContent: 'center' },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 24, lineHeight: 32, letterSpacing: -.65 },
  search: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderRadius: 9, paddingHorizontal: 14 },
  searchText: { flex: 1, minHeight: 44, fontFamily: fonts.regular, fontSize: 16, paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 15, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 5 },
  rowText: { flex: 1, fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, letterSpacing: -.5 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 23, paddingTop: 19, paddingBottom: 9 },
  logo: { width: 28, height: 30, alignItems: 'center', justifyContent: 'center' },
  logoImage: { width: 28, height: 26 },
  swatch: { width: 31, height: 31, borderWidth: 1, borderRadius: 16 }, message: { padding: 24, gap: 14 },
});
